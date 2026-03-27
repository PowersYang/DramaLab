from ....application.workflows import StoryboardWorkflow
from ....schemas.task_models import TaskJob


class StoryboardGenerateAllExecutor:
    def __init__(self):
        self.storyboard_workflow = StoryboardWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.storyboard_workflow.generate_storyboard(payload["project_id"])
        return {
            "project_id": project.id,
            "frame_count": len(project.frames or []),
        }

