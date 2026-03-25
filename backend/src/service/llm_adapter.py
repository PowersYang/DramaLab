"""
统一封装 LLM 调用入口，兼容 DashScope 与 OpenAI 兼容接口。

支持两类提供方：
  - `dashscope`：默认，走阿里云 DashScope 的兼容接口
  - `openai`：任意 OpenAI 兼容服务，例如 OpenAI、DeepSeek、Ollama 等

环境变量约定：
  - `LLM_PROVIDER=dashscope|openai`
  - `DASHSCOPE_API_KEY=...`
  - `OPENAI_API_KEY=...`
  - `OPENAI_BASE_URL=https://api.openai.com/v1`
  - `OPENAI_MODEL=gpt-4o`
"""
import os
import logging
from typing import Dict, List, Optional, Any

from ..utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)


class LLMAdapter:
    """统一的 LLM 调用入口。"""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        self._client = None
        logger.info(f"LLM Adapter initialized with provider: {self.provider}")

    @property
    def is_configured(self) -> bool:
        if self.provider == "openai":
            return bool(os.getenv("OPENAI_API_KEY"))
        return bool(os.getenv("DASHSCOPE_API_KEY"))

    def _get_client(self):
        """按需创建并缓存 OpenAI 兼容客户端。"""
        if self._client is None:
            try:
                from openai import OpenAI
            except ImportError:
                raise RuntimeError(
                    "openai package not installed. Run: pip install openai>=1.0.0"
                )

            if self.provider == "openai":
                self._client = OpenAI(
                    api_key=os.getenv("OPENAI_API_KEY"),
                    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                )
            else:
                # DashScope 这边同样通过 OpenAI 兼容协议接入
                self._client = OpenAI(
                    api_key=os.getenv("DASHSCOPE_API_KEY"),
                    base_url=f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1",
                )
        return self._client

    def _get_default_model(self) -> str:
        if self.provider == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-4o")
        return "qwen3.5-plus"

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        发送聊天补全请求，并返回文本结果。

        `model` 未传时会自动使用当前提供方的默认模型；
        `response_format` 可选传入 JSON 约束。
        """
        client = self._get_client()
        model = model or self._get_default_model()

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
            raise RuntimeError(f"{provider_label} API error: {e}") from e
