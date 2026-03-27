"""
分镜帧应用服务。

这里负责分镜帧级别的 CRUD、排序和局部元数据更新，
避免分镜编辑再走旧的项目整体保存路径。
"""

import uuid

from ...common.log import get_logger
from ...repository import ProjectRepository, StoryboardFrameRepository
from ...schemas.models import StoryboardFrame
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class StoryboardFrameService:
    """负责分镜帧相关变更操作。"""

    def __init__(self):
        self.frame_repository = StoryboardFrameRepository()
        self.project_repository = ProjectRepository()

    def toggle_lock(self, project_id: str, frame_id: str):
        """切换分镜帧的人工编辑锁定状态。"""
        logger.info("STORYBOARD_FRAME_SERVICE: toggle_lock project_id=%s frame_id=%s", project_id, frame_id)
        frame = self.frame_repository.get(project_id, frame_id)
        if not frame:
            logger.warning("STORYBOARD_FRAME_SERVICE: toggle_lock frame_missing project_id=%s frame_id=%s", project_id, frame_id)
            raise ValueError(f"Frame {frame_id} not found")
        frame.locked = not frame.locked
        frame.updated_at = utc_now()
        self.frame_repository.save(project_id, frame)
        return self.project_repository.get(project_id)

    def update_frame(self, project_id: str, frame_id: str, **kwargs):
        """增量更新分镜帧的可变字段。"""
        logger.info(
            "STORYBOARD_FRAME_SERVICE: update_frame project_id=%s frame_id=%s fields=%s",
            project_id,
            frame_id,
            sorted([key for key, value in kwargs.items() if value is not None]),
        )
        frame = self.frame_repository.get(project_id, frame_id)
        if not frame:
            logger.warning("STORYBOARD_FRAME_SERVICE: update_frame frame_missing project_id=%s frame_id=%s", project_id, frame_id)
            raise ValueError(f"Frame {frame_id} not found")
        for key, value in kwargs.items():
            if value is not None and hasattr(frame, key):
                setattr(frame, key, value)
        frame.updated_at = utc_now()
        self.frame_repository.save(project_id, frame)
        return self.project_repository.get(project_id)

    def add_frame(self, project_id: str, scene_id: str | None = None, action_description: str = "", camera_angle: str = "medium_shot", insert_at: int | None = None):
        """创建新分镜帧，并可选择插入到指定位置。"""
        logger.info("STORYBOARD_FRAME_SERVICE: add_frame project_id=%s scene_id=%s insert_at=%s", project_id, scene_id, insert_at)
        project = self.project_repository.get(project_id)
        if not project:
            logger.warning("STORYBOARD_FRAME_SERVICE: add_frame project_missing project_id=%s", project_id)
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
        logger.info("STORYBOARD_FRAME_SERVICE: delete_frame project_id=%s frame_id=%s", project_id, frame_id)
        project = self.project_repository.get(project_id)
        if not project:
            logger.warning("STORYBOARD_FRAME_SERVICE: delete_frame project_missing project_id=%s", project_id)
            raise ValueError("Script not found")
        self.frame_repository.delete(project_id, frame_id)
        return self.project_repository.get(project_id)

    def copy_frame(self, project_id: str, frame_id: str, insert_at: int | None = None):
        """深拷贝一帧，便于后续局部编辑和素材分叉。"""
        logger.info("STORYBOARD_FRAME_SERVICE: copy_frame project_id=%s frame_id=%s insert_at=%s", project_id, frame_id, insert_at)
        project = self.project_repository.get(project_id)
        if not project:
            logger.warning("STORYBOARD_FRAME_SERVICE: copy_frame project_missing project_id=%s", project_id)
            raise ValueError("Script not found")
        original_frame = next((f for f in project.frames if f.id == frame_id), None)
        if not original_frame:
            logger.warning("STORYBOARD_FRAME_SERVICE: copy_frame frame_missing project_id=%s frame_id=%s", project_id, frame_id)
            raise ValueError(f"Frame {frame_id} not found")
        new_frame = original_frame.model_copy(deep=True)
        new_frame.id = f"frame_{uuid.uuid4().hex[:8]}"
        new_frame.updated_at = utc_now()
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
        logger.info("STORYBOARD_FRAME_SERVICE: reorder_frames project_id=%s frame_count=%s", project_id, len(frame_ids))
        project = self.project_repository.get(project_id)
        if not project:
            logger.warning("STORYBOARD_FRAME_SERVICE: reorder_frames project_missing project_id=%s", project_id)
            raise ValueError("Script not found")
        frame_map = {frame.id: frame for frame in project.frames}
        project.frames = [frame_map[fid] for fid in frame_ids if fid in frame_map]
        project.updated_at = utc_now()
        self._save_full_order(project)
        return self.project_repository.get(project_id)

    def _save_full_order(self, project):
        """按顺序重写分镜帧记录，因为顺序信息是单独存储的。"""
        # 分镜顺序会影响前端播放和后续视频合成，因此这里单独记录一次重排落库。
        logger.info("STORYBOARD_FRAME_SERVICE: _save_full_order project_id=%s frame_count=%s", project.id, len(project.frames))
        for index, frame in enumerate(project.frames):
            self.frame_repository.save(project.id, frame, frame_order=index)
        self.frame_repository.reorder(project.id, [frame.id for frame in project.frames])
        project = self.project_repository.get(project.id)
        self.project_repository.patch_metadata(project.id, {"updated_at": utc_now()}, expected_version=project.version)
