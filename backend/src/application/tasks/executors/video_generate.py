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
        self.media_workflow.process_video_task(project_id, video_task_id)
        task = self.video_task_repository.get(project_id, video_task_id)
        if not task:
            raise RuntimeError(f"Video task {video_task_id} not found after execution")
        if task.status != "completed":
            raise RuntimeError(task.failed_reason or f"Video task finished with status={task.status}")
        return {
            "video_task_id": task.id,
            "video_url": task.video_url,
            "project_id": task.project_id,
            "frame_id": task.frame_id,
            "asset_id": task.asset_id,
        }

