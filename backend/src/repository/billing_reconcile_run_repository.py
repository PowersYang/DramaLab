"""账务对账运行记录仓储。"""

from __future__ import annotations

from ..db.models import BillingReconcileRunRecord
from ..schemas.models import BillingReconcileRun
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: BillingReconcileRunRecord) -> BillingReconcileRun:
    return BillingReconcileRun(
        id=record.id,
        status=record.status,
        dry_run=record.dry_run,
        scan_scope_json=record.scan_scope_json or {},
        examined_count=record.examined_count,
        repaired_count=record.repaired_count,
        skipped_count=record.skipped_count,
        error_count=record.error_count,
        started_at=record.started_at,
        finished_at=record.finished_at,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingReconcileRunRepository(BaseRepository[BillingReconcileRun]):
    def create(self, item: BillingReconcileRun, session=None) -> BillingReconcileRun:
        with self._with_session(session) as current_session:
            current_session.add(
                BillingReconcileRunRecord(
                    id=item.id,
                    status=item.status,
                    dry_run=item.dry_run,
                    scan_scope_json=item.scan_scope_json,
                    examined_count=item.examined_count,
                    repaired_count=item.repaired_count,
                    skipped_count=item.skipped_count,
                    error_count=item.error_count,
                    started_at=item.started_at,
                    finished_at=item.finished_at,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        return item

    def list(self, limit: int = 50, session=None) -> list[BillingReconcileRun]:
        with self._with_session(session) as current_session:
            rows = (
                current_session.query(BillingReconcileRunRecord)
                .order_by(BillingReconcileRunRecord.created_at.desc(), BillingReconcileRunRecord.id.desc())
                .limit(limit)
                .all()
            )
            return [_to_domain(row) for row in rows]

    def patch(self, run_id: str, patch: dict, session=None) -> BillingReconcileRun:
        with self._with_session(session) as current_session:
            record = current_session.get(BillingReconcileRunRecord, run_id)
            if record is None:
                raise ValueError(f"Billing reconcile run {run_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_domain(record)

    def list_map(self):
        return {item.id: item for item in self.list(limit=500)}

    def sync(self, items):
        raise NotImplementedError("BillingReconcileRunRepository does not support bulk sync")
