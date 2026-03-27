from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from src.providers.text.llm_adapter import DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS, LLMAdapter
from src.settings.env_settings import override_env_path_for_tests


class APITimeoutError(Exception):
    """模拟 OpenAI SDK 抛出的超时异常。"""


class _FakeChatCompletions:
    """模拟 chat.completions.create 的调用行为。"""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class _FakeClient:
    """为适配器注入一个可观测的假客户端。"""

    def __init__(self, responses):
        self.chat = SimpleNamespace(completions=_FakeChatCompletions(responses))


class LLMAdapterTest(unittest.TestCase):
    def tearDown(self):
        override_env_path_for_tests(None)

    def test_reads_timeout_from_env(self):
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text("DASHSCOPE_API_KEY=test-key\nLLM_REQUEST_TIMEOUT_SECONDS=450\n", encoding="utf-8")
            override_env_path_for_tests(env_path)

            adapter = LLMAdapter()

            self.assertEqual(adapter._get_request_timeout_seconds(), 450.0)

    def test_invalid_timeout_falls_back_to_default(self):
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text("DASHSCOPE_API_KEY=test-key\nLLM_REQUEST_TIMEOUT_SECONDS=abc\n", encoding="utf-8")
            override_env_path_for_tests(env_path)

            adapter = LLMAdapter()

            self.assertEqual(adapter._get_request_timeout_seconds(), DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS)

    def test_retries_once_when_timeout_occurs(self):
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text(
                "DASHSCOPE_API_KEY=test-key\nLLM_REQUEST_TIMEOUT_SECONDS=450\nLLM_MAX_RETRIES=1\n",
                encoding="utf-8",
            )
            override_env_path_for_tests(env_path)

            adapter = LLMAdapter()
            fake_response = SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
            )
            fake_client = _FakeClient([APITimeoutError("timed out"), fake_response])
            adapter._client = fake_client

            content = adapter.chat(messages=[{"role": "user", "content": "hello"}])

            self.assertEqual(content, "ok")
            self.assertEqual(fake_client.chat.completions.calls, 2)
