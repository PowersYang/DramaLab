"""
统一封装 LLM 调用入口，兼容 DashScope 与 OpenAI 兼容接口。
"""

import logging
import os
from typing import Any, Dict, List, Optional

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

from ...utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)


class LLMAdapter:
    """统一的 LLM 调用入口。"""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        self._client = None
        logger.info("LLM Adapter initialized with provider: %s", self.provider)

    @property
    def is_configured(self) -> bool:
        """Return whether the selected provider has the required API key."""
        if self.provider == "openai":
            return bool(os.getenv("OPENAI_API_KEY"))
        return bool(os.getenv("DASHSCOPE_API_KEY"))

    def _get_client(self):
        """Lazily construct the OpenAI-compatible client for the active provider."""
        if self._client is None:
            if OpenAI is None:
                raise RuntimeError("openai package not installed. Run: pip install openai>=1.0.0")

            if self.provider == "openai":
                self._client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                )
            else:
                self._client = OpenAI(
                    api_key=os.getenv("DASHSCOPE_API_KEY"),
                    base_url=f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1",
                )
        return self._client

    def _get_default_model(self) -> str:
        """Return the default chat model name for the active provider."""
        if self.provider == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-4o")
        return "qwen3.5-plus"

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """Send a chat completion request and return plain text content."""
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
