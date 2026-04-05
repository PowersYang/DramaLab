import hashlib
import json
import uuid
from datetime import timedelta, timezone

from sqlalchemy.exc import IntegrityError

from ...common.log import get_logger
from ...db.session import session_scope
from ...repository import ProjectRepository, SeriesRepository, TaskAttemptRepository, TaskEventRepository, TaskJobRepository, VideoTaskRepository
from ..services.billing_service import BillingService
from ..services.task_concurrency_service import TaskConcurrencyService
from ...schemas.models import VideoTask
from ...schemas.task_models import TaskAttempt, TaskEvent, TaskJob, TaskReceipt, TaskStatus, TaskType
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class TaskRetryLimitReached(ValueError):
    pass


class TaskService:
    """统一任务服务。

    第一期先只接管视频生成任务：
    API 侧创建业务占位 VideoTask 后，再通过这里落独立 TaskJob，
    后续 worker 只和 TaskJob 打交道。
    """

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.video_task_repository = VideoTaskRepository()
        self.task_job_repository = TaskJobRepository()
        self.task_attempt_repository = TaskAttemptRepository()
        self.task_event_repository = TaskEventRepository()
        self.task_concurrency_service = TaskConcurrencyService()
        self.billing_service = BillingService()

    def create_video_generation_job(
        self,
        *,
        video_task: VideoTask,
        task_type: str,
        queue_name: str = "video",
        resource_type: str | None = None,
        resource_id: str | None = None,
        idempotency_key: str | None = None,
        requested_model: str | None = None,
    ) -> TaskReceipt:
        project = self.project_repository.get(video_task.project_id)
        if not project:
            raise ValueError("项目不存在")

        if idempotency_key:
            existing = self.task_job_repository.get_by_idempotency_key(idempotency_key)
            if existing:
                logger.info("任务服务：按幂等键复用 任务ID=%s 幂等键=%s", existing.id, idempotency_key)
                return self._to_receipt(existing)

        payload = self._build_video_payload(video_task, requested_model=requested_model)
        dedupe_key = self._build_dedupe_key(task_type, payload)
        existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
        if existing:
            logger.info("任务服务：按去重键复用 任务ID=%s 去重键=%s", existing.id, dedupe_key)
            if not video_task.source_job_id:
                video_task.source_job_id = existing.id
                self.video_task_repository.save(video_task)
            return self._to_receipt(existing, source_video_task_id=video_task.id)

        job = TaskJob(
            id=f"job_{uuid.uuid4().hex[:16]}",
            task_type=task_type,
            status=TaskStatus.QUEUED,
            queue_name=queue_name,
            priority=50,
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=video_task.project_id,
            resource_type=resource_type,
            resource_id=resource_id,
            payload_json=payload,
            idempotency_key=idempotency_key,
            dedupe_key=dedupe_key,
            max_attempts=2,
            timeout_seconds=1800,
            created_by=project.updated_by,
            updated_by=project.updated_by,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        with session_scope() as session:
            try:
                self.task_job_repository.create(job, session=session)
                # 中文注释：计费单会立刻以 job_id 建外键关联 billing_charges，
                # 所以必须先把 task_jobs 父记录 flush 到数据库，避免 PostgreSQL 在同一事务里先校验到不存在的父表行。
                session.flush()
                self.billing_service.charge_task_submission(
                    job=job,
                    actor_id=job.created_by,
                    idempotency_key=self._build_charge_idempotency_key(
                        idempotency_key=idempotency_key,
                        job_id=job.id,
                    ),
                    session=session,
                )
                video_task.source_job_id = job.id
                self.video_task_repository.save(video_task, session=session)
                self.task_event_repository.create(
                    TaskEvent(
                        id=f"evt_{uuid.uuid4().hex[:16]}",
                        job_id=job.id,
                        organization_id=job.organization_id,
                        workspace_id=job.workspace_id,
                        created_by=job.created_by,
                        updated_by=job.updated_by,
                        event_type="job.created",
                        to_status=job.status,
                        progress=0,
                        message="视频生成任务已入队",
                        event_payload_json={
                            "task_type": task_type,
                            "resource_type": resource_type,
                            "resource_id": resource_id,
                            "source_video_task_id": video_task.id,
                        },
                        created_at=utc_now(),
                        updated_at=utc_now(),
                    ),
                    session=session,
                )
            except IntegrityError:
                session.rollback()
                existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
                if existing:
                    if not video_task.source_job_id:
                        video_task.source_job_id = existing.id
                        self.video_task_repository.save(video_task)
                    return self._to_receipt(existing, source_video_task_id=video_task.id)
                raise
        logger.info(
            "任务服务：创建视频生成任务完成 任务ID=%s 任务类型=%s 项目ID=%s 来源视频任务ID=%s",
            job.id,
            task_type,
            video_task.project_id,
            video_task.id,
        )
        return self._to_receipt(job, source_video_task_id=video_task.id)

    def create_job(
        self,
        *,
        task_type: str,
        payload: dict,
        project_id: str | None,
        queue_name: str,
        series_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        priority: int = 100,
        max_attempts: int = 2,
        timeout_seconds: int = 1800,
        idempotency_key: str | None = None,
        dedupe_scope: str | None = None,
    ) -> TaskReceipt:
        project = self.project_repository.get(project_id) if project_id else None
        series = self.series_repository.get(series_id) if series_id else None
        if project_id and not project:
            raise ValueError("项目不存在")
        if series_id and not series:
            raise ValueError("系列不存在")

        if idempotency_key:
            existing = self.task_job_repository.get_by_idempotency_key(idempotency_key)
            if existing:
                logger.info("任务服务：通用任务按幂等键复用 任务ID=%s 幂等键=%s", existing.id, idempotency_key)
                return self._to_receipt(existing)

        dedupe_key = self._build_generic_dedupe_key(task_type, payload, project_id, resource_id, dedupe_scope)
        existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
        if existing:
            logger.info("任务服务：通用任务按去重键复用 任务ID=%s 去重键=%s", existing.id, dedupe_key)
            return self._to_receipt(existing)

        owner_organization_id = getattr(project, "organization_id", None) or getattr(series, "organization_id", None)
        owner_workspace_id = getattr(project, "workspace_id", None) or getattr(series, "workspace_id", None)
        owner_actor_id = getattr(project, "updated_by", None) or getattr(series, "updated_by", None)

        now = utc_now()
        job = TaskJob(
            id=f"job_{uuid.uuid4().hex[:16]}",
            task_type=task_type,
            status=TaskStatus.QUEUED,
            queue_name=queue_name,
            priority=priority,
            organization_id=owner_organization_id,
            workspace_id=owner_workspace_id,
            project_id=project_id,
            series_id=series_id,
            resource_type=resource_type,
            resource_id=resource_id,
            payload_json=payload,
            idempotency_key=idempotency_key,
            dedupe_key=dedupe_key,
            max_attempts=max_attempts,
            timeout_seconds=timeout_seconds,
            created_by=owner_actor_id,
            updated_by=owner_actor_id,
            created_at=now,
            updated_at=now,
        )
        with session_scope() as session:
            try:
                self.task_job_repository.create(job, session=session)
                # 中文注释：通用任务在入队时也会同步创建 billing_charges，
                # 这里先 flush 父表 task_jobs，确保后续 charge 的 job_id 外键在 PostgreSQL 下可见。
                session.flush()
                self.billing_service.charge_task_submission(
                    job=job,
                    actor_id=job.created_by,
                    idempotency_key=self._build_charge_idempotency_key(
                        idempotency_key=idempotency_key,
                        job_id=job.id,
                    ),
                    session=session,
                )
                self.task_event_repository.create(
                    TaskEvent(
                        id=f"evt_{uuid.uuid4().hex[:16]}",
                        job_id=job.id,
                        organization_id=job.organization_id,
                        workspace_id=job.workspace_id,
                        created_by=job.created_by,
                        updated_by=job.updated_by,
                        event_type="job.created",
                        to_status=job.status,
                        progress=0,
                        message=f"{task_type} 已入队",
                        event_payload_json={
                            "task_type": task_type,
                            "resource_type": resource_type,
                            "resource_id": resource_id,
                        },
                        created_at=now,
                        updated_at=now,
                    ),
                    session=session,
                )
            except IntegrityError:
                session.rollback()
                existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
                if existing:
                    return self._to_receipt(existing)
                raise
        logger.info("任务服务：创建任务完成 任务ID=%s 任务类型=%s 项目ID=%s 系列ID=%s", job.id, task_type, project_id, series_id)
        return self._to_receipt(job)

    def list_project_jobs(self, project_id: str, statuses: list[str] | None = None) -> list[TaskJob]:
        return self.task_job_repository.list_by_project(project_id, statuses=statuses)

    def list_jobs(
        self,
        *,
        project_id: str | None = None,
        series_id: str | None = None,
        workspace_id: str | None = None,
        statuses: list[str] | None = None,
        limit: int = 200,
    ) -> list[TaskJob]:
        """为任务中心提供聚合查询入口。"""
        return self.task_job_repository.list_jobs(
            project_id=project_id,
            series_id=series_id,
            workspace_id=workspace_id,
            statuses=statuses,
            limit=limit,
        )

    def get_job(self, job_id: str) -> TaskJob | None:
        return self.task_job_repository.get(job_id)

    def claim_next_jobs(self, queue_names: list[str], limit: int, worker_id: str) -> list[TaskJob]:
        """按组织级任务并发限制认领下一批可执行任务。"""
        return self.task_job_repository.claim_next_jobs(
            queue_names=queue_names,
            limit=limit,
            worker_id=worker_id,
            concurrency_limits=self.task_concurrency_service.get_limit_map(),
        )

    def get_job_by_idempotency_key(self, idempotency_key: str) -> TaskJob | None:
        return self.task_job_repository.get_by_idempotency_key(idempotency_key)

    def recover_stale_jobs(self, stale_after_seconds: int = 60) -> list[TaskJob]:
        """回收重启后遗留的 claimed/running 任务，避免状态永久悬空。"""
        now = utc_now()
        stale_before = now - timedelta(seconds=stale_after_seconds)
        recovered: list[TaskJob] = []
        candidates = self.task_job_repository.list_jobs(
            workspace_id=None,
            statuses=[TaskStatus.CLAIMED.value, TaskStatus.RUNNING.value],
            limit=None,
        )

        for job in candidates:
            last_seen_at = self._normalize_datetime(job.heartbeat_at or job.started_at or job.claimed_at or job.updated_at or job.created_at)
            if last_seen_at > stale_before:
                continue

            message = (
                f"worker 重启后回收僵尸任务：原状态={job.status.value}。"
                f"最后心跳时间={last_seen_at.isoformat()}。"
            )
            self._close_running_attempts(job.id, message, ended_at=now)

            if job.attempt_count >= job.max_attempts:
                recovered.append(self.mark_job_timed_out(job.id, message))
                continue

            updated = self.task_job_repository.patch(
                job.id,
                {
                    "status": TaskStatus.QUEUED.value,
                    "scheduled_at": now,
                    "claimed_at": None,
                    "started_at": None,
                    "heartbeat_at": None,
                    "finished_at": None,
                    "cancel_requested_at": None,
                    "worker_id": None,
                    "error_code": None,
                    "error_message": message,
                },
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job.id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.recovered",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=0,
                    message=message,
                    created_at=now,
                    updated_at=now,
                )
            )
            recovered.append(updated)
        return recovered

    def cancel_job(self, job_id: str) -> TaskJob:
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"任务 {job_id} 不存在")
            if job.status in {TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.TIMED_OUT}:
                return job

            now = utc_now()
            next_status = TaskStatus.CANCELLED if job.status == TaskStatus.QUEUED else TaskStatus.CANCEL_REQUESTED
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": next_status.value,
                    "cancel_requested_at": now,
                    "finished_at": now if next_status == TaskStatus.CANCELLED else None,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.cancel_requested",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=0,
                    message="已请求取消任务",
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            if next_status == TaskStatus.CANCELLED:
                self.billing_service.settle_task_charge_for_completion(
                    job=updated,
                    outcome_status=TaskStatus.CANCELLED.value,
                    actor_id=updated.updated_by,
                    session=session,
                )
            return updated

    def retry_job(self, job_id: str) -> TaskJob:
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"任务 {job_id} 不存在")
            if job.status not in {TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.CANCELLED}:
                return job
            if job.attempt_count >= job.max_attempts:
                raise TaskRetryLimitReached(f"任务 {job_id} 已达到最大重试次数")

            self.billing_service.reopen_task_charge_for_retry(job=job, actor_id=job.updated_by, session=session)

            now = utc_now()
            retry_queue_name = self._resolve_retry_queue_name(job)
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": TaskStatus.QUEUED.value,
                    "queue_name": retry_queue_name,
                    "scheduled_at": now,
                    "claimed_at": None,
                    "started_at": None,
                    "heartbeat_at": None,
                    "finished_at": None,
                    "cancel_requested_at": None,
                    "error_code": None,
                    "error_message": None,
                    "worker_id": None,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.retry_scheduled",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=0,
                    message="任务已手动重新入队",
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            return updated

    def create_attempt(self, job: TaskJob, worker_id: str) -> TaskAttempt:
        attempt = TaskAttempt(
            id=f"attempt_{uuid.uuid4().hex[:16]}",
            job_id=job.id,
            attempt_no=job.attempt_count + 1,
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            created_by=job.created_by,
            updated_by=job.updated_by,
            worker_id=worker_id,
            started_at=utc_now(),
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.task_attempt_repository.create(attempt)
        return attempt

    def mark_job_running(self, job_id: str, worker_id: str) -> TaskJob:
        job = self.task_job_repository.get(job_id)
        if not job:
            raise ValueError(f"任务 {job_id} 不存在")
        now = utc_now()
        updated = self.task_job_repository.patch(
            job_id,
            {
                "status": TaskStatus.RUNNING.value,
                "worker_id": worker_id,
                "started_at": job.started_at or now,
                "heartbeat_at": now,
                "attempt_count": job.attempt_count + 1,
            },
        )
        self.task_event_repository.create(
            TaskEvent(
                id=f"evt_{uuid.uuid4().hex[:16]}",
                job_id=job_id,
                organization_id=updated.organization_id,
                workspace_id=updated.workspace_id,
                created_by=updated.created_by,
                updated_by=updated.updated_by,
                event_type="job.started",
                from_status=job.status,
                to_status=updated.status,
                progress=1,
                message="工作线程开始执行任务",
                created_at=now,
                updated_at=now,
            )
        )
        return updated

    def heartbeat_job(self, job_id: str) -> TaskJob:
        return self.task_job_repository.patch(job_id, {"heartbeat_at": utc_now()})

    def mark_job_succeeded(self, job_id: str, result_json: dict | None = None) -> TaskJob:
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"任务 {job_id} 不存在")
            now = utc_now()
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": TaskStatus.SUCCEEDED.value,
                    "result_json": result_json,
                    "error_code": None,
                    "error_message": None,
                    "heartbeat_at": now,
                    "finished_at": now,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.succeeded",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=100,
                    message="任务执行成功",
                    event_payload_json=result_json or {},
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            charge = self.billing_service.settle_task_charge_for_completion(
                job=updated,
                outcome_status=TaskStatus.SUCCEEDED.value,
                actor_id=updated.updated_by,
                session=session,
            )
            if charge is not None and isinstance(updated.result_json, dict):
                billing_summary = {
                    "charge_status": charge.status,
                    "estimated_credits": charge.estimated_credits,
                    "final_credits": charge.final_credits,
                    "hold_transaction_id": charge.hold_transaction_id,
                    "settle_transaction_id": charge.settle_transaction_id,
                    "pricing_version": (charge.pricing_snapshot_json or {}).get("pricing_version"),
                }
                updated = self.task_job_repository.patch(
                    job_id,
                    {"result_json": {**updated.result_json, "billing_summary": billing_summary}},
                    session=session,
                )
            return updated

    def mark_job_failed(self, job_id: str, error_message: str, error_code: str | None = None) -> TaskJob:
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"Task job {job_id} not found")
            now = utc_now()
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": TaskStatus.FAILED.value,
                    "error_code": error_code,
                    "error_message": error_message,
                    "heartbeat_at": now,
                    "finished_at": now,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.failed",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=100,
                    message=error_message,
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            self.billing_service.settle_task_charge_for_completion(
                job=updated,
                outcome_status=TaskStatus.FAILED.value,
                actor_id=updated.updated_by,
                session=session,
            )
            return updated

    def mark_job_timed_out(self, job_id: str, error_message: str) -> TaskJob:
        """把已无剩余重试次数的陈旧任务标记为超时，便于前端退出等待态。"""
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"Task job {job_id} not found")
            now = utc_now()
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": TaskStatus.TIMED_OUT.value,
                    "error_code": "task_timeout",
                    "error_message": error_message,
                    "heartbeat_at": now,
                    "finished_at": now,
                    "worker_id": None,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.timed_out",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=100,
                    message=error_message,
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            self.billing_service.settle_task_charge_for_completion(
                job=updated,
                outcome_status=TaskStatus.TIMED_OUT.value,
                actor_id=updated.updated_by,
                session=session,
            )
            return updated

    def mark_job_cancelled(self, job_id: str, message: str = "Task cancelled") -> TaskJob:
        with session_scope() as session:
            job = self.task_job_repository.get(job_id, session=session)
            if not job:
                raise ValueError(f"Task job {job_id} not found")
            now = utc_now()
            updated = self.task_job_repository.patch(
                job_id,
                {
                    "status": TaskStatus.CANCELLED.value,
                    "heartbeat_at": now,
                    "finished_at": now,
                },
                session=session,
            )
            self.task_event_repository.create(
                TaskEvent(
                    id=f"evt_{uuid.uuid4().hex[:16]}",
                    job_id=job_id,
                    organization_id=updated.organization_id,
                    workspace_id=updated.workspace_id,
                    created_by=updated.created_by,
                    updated_by=updated.updated_by,
                    event_type="job.cancelled",
                    from_status=job.status,
                    to_status=updated.status,
                    progress=100,
                    message=message,
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            self.billing_service.settle_task_charge_for_completion(
                job=updated,
                outcome_status=TaskStatus.CANCELLED.value,
                actor_id=updated.updated_by,
                session=session,
            )
            return updated

    def _build_video_payload(self, video_task: VideoTask, requested_model: str | None = None) -> dict:
        return {
            "video_task_id": video_task.id,
            "project_id": video_task.project_id,
            "frame_id": video_task.frame_id,
            "asset_id": video_task.asset_id,
            "image_url": video_task.image_url,
            "prompt": video_task.prompt,
            "duration": video_task.duration,
            "seed": video_task.seed,
            "resolution": video_task.resolution,
            "generate_audio": video_task.generate_audio,
            "audio_url": video_task.audio_url,
            "prompt_extend": video_task.prompt_extend,
            "negative_prompt": video_task.negative_prompt,
            "model": video_task.model,
            "requested_model": requested_model or video_task.model,
            "shot_type": video_task.shot_type,
            "generation_mode": video_task.generation_mode,
            "reference_video_urls": video_task.reference_video_urls or [],
            "provider_params": {
                "mode": video_task.mode,
                "sound": video_task.sound,
                "cfg_scale": video_task.cfg_scale,
                "vidu_audio": video_task.vidu_audio,
                "movement_amplitude": video_task.movement_amplitude,
            },
        }

    def _build_dedupe_key(self, task_type: str, payload: dict) -> str:
        # 这里先按“资源 + 关键参数摘要”生成去重键，避免用户连续点击时产生重复长任务。
        normalized = json.dumps(payload, sort_keys=True, ensure_ascii=True)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        return f"{task_type}:{payload.get('project_id')}:{payload.get('frame_id') or payload.get('asset_id') or 'project'}:{digest}"

    def _build_generic_dedupe_key(
        self,
        task_type: str,
        payload: dict,
        project_id: str | None,
        resource_id: str | None,
        dedupe_scope: str | None,
    ) -> str:
        normalized = json.dumps(payload, sort_keys=True, ensure_ascii=True)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        scope = dedupe_scope or resource_id or "project"
        # 中文注释：统一资产链路可能同时携带 project_id 和 series_id；
        # 去重 owner 优先按 series 归并，避免同一系列资产在不同分集入口重复排队。
        owner_id = payload.get("series_id") or project_id or "global"
        return f"{task_type}:{owner_id}:{scope}:{digest}"

    def _build_charge_idempotency_key(self, *, idempotency_key: str | None, job_id: str) -> str:
        # 中文注释：显式幂等键用于“同一次提交”的重放保护；未显式传入时退回到 job_id，
        # 这样活动任务是否复用仍由 dedupe_key 控制，而历史上已经结束的同类任务可以再次提交并重新扣费。
        return f"task_charge:{idempotency_key}" if idempotency_key else f"task_charge:{job_id}"

    def _to_receipt(self, job: TaskJob, source_video_task_id: str | None = None) -> TaskReceipt:
        return TaskReceipt(
            job_id=job.id,
            task_type=job.task_type,
            status=job.status,
            queue_name=job.queue_name,
            project_id=job.project_id,
            series_id=job.series_id,
            resource_type=job.resource_type,
            resource_id=job.resource_id,
            source_video_task_id=source_video_task_id or (job.payload_json or {}).get("video_task_id"),
            created_at=job.created_at,
        )

    def _resolve_retry_queue_name(self, job: TaskJob) -> str:
        # 中文注释：系列动作参考任务重试时强制迁移到专用队列，
        # 避免历史失败任务继续在共享 video 队列被旧 worker 抢到并重复报错。
        if job.task_type == "asset.motion_ref.generate" and job.series_id:
            return "video_series_motion"
        return job.queue_name

    def _close_running_attempts(self, job_id: str, error_message: str, *, ended_at) -> None:
        # 重启恢复时同步收口 attempt，避免审计视图里一直残留 running 记录。
        for attempt in self.task_attempt_repository.list_by_job(job_id):
            if attempt.ended_at is not None or attempt.outcome != "running":
                continue
            self.task_attempt_repository.patch(
                attempt.id,
                {
                    "outcome": "failed",
                    "error_message": error_message,
                    "ended_at": ended_at,
                },
            )

    def _normalize_datetime(self, value):
        if value.tzinfo is not None:
            return value
        return value.replace(tzinfo=timezone.utc)
