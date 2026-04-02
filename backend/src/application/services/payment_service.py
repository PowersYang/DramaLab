"""在线支付服务。"""

from __future__ import annotations

import uuid
from datetime import timedelta, timezone
from typing import Mapping

from ...db.models import PaymentOrderRecord
from ...db.session import session_scope
from ...providers.payment import PaymentProviderAck, PaymentProviderCreateOrderRequest, build_payment_provider
from ...repository import PaymentEventRepository, PaymentOrderRepository
from ...schemas.models import PaymentEvent, PaymentOrder
from ...settings.env_settings import get_env
from ...utils.datetime import utc_now
from .billing_service import BillingService


PAYMENT_CHANNELS = {"alipay", "wechat"}
PAYMENT_PROVIDER_MODE_MOCK = "mock"
PAYMENT_PROVIDER_MODE_GATEWAY = "gateway"


class PaymentError(ValueError):
    """支付域统一异常。"""


class PaymentService:
    """承载支付订单创建、支付成功确认与到账入豆闭环。"""

    def __init__(self):
        self.payment_order_repository = PaymentOrderRepository()
        self.payment_event_repository = PaymentEventRepository()
        self.billing_service = BillingService()

    def list_orders(
        self,
        organization_id: str,
        *,
        user_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PaymentOrder]:
        """分页读取当前组织的支付订单。"""
        self.expire_stale_orders()
        return self.payment_order_repository.list_by_organization(
            organization_id,
            user_id=user_id,
            limit=limit,
            offset=offset,
        )

    def get_order(self, order_id: str) -> PaymentOrder | None:
        """读取单个支付订单。"""
        self.refresh_order_state(order_id)
        return self.payment_order_repository.get(order_id)

    def list_order_events(self, order_id: str) -> list[PaymentEvent]:
        """读取单个支付订单的审计事件时间线。"""
        self.refresh_order_state(order_id)
        return self.payment_event_repository.list_by_order(order_id)

    def create_payment_order(
        self,
        *,
        organization_id: str,
        workspace_id: str | None,
        user_id: str | None,
        channel: str,
        amount_cents: int,
        subject: str | None = None,
        description: str | None = None,
        actor_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> PaymentOrder:
        """创建新的扫码支付订单。"""
        normalized_channel = str(channel).strip().lower()
        if normalized_channel not in PAYMENT_CHANNELS:
            raise PaymentError(f"Unsupported payment channel: {channel}")
        if amount_cents <= 0:
            raise PaymentError("Payment amount must be positive")
        if idempotency_key:
            existing = self.payment_order_repository.get_by_idempotency_key(idempotency_key)
            if existing is not None:
                return existing

        now = utc_now()
        quote = self.billing_service.preview_recharge(organization_id=organization_id, amount_cents=amount_cents)
        account = self.billing_service.get_account(organization_id)
        provider_mode = self._get_provider_mode()
        order_id = f"pay_{uuid.uuid4().hex[:16]}"
        client_token = uuid.uuid4().hex[:12]
        provider_result = self._provider().create_pc_order(
            PaymentProviderCreateOrderRequest(
                order_id=order_id,
                channel=normalized_channel,
                amount_cents=amount_cents,
                subject=subject or f"DramaLab 算力豆充值 {amount_cents / 100:.2f} 元",
                description=description,
                client_token=client_token,
                expires_at=now + timedelta(minutes=15),
            )
        )
        order = PaymentOrder(
            id=order_id,
            billing_account_id=account.id,
            organization_id=organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            channel=normalized_channel,
            status="pending",
            amount_cents=amount_cents,
            currency="CNY",
            subject=subject or f"DramaLab 算力豆充值 {amount_cents / 100:.2f} 元",
            description=description,
            provider_mode=provider_mode,
            provider_order_id=provider_result.provider_order_id,
            provider_trade_no=None,
            provider_buyer_id=None,
            provider_response_json=provider_result.provider_response_json,
            exchange_snapshot_json=quote["exchange_snapshot_json"],
            bonus_rule_snapshot_json=quote["bonus_rule_snapshot_json"],
            base_credits=quote["base_credits"],
            bonus_credits=quote["bonus_credits"],
            total_credits=quote["total_credits"],
            qr_payload=provider_result.qr_payload,
            qr_code_svg=provider_result.qr_code_svg,
            qr_expires_at=provider_result.qr_expires_at,
            paid_at=None,
            expired_at=None,
            cancelled_at=None,
            failure_reason=None,
            client_token=client_token,
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        with session_scope() as session:
            self.payment_order_repository.create(order, session=session)
            self._append_event(
                order=order,
                event_type="payment_order.created",
                from_status=None,
                to_status=order.status,
                event_payload_json={
                    "channel": normalized_channel,
                    "amount_cents": amount_cents,
                    "provider_mode": provider_mode,
                },
                actor_id=actor_id,
                session=session,
            )
        return order

    def cancel_order(self, *, order_id: str, actor_id: str | None = None) -> PaymentOrder:
        """取消仍处于待支付态的订单。"""
        with session_scope() as session:
            order = self.payment_order_repository.get(order_id, session=session)
            if order is None:
                raise PaymentError(f"Payment order {order_id} not found")
            if order.status == "paid":
                raise PaymentError("Paid order cannot be cancelled")
            if order.status == "cancelled":
                return order
            updated = self.payment_order_repository.patch(
                order_id,
                {
                    "status": "cancelled",
                    "cancelled_at": utc_now(),
                    "updated_by": actor_id,
                },
                session=session,
            )
            self._append_event(
                order=updated,
                event_type="payment_order.cancelled",
                from_status=order.status,
                to_status=updated.status,
                event_payload_json={},
                actor_id=actor_id,
                session=session,
            )
            return updated

    def refresh_order_state(self, order_id: str, *, actor_id: str | None = None) -> PaymentOrder | None:
        """在读取订单前收敛一次过期状态，避免前端长时间看到脏的 pending。"""
        now = utc_now()
        with session_scope() as session:
            order = self.payment_order_repository.get(order_id, session=session)
            if order is None:
                return None
            if order.status != "pending":
                return order
            order_expires_at = self._coerce_utc_datetime(order.qr_expires_at)
            if order_expires_at is None or order_expires_at >= now:
                return order
            updated = self.payment_order_repository.patch(
                order.id,
                {
                    "status": "expired",
                    "expired_at": now,
                    "updated_by": actor_id,
                },
                session=session,
            )
            self._append_event(
                order=updated,
                event_type="payment_order.expired",
                from_status=order.status,
                to_status=updated.status,
                event_payload_json={"source": "lazy_refresh"},
                actor_id=actor_id,
                session=session,
            )
            return updated

    def simulate_payment_success(
        self,
        *,
        order_id: str,
        provider_trade_no: str | None = None,
        provider_buyer_id: str | None = None,
        actor_id: str | None = None,
    ) -> PaymentOrder:
        """开发态模拟扫码成功，复用正式到账路径。"""
        if self._get_provider_mode() != PAYMENT_PROVIDER_MODE_MOCK:
            raise PaymentError("Payment simulation is only available in mock mode")
        return self.mark_order_paid(
            order_id=order_id,
            provider_trade_no=provider_trade_no or f"mock_trade_{order_id}",
            provider_buyer_id=provider_buyer_id or "mock_buyer",
            provider_payload={"source": "mock_simulation"},
            actor_id=actor_id,
            source_event="mock.payment_succeeded",
        )

    def handle_provider_notification(
        self,
        *,
        channel: str,
        headers: Mapping[str, str],
        raw_body: bytes,
        query_params: Mapping[str, str],
        actor_id: str | None = None,
    ) -> tuple[PaymentOrder, PaymentProviderAck]:
        """消费第三方支付回调，并返回 provider 需要的确认结果。"""
        normalized_channel = str(channel).strip().lower()
        if normalized_channel not in PAYMENT_CHANNELS:
            raise PaymentError(f"Unsupported payment channel: {channel}")
        provider = self._provider()
        notification = provider.parse_notification(
            channel=normalized_channel,
            headers=headers,
            raw_body=raw_body,
            query_params=query_params,
        )
        order = self.mark_order_paid(
            order_id=notification.order_id,
            provider_trade_no=notification.provider_trade_no,
            provider_buyer_id=notification.provider_buyer_id,
            provider_payload=notification.provider_payload,
            actor_id=actor_id,
            source_event=f"{normalized_channel}.notify",
        )
        return order, provider.build_notify_ack(channel=normalized_channel, success=True, message="processed")

    def build_notify_failure_ack(self, *, channel: str, message: str) -> PaymentProviderAck:
        """在回调处理失败时，也按渠道要求返回失败确认。"""
        normalized_channel = str(channel).strip().lower()
        if normalized_channel not in PAYMENT_CHANNELS:
            raise PaymentError(f"Unsupported payment channel: {channel}")
        return self._provider().build_notify_ack(channel=normalized_channel, success=False, message=message)

    def mark_order_paid(
        self,
        *,
        order_id: str,
        provider_trade_no: str,
        provider_buyer_id: str | None = None,
        provider_payload: dict | None = None,
        actor_id: str | None = None,
        source_event: str = "provider.notify",
    ) -> PaymentOrder:
        """把支付订单推进到已支付，并幂等触发账务入账。"""
        with session_scope() as session:
            order = self.payment_order_repository.get(order_id, session=session)
            if order is None:
                raise PaymentError(f"Payment order {order_id} not found")
            if order.status == "paid":
                return order
            if order.status in {"cancelled", "expired"}:
                raise PaymentError(f"Payment order {order_id} is already {order.status}")

            paid_at = utc_now()
            updated = self.payment_order_repository.patch(
                order_id,
                {
                    "status": "paid",
                    "provider_trade_no": provider_trade_no,
                    "provider_buyer_id": provider_buyer_id,
                    "provider_response_json": {
                        **(order.provider_response_json or {}),
                        "payment_payload": provider_payload or {},
                        "source_event": source_event,
                    },
                    "paid_at": paid_at,
                    "updated_by": actor_id,
                },
                session=session,
            )
            self.billing_service.apply_payment_recharge(
                payment_order_id=updated.id,
                organization_id=updated.organization_id or "",
                amount_cents=updated.amount_cents,
                workspace_id=updated.workspace_id,
                actor_id=actor_id,
                remark=f"{updated.channel} payment settled",
                session=session,
            )
            self._append_event(
                order=updated,
                event_type="payment_order.paid",
                from_status=order.status,
                to_status=updated.status,
                event_payload_json={
                    "provider_trade_no": provider_trade_no,
                    "provider_buyer_id": provider_buyer_id,
                    "source_event": source_event,
                },
                actor_id=actor_id,
                session=session,
            )
            return updated

    def expire_stale_orders(self, *, actor_id: str | None = None) -> int:
        """回收已超时但仍处于 pending 的支付订单。"""
        now = utc_now()
        repaired = 0
        with session_scope() as session:
            records = (
                session.query(PaymentOrderRecord)
                .filter(PaymentOrderRecord.status == "pending")
                .filter(PaymentOrderRecord.qr_expires_at.is_not(None))
                .filter(PaymentOrderRecord.qr_expires_at < now)
                .all()
            )
            for record in records:
                order = self.payment_order_repository.get(record.id, session=session)
                if order is None:
                    continue
                updated = self.payment_order_repository.patch(
                    order.id,
                    {
                        "status": "expired",
                        "expired_at": now,
                        "updated_by": actor_id,
                    },
                    session=session,
                )
                self._append_event(
                    order=updated,
                    event_type="payment_order.expired",
                    from_status=order.status,
                    to_status=updated.status,
                    event_payload_json={},
                    actor_id=actor_id,
                    session=session,
                )
                repaired += 1
        return repaired

    def _append_event(
        self,
        *,
        order: PaymentOrder,
        event_type: str,
        from_status: str | None,
        to_status: str | None,
        event_payload_json: dict,
        actor_id: str | None,
        session,
    ) -> None:
        """给支付订单追加一条审计事件。"""
        self.payment_event_repository.create(
            PaymentEvent(
                id=f"pev_{uuid.uuid4().hex[:16]}",
                payment_order_id=order.id,
                organization_id=order.organization_id,
                workspace_id=order.workspace_id,
                event_type=event_type,
                from_status=from_status,
                to_status=to_status,
                event_payload_json=event_payload_json,
                created_by=actor_id,
                updated_by=actor_id,
                created_at=utc_now(),
                updated_at=utc_now(),
            ),
            session=session,
        )

    def _provider(self):
        """根据当前模式构造 provider。"""
        try:
            return build_payment_provider(self._get_provider_mode())
        except ValueError as exc:
            raise PaymentError(str(exc)) from exc

    @staticmethod
    def _get_provider_mode() -> str:
        """读取当前支付 provider 模式。"""
        mode = str(get_env("PAYMENT_PROVIDER_MODE", PAYMENT_PROVIDER_MODE_MOCK) or PAYMENT_PROVIDER_MODE_MOCK).strip().lower()
        if mode not in {PAYMENT_PROVIDER_MODE_MOCK, PAYMENT_PROVIDER_MODE_GATEWAY}:
            raise PaymentError(f"Unsupported payment provider mode: {mode}")
        return mode

    @staticmethod
    def _coerce_utc_datetime(value):
        """兼容 SQLite 读回 naive datetime 的情况，统一转换成 UTC aware 再比较。"""
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
