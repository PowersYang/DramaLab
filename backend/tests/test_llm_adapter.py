from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from src.application.services.model_provider_service import ModelProviderService
from src.providers.text.llm_adapter import DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS, LLMAdapter
from src.settings.env_settings import override_env_path_for_tests
from src.utils.endpoints import get_provider_client_base_url


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
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory

        try:
            Base.metadata.drop_all(bind=get_engine())
        except Exception:
            pass
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)

    def _bootstrap_provider_db(self, temp_dir: str, settings_patch: dict | None = None):
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory, init_database

        db_path = Path(temp_dir) / "llm-adapter-test.db"
        env_path = Path(temp_dir) / ".env"
        env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")
        override_env_path_for_tests(env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        service = ModelProviderService()
        service.create_provider(
            {
                "provider_key": "DASHSCOPE",
                "display_name": "DashScope",
                "enabled": True,
                "base_url": "https://dashscope.example.com",
                "credential_fields": ["api_key"],
                "credentials_patch": {"api_key": "test-key"},
                "settings_json": settings_patch or {},
            }
        )

    def test_reads_timeout_from_provider_settings(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"request_timeout_seconds": 450})

            adapter = LLMAdapter()

            self.assertEqual(adapter._get_request_timeout_seconds(), 450.0)

    def test_invalid_timeout_falls_back_to_default(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"request_timeout_seconds": "abc"})

            adapter = LLMAdapter()

            self.assertEqual(adapter._get_request_timeout_seconds(), DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS)

    def test_retries_once_when_timeout_occurs(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"request_timeout_seconds": 450, "max_retries": 1})

            adapter = LLMAdapter()
            fake_response = SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
            )
            fake_client = _FakeClient([APITimeoutError("timed out"), fake_response])
            adapter._client = fake_client

            content = adapter.chat(messages=[{"role": "user", "content": "hello"}])

            self.assertEqual(content, "ok")
            self.assertEqual(fake_client.chat.completions.calls, 2)

    def test_resolves_provider_dynamically_instead_of_binding_at_init(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"request_timeout_seconds": 450})

            adapter = LLMAdapter()
            service = ModelProviderService()
            service.create_provider(
                {
                    "provider_key": "OPENAI",
                    "display_name": "OpenAI",
                    "enabled": True,
                    "base_url": "https://openai.example.com/v1",
                    "credential_fields": ["api_key"],
                    "credentials_patch": {"api_key": "openai-key"},
                    "settings_json": {"default_text_model": "gpt-4.1", "is_default_text_provider": True},
                }
            )
            service.update_provider(
                "DASHSCOPE",
                enabled=False,
            )

            self.assertTrue(adapter.is_configured)
            self.assertEqual(adapter._get_default_model(), "gpt-4.1")

    def test_explicit_model_id_routes_to_matching_provider(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"default_text_model": "qwen3.5-plus"})

            service = ModelProviderService()
            service.create_provider(
                {
                    "provider_key": "OPENAI",
                    "display_name": "OpenAI",
                    "enabled": True,
                    "base_url": "https://openai.example.com/v1",
                    "credential_fields": ["api_key"],
                    "credentials_patch": {"api_key": "openai-key"},
                    "settings_json": {"default_text_model": "gpt-4.1", "supported_text_models": ["gpt-4.1", "gpt-4.1-mini"]},
                }
            )

            adapter = LLMAdapter()
            binding = adapter._resolve_text_binding("gpt-4.1-mini")

            self.assertEqual(binding["provider_key"], "OPENAI")
            self.assertEqual(binding["model_id"], "gpt-4.1-mini")

    def test_dashscope_client_path_can_be_overridden_by_provider_settings(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(
                temp_dir,
                {"client_base_path": "/custom-compatible/v1"},
            )

            self.assertEqual(
                get_provider_client_base_url("DASHSCOPE"),
                "https://dashscope.example.com/custom-compatible/v1",
            )

    def test_non_llm_catalog_entry_cannot_be_used_as_text_binding(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"default_text_model": "qwen3.5-plus"})

            service = ModelProviderService()
            service.create_model_catalog_entry(
                {
                    "model_id": "wan2.6-t2i",
                    "task_type": "t2i",
                    "provider_key": "DASHSCOPE",
                    "display_name": "Wan 2.6 T2I",
                }
            )

            adapter = LLMAdapter()

            with self.assertRaises(ValueError) as context:
                adapter._resolve_text_binding("wan2.6-t2i")

            self.assertIn("not llm", str(context.exception))

    def test_ambiguous_default_text_provider_requires_explicit_config(self):
        with TemporaryDirectory() as temp_dir:
            self._bootstrap_provider_db(temp_dir, {"default_text_model": "qwen3.5-plus"})

            service = ModelProviderService()
            service.create_provider(
                {
                    "provider_key": "OPENAI",
                    "display_name": "OpenAI",
                    "enabled": True,
                    "base_url": "https://openai.example.com/v1",
                    "credential_fields": ["api_key"],
                    "credentials_patch": {"api_key": "openai-key"},
                    "settings_json": {"default_text_model": "gpt-4.1"},
                }
            )

            adapter = LLMAdapter()

            with self.assertRaises(ValueError) as context:
                adapter._resolve_text_binding()

            self.assertIn("Multiple text providers are enabled", str(context.exception))
