"""支付事件仓储。"""

from __future__ import annotations

from ..db.models import PaymentEventRecord
from ..schemas.models import PaymentEvent
from .base import BaseRepository


def _to_domain(record: PaymentEventRecord) -> PaymentEvent:
    """把支付事件 ORM 记录映射成领域对象。"""
    return PaymentEvent(
        id=record.id,
        payment_order_id=record.payment_order_id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        event_type=record.event_type,
        from_status=record.from_status,
        to_status=record.to_status,
        event_payload_json=record.event_payload_json or {},
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class PaymentEventRepository(BaseRepository[PaymentEvent]):
    """统一写入支付事件审计。"""

    def create(self, item: PaymentEvent, session=None) -> PaymentEvent:
        """创建支付事件。"""
        with self._with_session(session) as current_session:
            current_session.add(
                PaymentEventRecord(
                    id=item.id,
                    payment_order_id=item.payment_order_id,
                    organization_id=item.organization_id,
                    workspace_id=item.workspace_id,
                    event_type=item.event_type,
                    from_status=item.from_status,
                    to_status=item.to_status,
                    event_payload_json=item.event_payload_json,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def list_by_order(self, payment_order_id: str, session=None) -> list[PaymentEvent]:
        """按支付订单读取事件历史。"""
        with self._with_session(session) as current_session:
            rows = (
                current_session.query(PaymentEventRecord)
                .filter(PaymentEventRecord.payment_order_id == payment_order_id)
                .order_by(PaymentEventRecord.created_at.asc(), PaymentEventRecord.id.asc())
                .all()
            )
            return [_to_domain(item) for item in rows]

    def list_map(self):
        """当前仓储不提供整表映射缓存。"""
        return {item.id: item for item in []}

    def sync(self, items):
        """支付事件不支持 bulk sync。"""
        raise NotImplementedError("PaymentEventRepository does not support bulk sync")
