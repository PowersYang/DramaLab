import time

from ....application.workflows import MediaWorkflow
from ....common.log import get_logger
from ....repository import VideoTaskRepository
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class VideoGenerateExecutor:
    """统一的视频任务执行器。

    第一期先复用既有 MediaWorkflow 的视频生成能力，
    这样我们可以先完成“独立 worker + 统一任务状态”的迁移，
    再逐步把 workflow 继续拆细。
    """

    def __init__(self):
        self.media_workflow = MediaWorkflow()
        self.video_task_repository = VideoTaskRepository()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project_id = payload["project_id"]
        video_task_id = payload["video_task_id"]
        logger.info(
            "VIDEO_GENERATE_EXECUTOR: execute job_id=%s project_id=%s video_task_id=%s",
            job.id,
            project_id,
            video_task_id,
        )
        started_at = time.monotonic()
        self.media_workflow.process_video_task(project_id, video_task_id)
        elapsed_seconds = max(0.0, time.monotonic() - started_at)
        task = self.video_task_repository.get(project_id, video_task_id)
        if not task:
            raise RuntimeError(f"Video task {video_task_id} not found after execution")
        if task.status != "completed":
            raise RuntimeError(task.failed_reason or f"Video task finished with status={task.status}")
        model_prefix = (task.model or "").split("-")[0].lower() if task.model else ""
        provider_name = "WANX"
        if model_prefix.startswith("kling"):
            provider_name = "KLING"
        elif model_prefix.startswith("vidu"):
            provider_name = "VIDU"
        return {
            "__metrics__": {
                "version": "v1",
                "provider": {"name": provider_name, "model": task.model},
                "usage": {"seconds": elapsed_seconds, "duration": task.duration},
                "cost": {"amount": None, "currency": "UNKNOWN", "pricing_basis": "estimated"},
                "artifacts": {"resolution": task.resolution, "generation_mode": task.generation_mode},
                "resource": {"project_id": task.project_id, "frame_id": task.frame_id, "asset_id": task.asset_id},
                "supplier_reference": {"task_id": task.provider_task_id, "request_id": None},
            },
            "video_task_id": task.id,
            "video_url": task.video_url,
            "project_id": task.project_id,
            "frame_id": task.frame_id,
            "asset_id": task.asset_id,
            "requested_model": payload.get("requested_model") or payload.get("model") or task.model,
            "resolved_model": task.model,
            "fallback_reason": (
                f"任务请求模型 {payload.get('requested_model')}，系统实际执行模型为 {task.model}"
                if payload.get("requested_model") and payload.get("requested_model") != task.model
                else None
            ),
        }
