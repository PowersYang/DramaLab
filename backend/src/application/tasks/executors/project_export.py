from ....application.workflows import MediaWorkflow
from ....schemas.task_models import TaskJob


class ProjectExportExecutor:
    def __init__(self):
        self.media_workflow = MediaWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        result = self.media_workflow.export_project(
            payload["project_id"],
            payload.get("options", {}),
        )
        return {
            "project_id": payload["project_id"],
            "url": result.get("url"),
            "options": payload.get("options", {}),
        }
