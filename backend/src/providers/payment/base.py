"""支付 provider 抽象。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Mapping


@dataclass(slots=True)
class PaymentProviderCreateOrderRequest:
    """创建支付单时，传给 provider 的标准化入参。"""

    order_id: str
    channel: str
    amount_cents: int
    subject: str
    description: str | None
    client_token: str
    expires_at: datetime


@dataclass(slots=True)
class PaymentProviderCreateOrderResult:
    """provider 返回的标准化下单结果。"""

    provider_order_id: str
    provider_response_json: dict
    qr_payload: str | None
    qr_code_svg: str | None
    qr_expires_at: datetime | None


@dataclass(slots=True)
class PaymentProviderNotification:
    """provider 回调经解析后的统一载荷。"""

    order_id: str
    provider_trade_no: str
    provider_buyer_id: str | None = None
    provider_payload: dict = field(default_factory=dict)


@dataclass(slots=True)
class PaymentProviderAck:
    """provider 回调响应。不同渠道会要求不同格式。"""

    status_code: int
    body: str
    media_type: str = "text/plain"


class PaymentProvider:
    """统一抽象不同支付渠道的下单与回调解析行为。"""

    mode = "mock"

    def create_pc_order(self, request: PaymentProviderCreateOrderRequest) -> PaymentProviderCreateOrderResult:
        """创建 PC 扫码支付单。"""
        raise NotImplementedError

    def parse_notification(
        self,
        *,
        channel: str,
        headers: Mapping[str, str],
        raw_body: bytes,
        query_params: Mapping[str, str],
    ) -> PaymentProviderNotification:
        """把渠道回调解析成统一结构。"""
        raise NotImplementedError

    def build_notify_ack(self, *, channel: str, success: bool, message: str = "") -> PaymentProviderAck:
        """生成渠道要求的回调确认响应。"""
        raise NotImplementedError
