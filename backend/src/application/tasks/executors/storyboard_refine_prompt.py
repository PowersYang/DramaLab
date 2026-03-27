from ....application.workflows import StoryboardWorkflow
from ....schemas.task_models import TaskJob


class StoryboardRefinePromptExecutor:
    """执行分镜提示词双语润色。"""

    def __init__(self):
        self.storyboard_workflow = StoryboardWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        return self.storyboard_workflow.refine_prompt(
            payload["project_id"],
            payload["frame_id"],
            payload.get("raw_prompt", ""),
            payload.get("assets", []),
            payload.get("feedback", ""),
        )
