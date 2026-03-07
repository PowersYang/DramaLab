"""
LLM Adapter - Unified interface for DashScope and OpenAI-compatible APIs.

Supports two providers:
  - dashscope (default): Alibaba Cloud DashScope Generation API
  - openai: Any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, etc.)

Configuration via environment variables:
  LLM_PROVIDER=dashscope|openai
  DASHSCOPE_API_KEY=...
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o
"""
import os
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class LLMAdapter:
    """Unified LLM call interface supporting DashScope and OpenAI-compatible APIs."""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        logger.info(f"LLM Adapter initialized with provider: {self.provider}")

    @property
    def is_configured(self) -> bool:
        if self.provider == "openai":
            return bool(os.getenv("OPENAI_API_KEY"))
        return bool(os.getenv("DASHSCOPE_API_KEY"))

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Send a chat completion request and return the response content.

        Args:
            messages: List of {"role": ..., "content": ...} dicts
            model: Model name override (uses provider default if None)
            response_format: Optional {"type": "json_object"} constraint

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        if self.provider == "openai":
            return self._call_openai(messages, model, response_format)
        return self._call_dashscope(messages, model, response_format)

    def _call_dashscope(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str],
        response_format: Optional[Dict[str, str]],
    ) -> str:
        import dashscope

        dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")
        model = model or "qwen3.5-plus"

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "result_format": "message",
        }
        if response_format:
            kwargs["response_format"] = response_format

        response = dashscope.Generation.call(**kwargs)

        if response.status_code == 200:
            return response.output.choices[0].message.content
        else:
            raise RuntimeError(
                f"DashScope API error (code={response.code}): {response.message}"
            )

    def _call_openai(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str],
        response_format: Optional[Dict[str, str]],
    ) -> str:
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError(
                "openai package not installed. Run: pip install openai>=1.0.0"
            )

        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        )
        model = model or os.getenv("OPENAI_MODEL", "gpt-4o")

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        response = client.chat.completions.create(**kwargs)
        return response.choices[0].message.content
