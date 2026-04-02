"""任务计费单仓储。"""

from __future__ import annotations

from ..db.models import BillingChargeRecord, TaskJobRecord
from ..schemas.models import BillingCharge
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: BillingChargeRecord) -> BillingCharge:
    return BillingCharge(
        id=record.id,
        billing_account_id=record.billing_account_id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        job_id=record.job_id,
        task_type=record.task_type,
        status=record.status,
        estimated_credits=record.estimated_credits,
        final_credits=record.final_credits,
        reserved_credits=record.reserved_credits,
        settled_credits=record.settled_credits,
        refunded_credits=record.refunded_credits,
        adjusted_credits=record.adjusted_credits,
        pricing_mode=record.pricing_mode,
        pricing_snapshot_json=record.pricing_snapshot_json or {},
        cost_snapshot_json=record.cost_snapshot_json or {},
        usage_snapshot_json=record.usage_snapshot_json or {},
        settlement_reason=record.settlement_reason,
        settled_at=record.settled_at,
        reconciled_at=record.reconciled_at,
        last_reconcile_error=record.last_reconcile_error,
        version=record.version,
        hold_transaction_id=record.hold_transaction_id,
        settle_transaction_id=record.settle_transaction_id,
        idempotency_key=record.idempotency_key,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingChargeRepository(BaseRepository[BillingCharge]):
    def create(self, item: BillingCharge, session=None) -> BillingCharge:
        with self._with_session(session) as current_session:
            current_session.add(
                BillingChargeRecord(
                    id=item.id,
                    billing_account_id=item.billing_account_id,
                    organization_id=item.organization_id,
                    workspace_id=item.workspace_id,
                    job_id=item.job_id,
                    task_type=item.task_type,
                    status=item.status,
                    estimated_credits=item.estimated_credits,
                    final_credits=item.final_credits,
                    reserved_credits=item.reserved_credits,
                    settled_credits=item.settled_credits,
                    refunded_credits=item.refunded_credits,
                    adjusted_credits=item.adjusted_credits,
                    pricing_mode=item.pricing_mode,
                    pricing_snapshot_json=item.pricing_snapshot_json,
                    cost_snapshot_json=item.cost_snapshot_json,
                    usage_snapshot_json=item.usage_snapshot_json,
                    settlement_reason=item.settlement_reason,
                    settled_at=item.settled_at,
                    reconciled_at=item.reconciled_at,
                    last_reconcile_error=item.last_reconcile_error,
                    version=item.version,
                    hold_transaction_id=item.hold_transaction_id,
                    settle_transaction_id=item.settle_transaction_id,
                    idempotency_key=item.idempotency_key,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def get_by_job_id(self, job_id: str, session=None) -> BillingCharge | None:
        with self._with_session(session) as current_session:
            record = (
                current_session.query(BillingChargeRecord)
                .filter(BillingChargeRecord.job_id == job_id)
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def get(self, charge_id: str, session=None) -> BillingCharge | None:
        with self._with_session(session) as current_session:
            record = current_session.get(BillingChargeRecord, charge_id)
            return _to_domain(record) if record else None

    def list_by_organization(
        self,
        organization_id: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        status: str | None = None,
        task_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
        session=None,
    ) -> list[BillingCharge]:
        with self._with_session(session) as current_session:
            query = current_session.query(BillingChargeRecord).filter(BillingChargeRecord.organization_id == organization_id)
            if job_id:
                query = query.filter(BillingChargeRecord.job_id == job_id)
            if status:
                query = query.filter(BillingChargeRecord.status == status)
            if task_type:
                query = query.filter(BillingChargeRecord.task_type == task_type)
            if project_id:
                query = query.join(TaskJobRecord, TaskJobRecord.id == BillingChargeRecord.job_id).filter(TaskJobRecord.project_id == project_id)
            rows = (
                query.order_by(BillingChargeRecord.created_at.desc(), BillingChargeRecord.id.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [_to_domain(row) for row in rows]

    def patch(self, charge_id: str, patch: dict, session=None) -> BillingCharge:
        with self._with_session(session) as current_session:
            record = current_session.get(BillingChargeRecord, charge_id)
            if record is None:
                raise ValueError(f"Billing charge {charge_id} not found")
            now = utc_now()
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = now
            return _to_domain(record)

    def list_map(self):
        return {item.id: item for item in []}

    def sync(self, items):
        raise NotImplementedError("BillingChargeRepository does not support bulk sync")
