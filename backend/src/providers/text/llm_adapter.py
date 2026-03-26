"""
统一封装 LLM 调用入口，兼容 DashScope 与 OpenAI 兼容接口。
"""

import logging
from typing import Any, Dict, List, Optional

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

from ...utils.endpoints import get_provider_base_url
from src.settings.env_settings import get_env

logger = logging.getLogger(__name__)


class LLMAdapter:
    """统一的 LLM 调用入口。"""

    def __init__(self):
        self.provider = get_env("LLM_PROVIDER", "dashscope").lower()
        self._client = None
        logger.info("LLM Adapter initialized with provider: %s", self.provider)

    @property
    def is_configured(self) -> bool:
        """判断当前选中的 provider 是否已具备所需 API Key。"""
        if self.provider == "openai":
            return bool(get_env("OPENAI_API_KEY"))
        return bool(get_env("DASHSCOPE_API_KEY"))

    def _get_client(self):
        """按需延迟创建当前 provider 对应的 OpenAI 兼容客户端。"""
        if self._client is None:
            if OpenAI is None:
                raise RuntimeError("openai package not installed. Run: pip install openai>=1.0.0")

            if self.provider == "openai":
                self._client = OpenAI(
                    api_key=get_env("OPENAI_API_KEY"),
                    base_url=get_env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                )
            else:
                self._client = OpenAI(
                    api_key=get_env("DASHSCOPE_API_KEY"),
                    base_url=f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1",
                )
        return self._client

    def _get_default_model(self) -> str:
        """返回当前 provider 默认使用的聊天模型名。"""
        if self.provider == "openai":
            return get_env("OPENAI_MODEL", "gpt-4o")
        return "qwen3.5-plus"

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """发送一次聊天补全请求并返回纯文本结果。"""
        client = self._get_client()
        model = model or self._get_default_model()

        kwargs: Dict[str, Any] = {"model": model, "messages": messages}
        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as exc:
            provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
            raise RuntimeError(f"{provider_label} API error: {exc}") from exc
