from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests

from ...common.log import get_logger
from ...settings.env_settings import get_env


logger = get_logger(__name__)


@dataclass(frozen=True)
class SmsMessage:
    phone: str
    code: str
    purpose: str


class SmsProvider:
    def send_verification_code(self, *, phone: str, code: str, purpose: str) -> None:
        raise NotImplementedError


_mock_outbox: list[SmsMessage] = []


class MockSmsProvider(SmsProvider):
    def send_verification_code(self, *, phone: str, code: str, purpose: str) -> None:
        _mock_outbox.append(SmsMessage(phone=phone, code=code, purpose=purpose))


class WebhookSmsProvider(SmsProvider):
    def __init__(self, url: str, token: str | None = None, timeout_seconds: int = 10):
        self._url = url
        self._token = token
        self._timeout_seconds = timeout_seconds

    def send_verification_code(self, *, phone: str, code: str, purpose: str) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        payload: dict[str, Any] = {"phone": phone, "code": code, "purpose": purpose}
        response = requests.post(self._url, json=payload, headers=headers, timeout=self._timeout_seconds)
        if response.status_code < 200 or response.status_code >= 300:
            detail = response.text[:500] if response.text else ""
            raise ValueError(f"SMS delivery failed with status {response.status_code}: {detail}".strip())


_sms_provider: SmsProvider | None = None
_sms_provider_source: str | None = None


def reset_mock_sms_outbox() -> None:
    _mock_outbox.clear()


def get_mock_sms_outbox() -> list[SmsMessage]:
    return list(_mock_outbox)


def get_sms_provider() -> SmsProvider | None:
    global _sms_provider, _sms_provider_source
    provider = (get_env("AUTH_SMS_PROVIDER") or "").strip().lower()
    if not provider or provider == "disabled":
        _sms_provider = None
        _sms_provider_source = provider
        return None
    if _sms_provider is not None and _sms_provider_source == provider:
        return _sms_provider
    if provider == "mock":
        _sms_provider = MockSmsProvider()
        _sms_provider_source = provider
        return _sms_provider
    if provider == "webhook":
        url = (get_env("AUTH_SMS_WEBHOOK_URL") or "").strip()
        token = (get_env("AUTH_SMS_WEBHOOK_TOKEN") or "").strip() or None
        if not url:
            logger.warning("短信回调发送已启用，但未配置回调地址")
            _sms_provider = None
            _sms_provider_source = provider
            return None
        _sms_provider = WebhookSmsProvider(url=url, token=token)
        _sms_provider_source = provider
        return _sms_provider
    logger.warning("短信供应商配置无法识别：%s，短信发送已禁用", provider)
    _sms_provider = None
    _sms_provider_source = provider
    return None
