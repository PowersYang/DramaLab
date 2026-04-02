"""真实支付网关 provider。"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping
from urllib.parse import parse_qs, urlencode, urlparse

import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ...settings.env_settings import get_env, has_env
from .base import (
    PaymentProvider,
    PaymentProviderAck,
    PaymentProviderCreateOrderRequest,
    PaymentProviderCreateOrderResult,
    PaymentProviderNotification,
)


class GatewayPaymentProvider(PaymentProvider):
    """真实微信支付 / 支付宝网关接入。"""

    mode = "gateway"

    def create_pc_order(self, request: PaymentProviderCreateOrderRequest) -> PaymentProviderCreateOrderResult:
        """按支付渠道创建 PC 扫码支付单。"""
        if request.channel == "wechat":
            return self._create_wechat_native_order(request)
        if request.channel == "alipay":
            return self._create_alipay_precreate_order(request)
        raise ValueError(f"Unsupported payment channel: {request.channel}")

    def parse_notification(
        self,
        *,
        channel: str,
        headers: Mapping[str, str],
        raw_body: bytes,
        query_params: Mapping[str, str],
    ) -> PaymentProviderNotification:
        """按渠道解析并验签支付回调。"""
        if channel == "wechat":
            return self._parse_wechat_notification(headers=headers, raw_body=raw_body)
        if channel == "alipay":
            return self._parse_alipay_notification(raw_body=raw_body, query_params=query_params)
        raise ValueError(f"Unsupported payment channel: {channel}")

    def build_notify_ack(self, *, channel: str, success: bool, message: str = "") -> PaymentProviderAck:
        """返回渠道要求的回调响应体。"""
        if channel == "wechat":
            code = "SUCCESS" if success else "FAIL"
            resolved_message = message or ("成功" if success else "失败")
            return PaymentProviderAck(
                status_code=200 if success else 400,
                body=json.dumps({"code": code, "message": resolved_message}, ensure_ascii=False),
                media_type="application/json",
            )
        return PaymentProviderAck(status_code=200 if success else 400, body="success" if success else "failure")

    def _create_wechat_native_order(self, request: PaymentProviderCreateOrderRequest) -> PaymentProviderCreateOrderResult:
        """调用微信支付 Native 下单接口。"""
        self._ensure_wechat_config()
        body_dict = {
            "appid": self._require_env("WECHAT_PAY_APP_ID"),
            "mchid": self._require_env("WECHAT_PAY_MCH_ID"),
            "description": request.subject,
            "out_trade_no": request.order_id,
            "notify_url": self._build_notify_url("wechat"),
            "attach": request.description or "",
            "time_expire": self._format_wechat_expire(request.expires_at),
            "amount": {
                "total": request.amount_cents,
                "currency": "CNY",
            },
        }
        body = json.dumps(body_dict, ensure_ascii=False, separators=(",", ":"))
        response = requests.post(
            f"{self._wechat_base_url().rstrip('/')}/v3/pay/transactions/native",
            headers=self._build_wechat_headers(method="POST", canonical_url="/v3/pay/transactions/native", body=body),
            data=body.encode("utf-8"),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        code_url = str(payload.get("code_url") or "").strip()
        if not code_url:
            raise ValueError(f"WeChat native create order missing code_url: {payload}")
        return PaymentProviderCreateOrderResult(
            provider_order_id=request.order_id,
            provider_response_json=payload,
            qr_payload=code_url,
            qr_code_svg=self._maybe_render_qr_svg(code_url),
            qr_expires_at=request.expires_at,
        )

    def _create_alipay_precreate_order(self, request: PaymentProviderCreateOrderRequest) -> PaymentProviderCreateOrderResult:
        """调用支付宝预创建接口生成收银二维码。"""
        self._ensure_alipay_config()
        biz_content = {
            "out_trade_no": request.order_id,
            "total_amount": f"{request.amount_cents / 100:.2f}",
            "subject": request.subject,
        }
        if request.description:
            biz_content["body"] = request.description
        params = {
            "app_id": self._require_env("ALIPAY_APP_ID"),
            "method": "alipay.trade.precreate",
            "format": "JSON",
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": self._format_alipay_timestamp(datetime.now(timezone.utc)),
            "version": "1.0",
            "notify_url": self._build_notify_url("alipay"),
            "biz_content": json.dumps(biz_content, ensure_ascii=False, separators=(",", ":")),
        }
        params["sign"] = self._sign_alipay_params(params)
        response = requests.post(self._alipay_base_url(), data=params, timeout=30)
        response.raise_for_status()
        payload = response.json()
        node = payload.get("alipay_trade_precreate_response") or {}
        if str(node.get("code") or "") != "10000":
            raise ValueError(f"Alipay precreate failed: {payload}")
        qr_code = str(node.get("qr_code") or "").strip()
        if not qr_code:
            raise ValueError(f"Alipay precreate missing qr_code: {payload}")
        return PaymentProviderCreateOrderResult(
            provider_order_id=str(node.get("out_trade_no") or request.order_id),
            provider_response_json=payload,
            qr_payload=qr_code,
            qr_code_svg=self._maybe_render_qr_svg(qr_code),
            qr_expires_at=request.expires_at,
        )

    def _parse_wechat_notification(self, *, headers: Mapping[str, str], raw_body: bytes) -> PaymentProviderNotification:
        """验签并解密微信支付回调。"""
        self._ensure_wechat_config()
        text_body = raw_body.decode("utf-8")
        self._verify_wechat_signature(headers=headers, body=text_body)
        payload = json.loads(text_body)
        resource = payload.get("resource") or {}
        plaintext = self._decrypt_wechat_resource(resource)
        order_id = str(plaintext.get("out_trade_no") or "").strip()
        provider_trade_no = str(plaintext.get("transaction_id") or "").strip()
        if not order_id or not provider_trade_no:
            raise ValueError(f"WeChat notify payload missing identifiers: {plaintext}")
        trade_state = str(plaintext.get("trade_state") or "").strip().upper()
        if trade_state and trade_state != "SUCCESS":
            raise ValueError(f"WeChat trade_state is not SUCCESS: {trade_state}")
        return PaymentProviderNotification(
            order_id=order_id,
            provider_trade_no=provider_trade_no,
            provider_buyer_id=str(plaintext.get("openid") or "").strip() or None,
            provider_payload={
                "notify_headers": dict(headers),
                "notify_body": payload,
                "resource_plaintext": plaintext,
            },
        )

    def _parse_alipay_notification(self, *, raw_body: bytes, query_params: Mapping[str, str]) -> PaymentProviderNotification:
        """验签支付宝异步通知。"""
        self._ensure_alipay_config()
        params = self._decode_form_payload(raw_body=raw_body, query_params=query_params)
        self._verify_alipay_signature(params)
        order_id = str(params.get("out_trade_no") or "").strip()
        provider_trade_no = str(params.get("trade_no") or "").strip()
        if not order_id or not provider_trade_no:
            raise ValueError(f"Alipay notify payload missing identifiers: {params}")
        trade_status = str(params.get("trade_status") or "").strip().upper()
        if trade_status and trade_status not in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            raise ValueError(f"Alipay trade_status is not success: {trade_status}")
        return PaymentProviderNotification(
            order_id=order_id,
            provider_trade_no=provider_trade_no,
            provider_buyer_id=str(params.get("buyer_id") or "").strip() or None,
            provider_payload={"notify_payload": params},
        )

    def _build_wechat_headers(self, *, method: str, canonical_url: str, body: str) -> dict[str, str]:
        """生成微信支付 APIv3 请求头。"""
        merchant_id = self._require_env("WECHAT_PAY_MCH_ID")
        serial_no = self._require_env("WECHAT_PAY_MCH_SERIAL_NO")
        nonce_str = uuid.uuid4().hex
        timestamp = str(int(datetime.now(timezone.utc).timestamp()))
        message = f"{method}\n{canonical_url}\n{timestamp}\n{nonce_str}\n{body}\n"
        signature = self._sign_with_private_key(
            message=message,
            private_key_path=self._require_env("WECHAT_PAY_PRIVATE_KEY_PATH"),
        )
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": (
                'WECHATPAY2-SHA256-RSA2048 '
                f'mchid="{merchant_id}",nonce_str="{nonce_str}",timestamp="{timestamp}",serial_no="{serial_no}",signature="{signature}"'
            ),
        }

    def _verify_wechat_signature(self, *, headers: Mapping[str, str], body: str) -> None:
        """校验微信支付回调签名。"""
        timestamp = headers.get("Wechatpay-Timestamp") or headers.get("wechatpay-timestamp")
        nonce = headers.get("Wechatpay-Nonce") or headers.get("wechatpay-nonce")
        signature = headers.get("Wechatpay-Signature") or headers.get("wechatpay-signature")
        if not timestamp or not nonce or not signature:
            raise ValueError("Missing WeChat pay notification signature headers")
        message = f"{timestamp}\n{nonce}\n{body}\n".encode("utf-8")
        certificate_path = self._require_env("WECHAT_PAY_PLATFORM_CERT_PATH")
        certificate = x509.load_pem_x509_certificate(Path(certificate_path).read_bytes())
        certificate.public_key().verify(
            base64.b64decode(signature),
            message,
            padding.PKCS1v15(),
            hashes.SHA256(),
        )

    def _decrypt_wechat_resource(self, resource: Mapping[str, object]) -> dict:
        """用 APIv3 密钥解密微信回调密文。"""
        nonce = str(resource.get("nonce") or "")
        ciphertext = str(resource.get("ciphertext") or "")
        associated_data = str(resource.get("associated_data") or "")
        if not nonce or not ciphertext:
            raise ValueError("Invalid WeChat pay encrypted resource")
        api_v3_key = self._require_env("WECHAT_PAY_API_V3_KEY").encode("utf-8")
        plaintext = AESGCM(api_v3_key).decrypt(
            nonce.encode("utf-8"),
            base64.b64decode(ciphertext),
            associated_data.encode("utf-8") if associated_data else None,
        )
        return json.loads(plaintext.decode("utf-8"))

    def _sign_alipay_params(self, params: Mapping[str, str]) -> str:
        """按支付宝 RSA2 规范对请求参数签名。"""
        canonical = self._build_alipay_canonical_string(params)
        return self._sign_with_private_key(
            message=canonical,
            private_key_path=self._require_env("ALIPAY_APP_PRIVATE_KEY_PATH"),
        )

    def _verify_alipay_signature(self, params: Mapping[str, str]) -> None:
        """校验支付宝异步通知签名。"""
        signature = str(params.get("sign") or "").strip()
        if not signature:
            raise ValueError("Missing Alipay notification sign")
        canonical = self._build_alipay_canonical_string(params)
        public_key = serialization.load_pem_public_key(Path(self._require_env("ALIPAY_PUBLIC_KEY_PATH")).read_bytes())
        public_key.verify(
            base64.b64decode(signature),
            canonical.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )

    @staticmethod
    def _build_alipay_canonical_string(params: Mapping[str, object]) -> str:
        """生成支付宝签名基串。"""
        pairs = []
        for key in sorted(params.keys()):
            if key in {"sign"}:
                continue
            value = params[key]
            if value is None or value == "":
                continue
            pairs.append(f"{key}={value}")
        return "&".join(pairs)

    @staticmethod
    def _decode_form_payload(*, raw_body: bytes, query_params: Mapping[str, str]) -> dict[str, str]:
        """兼容 POST form 和 GET query 的通知参数格式。"""
        if raw_body:
            parsed = parse_qs(raw_body.decode("utf-8"), keep_blank_values=True)
            if parsed:
                return {key: values[-1] if values else "" for key, values in parsed.items()}
        return dict(query_params)

    @staticmethod
    def _sign_with_private_key(*, message: str, private_key_path: str) -> str:
        """使用 RSA SHA256 对字符串签名。"""
        private_key = serialization.load_pem_private_key(Path(private_key_path).read_bytes(), password=None)
        signature = private_key.sign(message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        return base64.b64encode(signature).decode("utf-8")

    @staticmethod
    def _format_wechat_expire(expires_at: datetime) -> str:
        """格式化微信支付需要的 RFC3339 时间。"""
        normalized = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def _format_alipay_timestamp(now: datetime) -> str:
        """格式化支付宝所需的时间字符串。"""
        normalized = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    def _build_notify_url(self, channel: str) -> str:
        """拼接渠道回调地址。"""
        base_url = self._require_env("PAYMENT_NOTIFY_BASE_URL").rstrip("/")
        return f"{base_url}/billing/payment-providers/{channel}/notify"

    @staticmethod
    def _wechat_base_url() -> str:
        """读取微信支付 API 基地址。"""
        return str(get_env("WECHAT_PAY_BASE_URL", "https://api.mch.weixin.qq.com") or "https://api.mch.weixin.qq.com").strip()

    @staticmethod
    def _alipay_base_url() -> str:
        """读取支付宝网关地址。"""
        return str(get_env("ALIPAY_GATEWAY_URL", "https://openapi.alipay.com/gateway.do") or "https://openapi.alipay.com/gateway.do").strip()

    @staticmethod
    def _require_env(key: str) -> str:
        """读取必须存在的配置。"""
        value = str(get_env(key, "") or "").strip()
        if not value:
            raise ValueError(f"{key} is required when PAYMENT_PROVIDER_MODE=gateway")
        return value

    def _ensure_wechat_config(self) -> None:
        """校验微信支付所需配置齐全。"""
        required_keys = [
            "PAYMENT_NOTIFY_BASE_URL",
            "WECHAT_PAY_APP_ID",
            "WECHAT_PAY_MCH_ID",
            "WECHAT_PAY_MCH_SERIAL_NO",
            "WECHAT_PAY_PRIVATE_KEY_PATH",
            "WECHAT_PAY_API_V3_KEY",
            "WECHAT_PAY_PLATFORM_CERT_PATH",
        ]
        self._assert_required_env(required_keys, channel="wechat")

    def _ensure_alipay_config(self) -> None:
        """校验支付宝所需配置齐全。"""
        required_keys = [
            "PAYMENT_NOTIFY_BASE_URL",
            "ALIPAY_APP_ID",
            "ALIPAY_APP_PRIVATE_KEY_PATH",
            "ALIPAY_PUBLIC_KEY_PATH",
        ]
        self._assert_required_env(required_keys, channel="alipay")

    @staticmethod
    def _assert_required_env(required_keys: list[str], *, channel: str) -> None:
        """统一抛出缺失配置错误。"""
        missing = [key for key in required_keys if not has_env(key)]
        if missing:
            raise ValueError(f"Missing payment gateway config for {channel}: {', '.join(missing)}")

    @staticmethod
    def _maybe_render_qr_svg(payload: str) -> str | None:
        """若安装了 qrcode 依赖，则生成可扫描的 SVG；否则退回到前端兜底。"""
        try:
            import qrcode
            import qrcode.image.svg
        except Exception:
            return None
        qr = qrcode.QRCode(box_size=10, border=2)
        qr.add_data(payload)
        qr.make(fit=True)
        image = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
        return image.to_string(encoding="unicode")
