from ....application.services import ProjectService
from ....schemas.task_models import TaskJob


class ProjectSyncDescriptionsExecutor:
    """执行项目级描述同步。"""

    def __init__(self):
        self.project_service = ProjectService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.project_service.sync_descriptions(payload["project_id"])
        return {
            "project_id": project.id,
            "character_count": len(project.characters or []),
            "scene_count": len(project.scenes or []),
            "prop_count": len(project.props or []),
        }
