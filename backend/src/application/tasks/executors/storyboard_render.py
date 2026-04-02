from ....application.workflows import StoryboardWorkflow
from ....common.log import get_logger
from ..metrics import attach_resource_metrics
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
        result = {
            "project_id": project.id,
            "frame_id": payload["frame_id"],
        }
        metrics = attach_resource_metrics(
            self.storyboard_workflow.image_provider.last_generation_metrics,
            operation="storyboard.render",
            resource={"project_id": payload["project_id"], "frame_id": payload["frame_id"]},
            artifacts={"batch_size": payload.get("batch_size", 1)},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
