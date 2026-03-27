from ....application.services.system_service import SystemService
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
        return {
            "project_id": payload["project_id"],
            "recommendations": recommendations,
        }

