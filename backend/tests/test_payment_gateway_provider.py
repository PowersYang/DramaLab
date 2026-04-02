import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.x509.oid import NameOID

from src.providers.payment.gateway_provider import GatewayPaymentProvider
from src.settings.env_settings import override_env_path_for_tests


def _write_private_key(path: Path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    return key


def _write_public_key(path: Path, public_key):
    path.write_bytes(
        public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


def _write_self_signed_cert(path: Path, private_key):
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DramaLab"),
            x509.NameAttribute(NameOID.COMMON_NAME, "DramaLab Payment Test"),
        ]
    )
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=30))
        .sign(private_key, hashes.SHA256())
    )
    path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))


@pytest.fixture()
def gateway_env(tmp_path: Path):
    merchant_key_path = tmp_path / "wechat_merchant_private.pem"
    platform_key_path = tmp_path / "wechat_platform_private.pem"
    platform_cert_path = tmp_path / "wechat_platform_cert.pem"
    alipay_private_key_path = tmp_path / "alipay_private.pem"
    alipay_public_key_path = tmp_path / "alipay_public.pem"

    _write_private_key(merchant_key_path)
    wechat_platform_key = _write_private_key(platform_key_path)
    _write_self_signed_cert(platform_cert_path, wechat_platform_key)
    alipay_private_key = _write_private_key(alipay_private_key_path)
    _write_public_key(alipay_public_key_path, alipay_private_key.public_key())

    env_path = tmp_path / ".env"
    env_path.write_text(
        "\n".join(
            [
                "PAYMENT_PROVIDER_MODE=gateway",
                "PAYMENT_NOTIFY_BASE_URL=https://pay.example.com",
                "WECHAT_PAY_BASE_URL=https://api.mch.weixin.qq.com",
                "WECHAT_PAY_APP_ID=wx_test_app",
                "WECHAT_PAY_MCH_ID=1900000109",
                "WECHAT_PAY_MCH_SERIAL_NO=serial_001",
                f"WECHAT_PAY_PRIVATE_KEY_PATH={merchant_key_path}",
                "WECHAT_PAY_API_V3_KEY=0123456789abcdef0123456789abcdef",
                f"WECHAT_PAY_PLATFORM_CERT_PATH={platform_cert_path}",
                "ALIPAY_GATEWAY_URL=https://openapi.alipay.com/gateway.do",
                "ALIPAY_APP_ID=2021000000000000",
                f"ALIPAY_APP_PRIVATE_KEY_PATH={alipay_private_key_path}",
                f"ALIPAY_PUBLIC_KEY_PATH={alipay_public_key_path}",
            ]
        ),
        encoding="utf-8",
    )
    override_env_path_for_tests(env_path)
    yield {
        "merchant_key_path": merchant_key_path,
        "wechat_platform_key_path": platform_key_path,
        "platform_cert_path": platform_cert_path,
        "alipay_private_key_path": alipay_private_key_path,
        "alipay_public_key_path": alipay_public_key_path,
    }
    override_env_path_for_tests(None)


def test_gateway_provider_creates_wechat_native_order(gateway_env, monkeypatch):
    provider = GatewayPaymentProvider()
    captured = {}

    class DummyResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"code_url": "weixin://wxpay/bizpayurl?pr=test_code"}

    def fake_post(url, headers=None, data=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["data"] = data
        captured["timeout"] = timeout
        return DummyResponse()

    monkeypatch.setattr("src.providers.payment.gateway_provider.requests.post", fake_post)

    result = provider.create_pc_order(
        request=type(
            "Request",
            (),
            {
                "order_id": "pay_gateway_001",
                "channel": "wechat",
                "amount_cents": 6800,
                "subject": "DramaLab Topup",
                "description": "org recharge",
                "client_token": "client_001",
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
            },
        )()
    )

    assert captured["url"].endswith("/v3/pay/transactions/native")
    assert captured["headers"]["Authorization"].startswith("WECHATPAY2-SHA256-RSA2048 ")
    assert json.loads(captured["data"].decode("utf-8"))["out_trade_no"] == "pay_gateway_001"
    assert result.qr_payload == "weixin://wxpay/bizpayurl?pr=test_code"


def test_gateway_provider_parses_alipay_notification(gateway_env):
    provider = GatewayPaymentProvider()
    params = {
        "app_id": "2021000000000000",
        "buyer_id": "2088000000000000",
        "charset": "utf-8",
        "gmt_payment": "2026-04-02 12:00:00",
        "invoice_amount": "68.00",
        "notify_id": "notify_001",
        "notify_time": "2026-04-02 12:00:00",
        "notify_type": "trade_status_sync",
        "out_trade_no": "pay_alipay_001",
        "seller_id": "2088000000000001",
        "subject": "DramaLab Topup",
        "total_amount": "68.00",
        "trade_no": "2026040222001400000000000001",
        "trade_status": "TRADE_SUCCESS",
        "sign_type": "RSA2",
    }
    canonical = provider._build_alipay_canonical_string(params)
    private_key = serialization.load_pem_private_key(Path(gateway_env["alipay_private_key_path"]).read_bytes(), password=None)
    signature = base64.b64encode(
        private_key.sign(canonical.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    ).decode("utf-8")
    body = urlencode({**params, "sign": signature}).encode("utf-8")

    notification = provider.parse_notification(channel="alipay", headers={}, raw_body=body, query_params={})

    assert notification.order_id == "pay_alipay_001"
    assert notification.provider_trade_no == "2026040222001400000000000001"
    assert notification.provider_buyer_id == "2088000000000000"


def test_gateway_provider_parses_wechat_notification(gateway_env):
    provider = GatewayPaymentProvider()
    resource_plaintext = {
        "out_trade_no": "pay_wechat_001",
        "transaction_id": "42000000000000000001",
        "trade_state": "SUCCESS",
        "openid": "openid_001",
    }
    api_v3_key = b"0123456789abcdef0123456789abcdef"
    nonce = "0123456789ab"
    associated_data = "transaction"
    ciphertext = AESGCM(api_v3_key).encrypt(
        nonce.encode("utf-8"),
        json.dumps(resource_plaintext, separators=(",", ":")).encode("utf-8"),
        associated_data.encode("utf-8"),
    )
    body_dict = {
        "id": "notify_001",
        "create_time": "2026-04-02T12:00:00+08:00",
        "event_type": "TRANSACTION.SUCCESS",
        "resource_type": "encrypt-resource",
        "summary": "支付成功",
        "resource": {
            "algorithm": "AEAD_AES_256_GCM",
            "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
            "associated_data": associated_data,
            "nonce": nonce,
        },
    }
    raw_body = json.dumps(body_dict, separators=(",", ":")).encode("utf-8")
    timestamp = "1712030400"
    signature_nonce = "nonce_001"
    message = f"{timestamp}\n{signature_nonce}\n{raw_body.decode('utf-8')}\n".encode("utf-8")
    platform_private_key = serialization.load_pem_private_key(Path(gateway_env["wechat_platform_key_path"]).read_bytes(), password=None)
    signature = base64.b64encode(
        platform_private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
    ).decode("utf-8")

    notification = provider.parse_notification(
        channel="wechat",
        headers={
            "Wechatpay-Timestamp": timestamp,
            "Wechatpay-Nonce": signature_nonce,
            "Wechatpay-Signature": signature,
        },
        raw_body=raw_body,
        query_params={},
    )

    assert notification.order_id == "pay_wechat_001"
    assert notification.provider_trade_no == "42000000000000000001"
    assert notification.provider_buyer_id == "openid_001"
