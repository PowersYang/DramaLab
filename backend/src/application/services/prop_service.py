"""
道具应用服务。

这里承接道具相关变更，使其能独立于项目聚合整体读写周期演进。
"""

import uuid

from ...repository import ProjectRepository, PropRepository
from .project_command_service import ProjectCommandService
from ...schemas.models import GenerationStatus, Prop
from ...utils.datetime import utc_now


class PropService:
    """负责道具资源相关应用操作。"""

    def __init__(self):
        self.prop_repository = PropRepository()
        self.project_repository = ProjectRepository()
        self.project_command_service = ProjectCommandService()

    def create_prop(self, project_id: str, name: str, description: str):
        """在目标项目中创建一个新道具。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        prop = Prop(
            id=f"prop_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description,
            status=GenerationStatus.PENDING,
        )
        self.prop_repository.save("project", project_id, prop)
        return self.project_repository.get(project_id)

    def delete_prop(self, project_id: str, prop_id: str):
        """删除道具，并清理分镜帧里的关联引用。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        cleaned_frames = []
        for frame in project.frames:
            if prop_id in frame.prop_ids:
                frame.prop_ids = [pid for pid in frame.prop_ids if pid != prop_id]
                frame.updated_at = utc_now()
                cleaned_frames.append(frame)
        return self.project_command_service.delete_asset_and_cleanup_frames(project_id, project.version, "prop", prop_id, cleaned_frames=cleaned_frames)
