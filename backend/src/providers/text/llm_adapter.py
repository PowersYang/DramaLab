"""统一封装 LLM 调用入口，兼容 DashScope 与 OpenAI 兼容接口。"""

import logging
import time
from typing import Any, Dict, List, Optional

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

from ...application.services.model_provider_service import ModelProviderService
from ...utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)
DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS = 300.0
DEFAULT_LLM_MAX_RETRIES = 1


class LLMAdapter:
    """统一的 LLM 调用入口。"""

    def __init__(self):
        self.provider_service = ModelProviderService()
        self.provider = self.provider_service.select_text_provider().lower()
        self._client = None
        logger.info("LLM Adapter initialized with provider: %s", self.provider)

    @property
    def is_configured(self) -> bool:
        """判断当前选中的 provider 是否已具备所需 API Key。"""
        if self.provider == "openai":
            return bool(self.provider_service.get_provider_credential("OPENAI", "api_key"))
        return bool(self.provider_service.get_provider_credential("DASHSCOPE", "api_key"))

    def _get_client(self):
        """按需延迟创建当前 provider 对应的 OpenAI 兼容客户端。"""
        if self._client is None:
            if OpenAI is None:
                raise RuntimeError("openai package not installed. Run: pip install openai>=1.0.0")

            request_timeout_seconds = self._get_request_timeout_seconds()
            if self.provider == "openai":
                self._client = OpenAI(
                    api_key=self.provider_service.get_provider_credential("OPENAI", "api_key"),
                    base_url=self.provider_service.get_provider_base_url("OPENAI", "https://api.openai.com/v1"),
                    timeout=request_timeout_seconds,
                )
            else:
                self._client = OpenAI(
                    api_key=self.provider_service.get_provider_credential("DASHSCOPE", "api_key"),
                    base_url=f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1",
                    timeout=request_timeout_seconds,
                )
        return self._client

    def _get_request_timeout_seconds(self) -> float:
        """读取 LLM 请求超时，允许通过 .env 为慢请求场景放宽等待时间。"""
        try:
            provider_key = "OPENAI" if self.provider == "openai" else "DASHSCOPE"
            raw_timeout = self.provider_service.get_provider_config(provider_key).settings_json.get("request_timeout_seconds")
            if raw_timeout is None:
                return DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS
            timeout_seconds = float(raw_timeout)
        except (TypeError, ValueError):
            logger.warning(
                "LLM_ADAPTER: invalid LLM_REQUEST_TIMEOUT_SECONDS=%s, fallback=%s",
                raw_timeout,
                DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
            )
            return DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS

        if timeout_seconds <= 0:
            logger.warning(
                "LLM_ADAPTER: non_positive LLM_REQUEST_TIMEOUT_SECONDS=%s, fallback=%s",
                raw_timeout,
                DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
            )
            return DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS
        return timeout_seconds

    def _get_max_retries(self) -> int:
        """读取超时后的重试次数，避免上游偶发抖动直接打断分镜分析。"""
        try:
            provider_key = "OPENAI" if self.provider == "openai" else "DASHSCOPE"
            raw_retries = self.provider_service.get_provider_config(provider_key).settings_json.get("max_retries")
            if raw_retries is None:
                return DEFAULT_LLM_MAX_RETRIES
            retries = int(raw_retries)
        except (TypeError, ValueError):
            logger.warning(
                "LLM_ADAPTER: invalid LLM_MAX_RETRIES=%s, fallback=%s",
                raw_retries,
                DEFAULT_LLM_MAX_RETRIES,
            )
            return DEFAULT_LLM_MAX_RETRIES

        if retries < 0:
            logger.warning(
                "LLM_ADAPTER: negative LLM_MAX_RETRIES=%s, fallback=%s",
                raw_retries,
                DEFAULT_LLM_MAX_RETRIES,
            )
            return DEFAULT_LLM_MAX_RETRIES
        return retries

    def _is_timeout_error(self, exc: Exception) -> bool:
        """识别上游 SDK 或底层 HTTP 库抛出的超时异常。"""
        timeout_names = {"APITimeoutError", "ReadTimeout", "TimeoutException"}
        current: BaseException | None = exc
        while current is not None:
            if current.__class__.__name__ in timeout_names:
                return True
            current = current.__cause__ or current.__context__
        return False

    def _get_default_model(self) -> str:
        """返回当前 provider 默认使用的聊天模型名。"""
        if self.provider == "openai":
            return self.provider_service.get_default_text_model("openai")
        return self.provider_service.get_default_text_model("dashscope")

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
    ) -> str:
        """发送一次聊天补全请求并返回纯文本结果。"""
        client = self._get_client()
        model = model or self._get_default_model()
        request_timeout_seconds = self._get_request_timeout_seconds()
        max_retries = self._get_max_retries()

        kwargs: Dict[str, Any] = {"model": model, "messages": messages}
        if response_format:
            kwargs["response_format"] = response_format

        for attempt in range(max_retries + 1):
            try:
                # 记录外部模型调用耗时，便于区分“后端逻辑异常”和“上游模型接口卡住/超时”。
                started_at = time.perf_counter()
                logger.info(
                    "LLM_ADAPTER: chat start provider=%s model=%s messages=%s timeout_seconds=%s attempt=%s/%s",
                    self.provider,
                    model,
                    len(messages),
                    request_timeout_seconds,
                    attempt + 1,
                    max_retries + 1,
                )
                response = client.chat.completions.create(**kwargs)
                duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
                logger.info(
                    "LLM_ADAPTER: chat completed provider=%s model=%s duration_ms=%s attempt=%s/%s",
                    self.provider,
                    model,
                    duration_ms,
                    attempt + 1,
                    max_retries + 1,
                )
                return response.choices[0].message.content
            except Exception as exc:
                is_timeout_error = self._is_timeout_error(exc)
                if is_timeout_error and attempt < max_retries:
                    logger.warning(
                        "LLM_ADAPTER: chat timeout provider=%s model=%s timeout_seconds=%s attempt=%s/%s retrying=true",
                        self.provider,
                        model,
                        request_timeout_seconds,
                        attempt + 1,
                        max_retries + 1,
                    )
                    continue

                provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
                logger.exception(
                    "LLM_ADAPTER: chat failed provider=%s model=%s timeout_seconds=%s attempt=%s/%s",
                    self.provider,
                    model,
                    request_timeout_seconds,
                    attempt + 1,
                    max_retries + 1,
                )
                raise RuntimeError(f"{provider_label} API error: {exc}") from exc

        raise RuntimeError("LLM request failed unexpectedly without returning a response.")
