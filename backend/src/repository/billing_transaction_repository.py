"""账务流水仓储。"""

from __future__ import annotations

from ..db.models import BillingTransactionRecord
from ..schemas.models import BillingTransaction
from .base import BaseRepository


def _to_domain(record: BillingTransactionRecord) -> BillingTransaction:
    return BillingTransaction(
        id=record.id,
        billing_account_id=record.billing_account_id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        transaction_type=record.transaction_type,
        direction=record.direction,
        amount_credits=record.amount_credits,
        balance_before=record.balance_before,
        balance_after=record.balance_after,
        cash_amount_cents=record.cash_amount_cents,
        related_type=record.related_type,
        related_id=record.related_id,
        task_type=record.task_type,
        rule_snapshot_json=record.rule_snapshot_json or {},
        remark=record.remark,
        operator_user_id=record.operator_user_id,
        operator_source=record.operator_source,
        idempotency_key=record.idempotency_key,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingTransactionRepository(BaseRepository[BillingTransaction]):
    """统一查询和写入账务流水。"""

    def create(self, item: BillingTransaction, session=None) -> BillingTransaction:
        with self._with_session(session) as current_session:
            current_session.add(
                BillingTransactionRecord(
                    id=item.id,
                    billing_account_id=item.billing_account_id,
                    organization_id=item.organization_id,
                    workspace_id=item.workspace_id,
                    transaction_type=item.transaction_type,
                    direction=item.direction,
                    amount_credits=item.amount_credits,
                    balance_before=item.balance_before,
                    balance_after=item.balance_after,
                    cash_amount_cents=item.cash_amount_cents,
                    related_type=item.related_type,
                    related_id=item.related_id,
                    task_type=item.task_type,
                    rule_snapshot_json=item.rule_snapshot_json,
                    remark=item.remark,
                    operator_user_id=item.operator_user_id,
                    operator_source=item.operator_source,
                    idempotency_key=item.idempotency_key,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def get_by_idempotency_key(self, idempotency_key: str) -> BillingTransaction | None:
        with self._with_session() as session:
            record = (
                session.query(BillingTransactionRecord)
                .filter(BillingTransactionRecord.idempotency_key == idempotency_key)
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def list_by_organization(
        self,
        organization_id: str,
        *,
        transaction_type: str | None = None,
        direction: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BillingTransaction]:
        with self._with_session() as session:
            query = session.query(BillingTransactionRecord).filter(BillingTransactionRecord.organization_id == organization_id)
            if transaction_type:
                query = query.filter(BillingTransactionRecord.transaction_type == transaction_type)
            if direction:
                query = query.filter(BillingTransactionRecord.direction == direction)
            rows = (
                query.order_by(BillingTransactionRecord.created_at.desc(), BillingTransactionRecord.id.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [_to_domain(row) for row in rows]

    def list_map(self):
        return {item.id: item for item in []}

    def sync(self, items):
        raise NotImplementedError("BillingTransactionRepository does not support bulk sync")
