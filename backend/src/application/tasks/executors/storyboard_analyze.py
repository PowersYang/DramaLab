from ....application.workflows import StoryboardWorkflow
from ....common.log import get_logger
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
        return {
            "project_id": project.id,
            "frame_count": len(project.frames or []),
        }

