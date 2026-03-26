"""
分镜帧应用服务。

这里负责分镜帧级别的 CRUD、排序和局部元数据更新，
避免分镜编辑再走旧的项目整体保存路径。
"""

import time
import uuid

from ...repository import ProjectRepository, StoryboardFrameRepository
from ...schemas.models import StoryboardFrame


class StoryboardFrameService:
    """负责分镜帧相关变更操作。"""

    def __init__(self):
        self.frame_repository = StoryboardFrameRepository()
        self.project_repository = ProjectRepository()

    def toggle_lock(self, project_id: str, frame_id: str):
        """切换分镜帧的人工编辑锁定状态。"""
        frame = self.frame_repository.get(project_id, frame_id)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
        frame.locked = not frame.locked
        frame.updated_at = time.time()
        self.frame_repository.save(project_id, frame)
        return self.project_repository.get(project_id)

    def update_frame(self, project_id: str, frame_id: str, **kwargs):
        """增量更新分镜帧的可变字段。"""
        frame = self.frame_repository.get(project_id, frame_id)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
        for key, value in kwargs.items():
            if value is not None and hasattr(frame, key):
                setattr(frame, key, value)
        frame.updated_at = time.time()
        self.frame_repository.save(project_id, frame)
        return self.project_repository.get(project_id)

    def add_frame(self, project_id: str, scene_id: str | None = None, action_description: str = "", camera_angle: str = "medium_shot", insert_at: int | None = None):
        """创建新分镜帧，并可选择插入到指定位置。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        frame = StoryboardFrame(
            id=f"frame_{uuid.uuid4().hex[:8]}",
            scene_id=scene_id or (project.scenes[0].id if project.scenes else ""),
            character_ids=[],
            action_description=action_description,
            camera_angle=camera_angle,
        )
        if insert_at is None:
            self.frame_repository.save(project_id, frame)
        else:
            project.frames.insert(insert_at, frame)
            self._save_full_order(project)
        return self.project_repository.get(project_id)

    def delete_frame(self, project_id: str, frame_id: str):
        """从项目分镜中删除一帧。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        self.frame_repository.delete(project_id, frame_id)
        return self.project_repository.get(project_id)

    def copy_frame(self, project_id: str, frame_id: str, insert_at: int | None = None):
        """深拷贝一帧，便于后续局部编辑和素材分叉。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        original_frame = next((f for f in project.frames if f.id == frame_id), None)
        if not original_frame:
            raise ValueError(f"Frame {frame_id} not found")
        new_frame = original_frame.model_copy(deep=True)
        new_frame.id = f"frame_{uuid.uuid4().hex[:8]}"
        new_frame.updated_at = time.time()
        new_frame.locked = False
        if insert_at is None:
            try:
                insert_at = next(index for index, frame in enumerate(project.frames) if frame.id == frame_id) + 1
            except StopIteration:
                insert_at = len(project.frames)
        project.frames.insert(insert_at, new_frame)
        self._save_full_order(project)
        return self.project_repository.get(project_id)

    def reorder_frames(self, project_id: str, frame_ids: list[str]):
        """按调用方给定顺序重排并持久化分镜帧。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        frame_map = {frame.id: frame for frame in project.frames}
        project.frames = [frame_map[fid] for fid in frame_ids if fid in frame_map]
        project.updated_at = time.time()
        self._save_full_order(project)
        return self.project_repository.get(project_id)

    def _save_full_order(self, project):
        """按顺序重写分镜帧记录，因为顺序信息是单独存储的。"""
        for frame in list(project.frames):
            self.frame_repository.delete(project.id, frame.id)
        for index, frame in enumerate(project.frames):
            self.frame_repository.save(project.id, frame, frame_order=index)
        project = self.project_repository.get(project.id)
        project.updated_at = time.time()
        self.project_repository.save(project)
