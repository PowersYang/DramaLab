from ....application.workflows import StoryboardWorkflow
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class StoryboardRefinePromptExecutor:
    """执行分镜提示词双语润色。"""

    def __init__(self):
        self.storyboard_workflow = StoryboardWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        result = self.storyboard_workflow.refine_prompt(
            payload["project_id"],
            payload["frame_id"],
            payload.get("raw_prompt", ""),
            payload.get("assets", []),
            payload.get("feedback", ""),
        )
        metrics = attach_resource_metrics(
            self.storyboard_workflow.text_provider.get_last_metrics(),
            operation="storyboard.refine_prompt",
            resource={"project_id": payload["project_id"], "frame_id": payload["frame_id"]},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
