from ....application.workflows import StoryboardWorkflow
from ....common.log import get_logger
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class StoryboardAnalyzeExecutor:
    def __init__(self):
        self.storyboard_workflow = StoryboardWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.storyboard_workflow.analyze_to_storyboard(
            payload["project_id"],
            payload["text"],
        )
        result = {
            "project_id": project.id,
            "frame_count": len(project.frames or []),
        }
        metrics = attach_resource_metrics(
            self.storyboard_workflow.text_provider.get_last_metrics(),
            operation="storyboard.analyze",
            resource={"project_id": project.id},
            artifacts={"frame_count": len(project.frames or [])},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
