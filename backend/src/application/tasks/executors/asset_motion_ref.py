from ....application.workflows import AssetWorkflow
from ....common.log import get_logger
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class AssetMotionRefExecutor:
    def __init__(self):
        self.asset_workflow = AssetWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.asset_workflow.execute_motion_ref_generation(
            script_id=payload["project_id"],
            asset_id=payload["asset_id"],
            asset_type=payload["asset_type"],
            prompt=payload.get("prompt"),
            audio_url=payload.get("audio_url"),
            duration=payload.get("duration", 5),
            batch_size=payload.get("batch_size", 1),
        )
        return {
            "project_id": project.id,
            "asset_id": payload["asset_id"],
            "asset_type": payload["asset_type"],
        }

