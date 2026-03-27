"""
场景应用服务。

场景 CRUD 统一放在这里，避免控制器再通过单体式 pipeline 更新整个项目聚合。
"""

import uuid

from ...repository import ProjectRepository, SceneRepository
from ...schemas.models import GenerationStatus, Scene
from ...utils.datetime import utc_now


class SceneService:
    """负责场景资源相关应用操作。"""

    def __init__(self):
        self.scene_repository = SceneRepository()
        self.project_repository = ProjectRepository()

    def create_scene(self, project_id: str, name: str, description: str):
        """在目标项目中创建一个新场景。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        scene = Scene(
            id=f"scene_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description,
            status=GenerationStatus.PENDING,
        )
        self.scene_repository.save("project", project_id, scene)
        return self.project_repository.get(project_id)

    def delete_scene(self, project_id: str, scene_id: str):
        """删除场景，并清理分镜帧里指向它的引用。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        self.scene_repository.delete("project", project_id, scene_id)
        for frame in project.frames:
            if frame.scene_id == scene_id:
                frame.scene_id = ""
        project.scenes = [s for s in project.scenes if s.id != scene_id]
        project.updated_at = utc_now()
        return self.project_repository.replace_graph(project)
