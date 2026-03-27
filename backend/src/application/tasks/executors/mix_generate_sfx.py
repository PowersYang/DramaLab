from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class MixGenerateSfxExecutor:
    """当前先复用整项目音频生成流程，保持旧接口行为一致。"""

    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.media_workflow.generate_audio(payload["project_id"])
        sfx_frame_count = len([frame for frame in (project.frames or []) if frame.sfx_url])
        return {
            "project_id": project.id,
            "sfx_frame_count": sfx_frame_count,
        }
