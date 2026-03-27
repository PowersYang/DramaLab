import hashlib
import json
import uuid

from ...common.log import get_logger
from ...repository import ProjectRepository, TaskAttemptRepository, TaskEventRepository, TaskJobRepository, VideoTaskRepository
from ...schemas.models import VideoTask
from ...schemas.task_models import TaskAttempt, TaskEvent, TaskJob, TaskReceipt, TaskStatus, TaskType
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class TaskService:
    """统一任务服务。

    第一期先只接管视频生成任务：
    API 侧创建业务占位 VideoTask 后，再通过这里落独立 TaskJob，
    后续 worker 只和 TaskJob 打交道。
    """

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.video_task_repository = VideoTaskRepository()
        self.task_job_repository = TaskJobRepository()
        self.task_attempt_repository = TaskAttemptRepository()
        self.task_event_repository = TaskEventRepository()

    def create_video_generation_job(
        self,
        *,
        video_task: VideoTask,
        task_type: str,
        queue_name: str = "video",
        resource_type: str | None = None,
        resource_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> TaskReceipt:
        project = self.project_repository.get(video_task.project_id)
        if not project:
            raise ValueError("Project not found")

        if idempotency_key:
            existing = self.task_job_repository.get_by_idempotency_key(idempotency_key)
            if existing:
                logger.info("TASK_SERVICE: reuse_by_idempotency job_id=%s key=%s", existing.id, idempotency_key)
                return self._to_receipt(existing)

        payload = self._build_video_payload(video_task)
        dedupe_key = self._build_dedupe_key(task_type, payload)
        existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
        if existing:
            logger.info("TASK_SERVICE: reuse_by_dedupe job_id=%s dedupe_key=%s", existing.id, dedupe_key)
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
        self.task_job_repository.create(job)
        video_task.source_job_id = job.id
        self.video_task_repository.save(video_task)
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
                message="Video generation job queued",
                event_payload_json={
                    "task_type": task_type,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "source_video_task_id": video_task.id,
                },
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )
        logger.info(
            "TASK_SERVICE: create_video_generation_job job_id=%s task_type=%s project_id=%s source_video_task_id=%s",
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
        if project_id and not project:
            raise ValueError("Project not found")

        if idempotency_key:
            existing = self.task_job_repository.get_by_idempotency_key(idempotency_key)
            if existing:
                logger.info("TASK_SERVICE: reuse_generic_by_idempotency job_id=%s key=%s", existing.id, idempotency_key)
                return self._to_receipt(existing)

        dedupe_key = self._build_generic_dedupe_key(task_type, payload, project_id, resource_id, dedupe_scope)
        existing = self.task_job_repository.get_active_by_dedupe_key(dedupe_key)
        if existing:
            logger.info("TASK_SERVICE: reuse_generic_by_dedupe job_id=%s dedupe_key=%s", existing.id, dedupe_key)
            return self._to_receipt(existing)

        now = utc_now()
        job = TaskJob(
            id=f"job_{uuid.uuid4().hex[:16]}",
            task_type=task_type,
            status=TaskStatus.QUEUED,
            queue_name=queue_name,
            priority=priority,
            organization_id=getattr(project, "organization_id", None),
            workspace_id=getattr(project, "workspace_id", None),
            project_id=project_id,
            series_id=series_id,
            resource_type=resource_type,
            resource_id=resource_id,
            payload_json=payload,
            idempotency_key=idempotency_key,
            dedupe_key=dedupe_key,
            max_attempts=max_attempts,
            timeout_seconds=timeout_seconds,
            created_by=getattr(project, "updated_by", None),
            updated_by=getattr(project, "updated_by", None),
            created_at=now,
            updated_at=now,
        )
        self.task_job_repository.create(job)
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
                message=f"{task_type} queued",
                event_payload_json={
                    "task_type": task_type,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                },
                created_at=now,
                updated_at=now,
            )
        )
        logger.info("TASK_SERVICE: create_job job_id=%s task_type=%s project_id=%s series_id=%s", job.id, task_type, project_id, series_id)
        return self._to_receipt(job)

    def list_project_jobs(self, project_id: str, statuses: list[str] | None = None) -> list[TaskJob]:
        return self.task_job_repository.list_by_project(project_id, statuses=statuses)

    def get_job(self, job_id: str) -> TaskJob | None:
        return self.task_job_repository.get(job_id)

    def get_job_by_idempotency_key(self, idempotency_key: str) -> TaskJob | None:
        return self.task_job_repository.get_by_idempotency_key(idempotency_key)

    def cancel_job(self, job_id: str) -> TaskJob:
        job = self.task_job_repository.get(job_id)
        if not job:
            raise ValueError(f"Task job {job_id} not found")
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
                message="Task cancellation requested",
                created_at=now,
                updated_at=now,
            )
        )
        return updated

    def retry_job(self, job_id: str) -> TaskJob:
        job = self.task_job_repository.get(job_id)
        if not job:
            raise ValueError(f"Task job {job_id} not found")
        if job.status not in {TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.CANCELLED}:
            return job

        now = utc_now()
        updated = self.task_job_repository.patch(
            job_id,
            {
                "status": TaskStatus.QUEUED.value,
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
                message="Task re-queued manually",
                created_at=now,
                updated_at=now,
            )
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
            raise ValueError(f"Task job {job_id} not found")
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
                message="Worker started executing task",
                created_at=now,
                updated_at=now,
            )
        )
        return updated

    def heartbeat_job(self, job_id: str) -> TaskJob:
        return self.task_job_repository.patch(job_id, {"heartbeat_at": utc_now()})

    def mark_job_succeeded(self, job_id: str, result_json: dict | None = None) -> TaskJob:
        job = self.task_job_repository.get(job_id)
        if not job:
            raise ValueError(f"Task job {job_id} not found")
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
                message="Task finished successfully",
                event_payload_json=result_json or {},
                created_at=now,
                updated_at=now,
            )
        )
        return updated

    def mark_job_failed(self, job_id: str, error_message: str, error_code: str | None = None) -> TaskJob:
        job = self.task_job_repository.get(job_id)
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
            )
        )
        return updated

    def mark_job_cancelled(self, job_id: str, message: str = "Task cancelled") -> TaskJob:
        job = self.task_job_repository.get(job_id)
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
            )
        )
        return updated

    def _build_video_payload(self, video_task: VideoTask) -> dict:
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
        project_id: str,
        resource_id: str | None,
        dedupe_scope: str | None,
    ) -> str:
        normalized = json.dumps(payload, sort_keys=True, ensure_ascii=True)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        scope = dedupe_scope or resource_id or "project"
        return f"{task_type}:{project_id}:{scope}:{digest}"

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
