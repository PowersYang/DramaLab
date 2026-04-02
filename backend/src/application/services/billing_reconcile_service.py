"""账务对账与自愈服务。"""

from __future__ import annotations

import uuid

from ...common.log import get_logger
from ...repository import BillingChargeRepository, BillingReconcileRunRepository, TaskJobRepository
from ...schemas.models import BillingReconcileRun
from ...schemas.task_models import TaskStatus
from ...utils.datetime import utc_now
from .billing_service import BillingService


logger = get_logger(__name__)


class BillingReconcileService:
    """扫描任务状态与计费单状态不一致的记录，并尝试做幂等补偿。"""

    def __init__(self):
        self.task_job_repository = TaskJobRepository()
        self.charge_repository = BillingChargeRepository()
        self.run_repository = BillingReconcileRunRepository()
        self.billing_service = BillingService()

    def reconcile_pending_charges(self, *, dry_run: bool = False, actor_id: str | None = None) -> BillingReconcileRun:
        started_at = utc_now()
        run = BillingReconcileRun(
            id=f"brr_{uuid.uuid4().hex[:16]}",
            status="running",
            dry_run=dry_run,
            scan_scope_json={"type": "terminal_jobs_pending_charge_settlement"},
            examined_count=0,
            repaired_count=0,
            skipped_count=0,
            error_count=0,
            started_at=started_at,
            finished_at=None,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=started_at,
            updated_at=started_at,
        )
        self.run_repository.create(run)
        terminal_statuses = [
            TaskStatus.SUCCEEDED.value,
            TaskStatus.FAILED.value,
            TaskStatus.CANCELLED.value,
            TaskStatus.TIMED_OUT.value,
        ]
        jobs = self.task_job_repository.list_jobs(statuses=terminal_statuses, limit=None)
        summary = {"examined_count": 0, "repaired_count": 0, "skipped_count": 0, "error_count": 0}

        for job in jobs:
            charge = self.charge_repository.get_by_job_id(job.id)
            if charge is None:
                continue
            summary["examined_count"] += 1
            if charge.status not in {"held", "reserved", "settling", "failed"}:
                summary["skipped_count"] += 1
                continue
            outcome_status = job.status.value if hasattr(job.status, "value") else str(job.status)
            before_status = charge.status
            try:
                if dry_run:
                    if self._predict_reconcile_transition(before_status, outcome_status):
                        summary["repaired_count"] += 1
                    else:
                        summary["skipped_count"] += 1
                    continue
                updated_charge = self.billing_service.settle_task_charge_for_completion(
                    job=job,
                    outcome_status=outcome_status,
                    actor_id=job.updated_by,
                )
                after_status = updated_charge.status if updated_charge is not None else before_status
                if after_status != before_status:
                    summary["repaired_count"] += 1
                    logger.info(
                        "BILLING_RECONCILE_SERVICE: repaired charge_id=%s job_id=%s from_status=%s to_status=%s",
                        charge.id,
                        job.id,
                        before_status,
                        after_status,
                    )
                else:
                    summary["skipped_count"] += 1
            except Exception:
                summary["error_count"] += 1
                logger.exception(
                    "BILLING_RECONCILE_SERVICE: reconcile_failed charge_id=%s job_id=%s status=%s",
                    charge.id,
                    job.id,
                    outcome_status,
                )

        final_status = "completed" if summary["error_count"] == 0 else "completed_with_errors"
        return self.run_repository.patch(
            run.id,
            {
                **summary,
                "status": final_status,
                "finished_at": utc_now(),
                "updated_by": actor_id,
            },
        )

    def list_runs(self, limit: int = 50) -> list[BillingReconcileRun]:
        return self.run_repository.list(limit=limit)

    @staticmethod
    def _predict_reconcile_transition(before_status: str, outcome_status: str) -> bool:
        if before_status not in {"held", "reserved", "settling", "failed"}:
            return False
        return outcome_status in {
            TaskStatus.SUCCEEDED.value,
            TaskStatus.FAILED.value,
            TaskStatus.CANCELLED.value,
            TaskStatus.TIMED_OUT.value,
        }
