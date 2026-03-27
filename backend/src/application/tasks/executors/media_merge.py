from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class MediaMergeExecutor:
    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.media_workflow.merge_videos(
            payload["project_id"],
            final_mix_timeline=payload.get("final_mix_timeline"),
        )
        return {
            "project_id": project.id,
            "merged_video_url": project.merged_video_url,
        }
