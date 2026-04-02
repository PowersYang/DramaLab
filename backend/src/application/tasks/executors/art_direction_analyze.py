from ....application.services.system_service import SystemService
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class ArtDirectionAnalyzeExecutor:
    def __init__(self):
        self.system_service = SystemService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        recommendations = self.system_service.analyze_script_for_styles(
            payload["project_id"],
            payload["script_text"],
        )
        result = {
            "project_id": payload["project_id"],
            "recommendations": recommendations,
        }
        metrics = attach_resource_metrics(
            self.system_service.text_provider.get_last_metrics(),
            operation="art_direction.analyze",
            resource={"project_id": payload["project_id"]},
            artifacts={"recommendation_count": len(recommendations or [])},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
