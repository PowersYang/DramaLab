from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class AudioGenerateLineExecutor:
    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.media_workflow.generate_dialogue_line(
            payload["project_id"],
            payload["frame_id"],
            payload.get("speed", 1.0),
            payload.get("pitch", 1.0),
            payload.get("volume", 50),
        )
        frame = next((item for item in project.frames or [] if item.id == payload["frame_id"]), None)
        return {
            "project_id": payload["project_id"],
            "frame_id": payload["frame_id"],
            "audio_url": getattr(frame, "audio_url", None),
        }
