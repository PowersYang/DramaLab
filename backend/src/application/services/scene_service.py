"""
场景应用服务。

场景 CRUD 统一放在这里，避免控制器再通过单体式 pipeline 更新整个项目聚合。
"""

import uuid

from ...repository import ProjectRepository, SceneRepository, SeriesRepository
from .project_command_service import ProjectCommandService
from ...schemas.models import GenerationStatus, Scene
from ...utils.datetime import utc_now


class SceneService:
    """负责场景资源相关应用操作。"""

    def __init__(self):
        self.scene_repository = SceneRepository()
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.project_command_service = ProjectCommandService()

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
        # 中文注释：系列项目中新建场景默认落到系列资产库，保证其他分集可以直接复用。
        if project.series_id:
            self.scene_repository.save("series", project.series_id, scene)
        else:
            self.scene_repository.save("project", project_id, scene)
        return self.project_repository.get(project_id)

    def delete_scene(self, project_id: str, scene_id: str):
        """删除场景，并清理分镜帧里指向它的引用。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        cleaned_frames = []
        for frame in project.frames:
            if frame.scene_id == scene_id:
                frame.scene_id = ""
                frame.updated_at = utc_now()
                cleaned_frames.append(frame)
        if project.series_id:
            # 中文注释：分集里删除系列场景时只解除当前分集引用，不直接删系列主档，避免影响其他分集。
            series = self.series_repository.get(project.series_id)
            is_series_scene = bool(series and any(item.id == scene_id for item in (series.scenes or [])))
            if is_series_scene:
                return self.project_command_service.sync_frames(
                    project_id,
                    project.version,
                    [frame for frame in project.frames],
                )
        return self.project_command_service.delete_asset_and_cleanup_frames(project_id, project.version, "scene", scene_id, cleaned_frames=cleaned_frames)
