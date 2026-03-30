from ....application.services import ProjectService
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
        return {
            "project_id": project.id,
            "character_count": len(project.characters or []),
            "scene_count": len(project.scenes or []),
            "prop_count": len(project.props or []),
        }
