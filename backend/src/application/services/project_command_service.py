"""
项目跨对象命令服务。

这里只保留需要跨多个子对象协同落库的命令，不承接普通单对象 CRUD。
"""

from typing import Callable

from ...db.models import CharacterRecord, PropRecord, SceneRecord, StoryboardFrameRecord
from ...db.session import session_scope
from ...repository import (
    CharacterRepository,
    ProjectRepository,
    PropRepository,
    SceneRepository,
    StoryboardFrameRepository,
)


class ProjectCommandService:
    """负责项目级跨对象命令。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.character_repository = CharacterRepository()
        self.scene_repository = SceneRepository()
        self.prop_repository = PropRepository()
        self.frame_repository = StoryboardFrameRepository()

    def delete_asset_and_cleanup_frames(
        self,
        project_id: str,
        expected_version: int,
        asset_type: str,
        asset_id: str,
        cleaned_frames=None,
    ):
        cleaned_frames = cleaned_frames or []

        def mutation(session):
            repository = self._asset_repository(asset_type)
            repository.delete("project", project_id, asset_id, session=session)
            for frame in cleaned_frames:
                self.frame_repository.save(project_id, frame, session=session)

        return self._run(project_id, expected_version, mutation)

    def sync_frames(self, project_id: str, expected_version: int, frames: list):
        desired_ids = {frame.id for frame in frames}

        def mutation(session):
            existing_ids = {
                row[0]
                for row in session.query(StoryboardFrameRecord.id).filter(
                    StoryboardFrameRecord.project_id == project_id,
                    StoryboardFrameRecord.is_deleted.is_(False),
                ).all()
            }
            for frame_id in existing_ids - desired_ids:
                self.frame_repository.delete(project_id, frame_id, session=session)
            for index, frame in enumerate(frames):
                self.frame_repository.save(project_id, frame, frame_order=index, session=session)
            self.frame_repository.reorder(project_id, [frame.id for frame in frames], session=session)

        return self._run(project_id, expected_version, mutation)

    def sync_entities(self, project_id: str, expected_version: int, characters: list, scenes: list, props: list):
        desired_character_ids = {item.id for item in characters}
        desired_scene_ids = {item.id for item in scenes}
        desired_prop_ids = {item.id for item in props}

        def mutation(session):
            existing_character_ids = {
                row[0]
                for row in session.query(CharacterRecord.id).filter(
                    CharacterRecord.owner_type == "project",
                    CharacterRecord.owner_id == project_id,
                    CharacterRecord.is_deleted.is_(False),
                ).all()
            }
            existing_scene_ids = {
                row[0]
                for row in session.query(SceneRecord.id).filter(
                    SceneRecord.owner_type == "project",
                    SceneRecord.owner_id == project_id,
                    SceneRecord.is_deleted.is_(False),
                ).all()
            }
            existing_prop_ids = {
                row[0]
                for row in session.query(PropRecord.id).filter(
                    PropRecord.owner_type == "project",
                    PropRecord.owner_id == project_id,
                    PropRecord.is_deleted.is_(False),
                ).all()
            }

            for item in characters:
                self.character_repository.save("project", project_id, item, session=session)
            for item in scenes:
                self.scene_repository.save("project", project_id, item, session=session)
            for item in props:
                self.prop_repository.save("project", project_id, item, session=session)

            for item_id in existing_character_ids - desired_character_ids:
                self.character_repository.delete("project", project_id, item_id, session=session)
            for item_id in existing_scene_ids - desired_scene_ids:
                self.scene_repository.delete("project", project_id, item_id, session=session)
            for item_id in existing_prop_ids - desired_prop_ids:
                self.prop_repository.delete("project", project_id, item_id, session=session)

        return self._run(project_id, expected_version, mutation)

    def _run(self, project_id: str, expected_version: int, mutator: Callable) -> object:
        current_expected_version = expected_version
        for attempt in range(2):
            try:
                with session_scope() as session:
                    mutator(session)
                    self.project_repository.touch(project_id, current_expected_version, session=session)
                project = self.project_repository.get(project_id)
                if project is None:
                    raise ValueError(f"Project {project_id} not found")
                return project
            except ValueError as exc:
                if "version conflict" not in str(exc) or attempt > 0:
                    raise
                latest = self.project_repository.get(project_id)
                if latest is None:
                    raise ValueError(f"Project {project_id} not found") from exc
                current_expected_version = latest.version
        raise ValueError(f"Project {project_id} version conflict")

    def _asset_repository(self, asset_type: str):
        if asset_type == "character":
            return self.character_repository
        if asset_type == "scene":
            return self.scene_repository
        if asset_type == "prop":
            return self.prop_repository
        raise ValueError(f"Unsupported asset_type: {asset_type}")
