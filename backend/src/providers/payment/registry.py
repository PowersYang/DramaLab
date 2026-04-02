"""支付 provider 注册表。"""

from __future__ import annotations

from .base import PaymentProvider
from .gateway_provider import GatewayPaymentProvider
from .mock_provider import MockPaymentProvider


def build_payment_provider(mode: str) -> PaymentProvider:
    """根据当前模式构建支付 provider。"""
    normalized_mode = str(mode).strip().lower()
    if normalized_mode == "mock":
        return MockPaymentProvider()
    if normalized_mode == "gateway":
        return GatewayPaymentProvider()
    raise ValueError(f"Unsupported payment provider mode: {mode}")
