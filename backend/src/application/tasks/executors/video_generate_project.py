from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class VideoGenerateProjectExecutor:
    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.media_workflow.generate_video(payload["project_id"])
        completed_video_count = len([frame for frame in (project.frames or []) if frame.video_url])
        return {
            "project_id": project.id,
            "completed_video_count": completed_video_count,
        }
