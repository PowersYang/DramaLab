"""
道具应用服务。

这里承接道具相关变更，使其能独立于项目聚合整体读写周期演进。
"""

import uuid

from ...repository import ProjectRepository, PropRepository, SeriesRepository
from .project_command_service import ProjectCommandService
from ...schemas.models import GenerationStatus, Prop
from ...utils.datetime import utc_now


class PropService:
    """负责道具资源相关应用操作。"""

    def __init__(self):
        self.prop_repository = PropRepository()
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
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
        # 中文注释：系列项目中新建道具默认沉淀到系列资产库，确保可跨分集复用。
        if project.series_id:
            self.prop_repository.save("series", project.series_id, prop)
        else:
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
        if project.series_id:
            # 中文注释：系列项目里删除系列道具时只清理当前分集引用，避免误删共享主档。
            series = self.series_repository.get(project.series_id)
            is_series_prop = bool(series and any(item.id == prop_id for item in (series.props or [])))
            if is_series_prop:
                return self.project_command_service.sync_frames(
                    project_id,
                    project.version,
                    [frame for frame in project.frames],
                )
        return self.project_command_service.delete_asset_and_cleanup_frames(project_id, project.version, "prop", prop_id, cleaned_frames=cleaned_frames)
