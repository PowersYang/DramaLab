from ....application.workflows import AssetWorkflow
from ....schemas.task_models import TaskJob


class AssetGenerateBatchExecutor:
    def __init__(self):
        self.asset_workflow = AssetWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.asset_workflow.generate_assets(payload["project_id"])
        return {
            "project_id": project.id,
            "character_count": len(project.characters or []),
            "scene_count": len(project.scenes or []),
            "prop_count": len(project.props or []),
        }

