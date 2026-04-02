"""支付订单仓储。"""

from __future__ import annotations

from ..db.models import PaymentOrderRecord
from ..schemas.models import PaymentOrder
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: PaymentOrderRecord) -> PaymentOrder:
    """把支付订单 ORM 记录映射成领域对象。"""
    return PaymentOrder(
        id=record.id,
        billing_account_id=record.billing_account_id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        user_id=record.user_id,
        channel=record.channel,
        status=record.status,
        amount_cents=record.amount_cents,
        currency=record.currency,
        subject=record.subject,
        description=record.description,
        provider_mode=record.provider_mode,
        provider_order_id=record.provider_order_id,
        provider_trade_no=record.provider_trade_no,
        provider_buyer_id=record.provider_buyer_id,
        provider_response_json=record.provider_response_json or {},
        exchange_snapshot_json=record.exchange_snapshot_json or {},
        bonus_rule_snapshot_json=record.bonus_rule_snapshot_json or {},
        base_credits=record.base_credits,
        bonus_credits=record.bonus_credits,
        total_credits=record.total_credits,
        qr_payload=record.qr_payload,
        qr_code_svg=record.qr_code_svg,
        qr_expires_at=record.qr_expires_at,
        paid_at=record.paid_at,
        expired_at=record.expired_at,
        cancelled_at=record.cancelled_at,
        failure_reason=record.failure_reason,
        client_token=record.client_token,
        idempotency_key=record.idempotency_key,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class PaymentOrderRepository(BaseRepository[PaymentOrder]):
    """统一读写支付订单。"""

    def create(self, item: PaymentOrder, session=None) -> PaymentOrder:
        """创建支付订单记录。"""
        with self._with_session(session) as current_session:
            current_session.add(
                PaymentOrderRecord(
                    id=item.id,
                    billing_account_id=item.billing_account_id,
                    organization_id=item.organization_id,
                    workspace_id=item.workspace_id,
                    user_id=item.user_id,
                    channel=item.channel,
                    status=item.status,
                    amount_cents=item.amount_cents,
                    currency=item.currency,
                    subject=item.subject,
                    description=item.description,
                    provider_mode=item.provider_mode,
                    provider_order_id=item.provider_order_id,
                    provider_trade_no=item.provider_trade_no,
                    provider_buyer_id=item.provider_buyer_id,
                    provider_response_json=item.provider_response_json,
                    exchange_snapshot_json=item.exchange_snapshot_json,
                    bonus_rule_snapshot_json=item.bonus_rule_snapshot_json,
                    base_credits=item.base_credits,
                    bonus_credits=item.bonus_credits,
                    total_credits=item.total_credits,
                    qr_payload=item.qr_payload,
                    qr_code_svg=item.qr_code_svg,
                    qr_expires_at=item.qr_expires_at,
                    paid_at=item.paid_at,
                    expired_at=item.expired_at,
                    cancelled_at=item.cancelled_at,
                    failure_reason=item.failure_reason,
                    client_token=item.client_token,
                    idempotency_key=item.idempotency_key,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def get(self, order_id: str, session=None) -> PaymentOrder | None:
        """按主键读取支付订单。"""
        with self._with_session(session) as current_session:
            record = current_session.get(PaymentOrderRecord, order_id)
            return _to_domain(record) if record else None

    def get_by_idempotency_key(self, idempotency_key: str, session=None) -> PaymentOrder | None:
        """按幂等键读取订单。"""
        with self._with_session(session) as current_session:
            record = (
                current_session.query(PaymentOrderRecord)
                .filter(PaymentOrderRecord.idempotency_key == idempotency_key)
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def get_by_provider_trade_no(self, provider_trade_no: str, session=None) -> PaymentOrder | None:
        """按渠道交易号读取订单。"""
        with self._with_session(session) as current_session:
            record = (
                current_session.query(PaymentOrderRecord)
                .filter(PaymentOrderRecord.provider_trade_no == provider_trade_no)
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def list_by_organization(
        self,
        organization_id: str,
        *,
        user_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
        session=None,
    ) -> list[PaymentOrder]:
        """按组织分页读取订单，可选收窄到某个用户。"""
        with self._with_session(session) as current_session:
            query = current_session.query(PaymentOrderRecord)
            if organization_id:
                query = query.filter(PaymentOrderRecord.organization_id == organization_id)
            if user_id:
                query = query.filter(PaymentOrderRecord.user_id == user_id)
            rows = (
                query.order_by(PaymentOrderRecord.created_at.desc(), PaymentOrderRecord.id.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [_to_domain(item) for item in rows]

    def patch(self, order_id: str, patch: dict, session=None) -> PaymentOrder:
        """局部更新订单。"""
        with self._with_session(session) as current_session:
            record = current_session.get(PaymentOrderRecord, order_id)
            if record is None:
                raise ValueError(f"Payment order {order_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_domain(record)

    def list_map(self):
        """当前仓储不提供整表映射缓存。"""
        return {item.id: item for item in []}

    def sync(self, items):
        """支付订单不支持 bulk sync。"""
        raise NotImplementedError("PaymentOrderRepository does not support bulk sync")
