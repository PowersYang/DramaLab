"""开发态 mock 支付 provider。"""

from __future__ import annotations

import hashlib
import html
import json
import uuid
from typing import Mapping
from urllib.parse import parse_qs

from .base import (
    PaymentProvider,
    PaymentProviderAck,
    PaymentProviderCreateOrderRequest,
    PaymentProviderCreateOrderResult,
    PaymentProviderNotification,
)


class MockPaymentProvider(PaymentProvider):
    """用于本地开发和测试的支付 provider。"""

    mode = "mock"

    def create_pc_order(self, request: PaymentProviderCreateOrderRequest) -> PaymentProviderCreateOrderResult:
        """生成开发态二维码展示载荷。"""
        qr_payload = f"dramalab://pay/{request.channel}/{request.order_id}/{request.client_token}"
        return PaymentProviderCreateOrderResult(
            provider_order_id=f"{request.channel}_{uuid.uuid4().hex[:18]}",
            provider_response_json={
                "mode": self.mode,
                "channel": request.channel,
                "amount_cents": request.amount_cents,
                "qr_payload": qr_payload,
            },
            qr_payload=qr_payload,
            qr_code_svg=self._build_qr_code_svg(qr_payload=qr_payload, channel=request.channel),
            qr_expires_at=request.expires_at,
        )

    def parse_notification(
        self,
        *,
        channel: str,
        headers: Mapping[str, str],
        raw_body: bytes,
        query_params: Mapping[str, str],
    ) -> PaymentProviderNotification:
        """兼容 JSON / 表单 / query 参数三种 mock 回调格式。"""
        payload = self._decode_payload(raw_body=raw_body, query_params=query_params)
        order_id = str(payload.get("order_id") or payload.get("out_trade_no") or "").strip()
        provider_trade_no = str(payload.get("provider_trade_no") or payload.get("trade_no") or "").strip()
        provider_buyer_id = str(payload.get("provider_buyer_id") or payload.get("buyer_id") or "").strip() or None
        if not order_id:
            raise ValueError("Mock payment notification requires order_id")
        if not provider_trade_no:
            provider_trade_no = f"mock_trade_{order_id}"
        return PaymentProviderNotification(
            order_id=order_id,
            provider_trade_no=provider_trade_no,
            provider_buyer_id=provider_buyer_id,
            provider_payload={
                "channel": channel,
                "headers": dict(headers),
                "payload": payload,
                "mode": self.mode,
            },
        )

    def build_notify_ack(self, *, channel: str, success: bool, message: str = "") -> PaymentProviderAck:
        """模拟微信 / 支付宝常见的回调响应格式。"""
        if channel == "wechat":
            body = json.dumps({"code": "SUCCESS" if success else "FAIL", "message": message or ("成功" if success else "失败")}, ensure_ascii=False)
            return PaymentProviderAck(status_code=200 if success else 400, body=body, media_type="application/json")
        return PaymentProviderAck(status_code=200 if success else 400, body="success" if success else "failure")

    @staticmethod
    def _decode_payload(*, raw_body: bytes, query_params: Mapping[str, str]) -> dict:
        """统一解析 mock 回调载荷。"""
        if raw_body:
            text = raw_body.decode("utf-8").strip()
            if text.startswith("{"):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        return {str(key): value for key, value in parsed.items()}
                except json.JSONDecodeError:
                    pass
            parsed_qs = parse_qs(text, keep_blank_values=True)
            if parsed_qs:
                return {key: values[-1] if values else "" for key, values in parsed_qs.items()}
        return dict(query_params)

    def _build_qr_code_svg(self, *, qr_payload: str, channel: str) -> str:
        """生成开发态可展示的二维码风格 SVG。"""
        size = 29
        cell = 8
        padding = 14
        digest = hashlib.sha256(f"{channel}:{qr_payload}".encode("utf-8")).digest()
        accent = "#1e3a8a" if channel == "wechat" else "#7c2d12"
        bg = "#fcfbf7"
        fg = "#111111"
        rects: list[str] = []
        for row in range(size):
            for col in range(size):
                if self._is_finder_cell(row, col, size=size):
                    continue
                index = (row * size + col) % len(digest)
                value = digest[index]
                if ((value >> (col % 8)) & 1) == 1:
                    x = padding + col * cell
                    y = padding + row * cell
                    rects.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" rx="2" fill="{fg}" />')
        rects.extend(self._finder_svg_blocks(padding=padding, cell=cell, size=size, accent=accent, fg=fg))
        label = "微信支付" if channel == "wechat" else "支付宝"
        text_payload = html.escape(qr_payload[-16:])
        full_size = padding * 2 + size * cell
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{full_size}" height="{full_size + 48}" viewBox="0 0 {full_size} {full_size + 48}" fill="none">'
            f'<rect width="{full_size}" height="{full_size + 48}" rx="28" fill="{bg}"/>'
            f'<rect x="8" y="8" width="{full_size - 16}" height="{full_size - 16}" rx="22" fill="white" stroke="{accent}" stroke-opacity="0.18"/>'
            + "".join(rects)
            + f'<text x="{full_size / 2}" y="{full_size + 22}" text-anchor="middle" fill="{fg}" font-size="13" font-family="Georgia, serif">{label}</text>'
            + f'<text x="{full_size / 2}" y="{full_size + 38}" text-anchor="middle" fill="#6b7280" font-size="10" font-family="monospace">{text_payload}</text>'
            + "</svg>"
        )

    @staticmethod
    def _finder_svg_blocks(*, padding: int, cell: int, size: int, accent: str, fg: str) -> list[str]:
        """构造二维码三个角的定位块。"""
        blocks = []
        for top, left in ((0, 0), (0, size - 7), (size - 7, 0)):
            x = padding + left * cell
            y = padding + top * cell
            blocks.append(f'<rect x="{x}" y="{y}" width="{7 * cell}" height="{7 * cell}" rx="10" fill="{accent}" />')
            blocks.append(f'<rect x="{x + cell}" y="{y + cell}" width="{5 * cell}" height="{5 * cell}" rx="8" fill="white" />')
            blocks.append(f'<rect x="{x + 2 * cell}" y="{y + 2 * cell}" width="{3 * cell}" height="{3 * cell}" rx="6" fill="{fg}" />')
        return blocks

    @staticmethod
    def _is_finder_cell(row: int, col: int, *, size: int) -> bool:
        """判断当前像素是否位于二维码定位块区域。"""
        finder_ranges = [
            (0, 6, 0, 6),
            (0, 6, size - 7, size - 1),
            (size - 7, size - 1, 0, 6),
        ]
        for top, bottom, left, right in finder_ranges:
            if top <= row <= bottom and left <= col <= right:
                return True
        return False
