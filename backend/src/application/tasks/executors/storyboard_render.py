from ....application.workflows import StoryboardWorkflow
from ....common.log import get_logger
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class StoryboardRenderExecutor:
    def __init__(self):
        self.storyboard_workflow = StoryboardWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.storyboard_workflow.render_frame(
            payload["project_id"],
            payload["frame_id"],
            payload.get("composition_data"),
            payload.get("prompt", ""),
            payload.get("batch_size", 1),
        )
        return {
            "project_id": project.id,
            "frame_id": payload["frame_id"],
        }

