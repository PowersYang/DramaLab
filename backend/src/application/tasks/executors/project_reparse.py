from ....application.services import ProjectService
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class ProjectReparseExecutor:
    """执行项目长文本重解析。"""

    def __init__(self):
        self.project_service = ProjectService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.project_service.reparse_project(
            payload["project_id"],
            payload["text"],
        )
        result = {
            "project_id": project.id,
            "character_count": len(project.characters or []),
            "scene_count": len(project.scenes or []),
            "prop_count": len(project.props or []),
        }
        metrics = attach_resource_metrics(
            self.project_service.text_provider.get_last_metrics(),
            operation="project.reparse",
            resource={"project_id": project.id},
            artifacts={
                "character_count": len(project.characters or []),
                "scene_count": len(project.scenes or []),
                "prop_count": len(project.props or []),
            },
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
