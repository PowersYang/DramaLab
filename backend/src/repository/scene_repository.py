from typing import List

from .base import BaseRepository
from .mappers import _insert_scene, _video_task_record, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, SceneRecord, VideoTaskRecord
from ..schemas.models import Scene


class SceneRepository(BaseRepository[Scene]):
    def list_by_owner(self, owner_type: str, owner_id: str) -> List[Scene]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}).get(owner_id)
                return project.scenes if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}).get(owner_id)
                return series.scenes if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, scene_id: str) -> Scene | None:
        for scene in self.list_by_owner(owner_type, owner_id):
            if scene.id == scene_id:
                return scene
        return None

    def save(self, owner_type: str, owner_id: str, scene: Scene) -> Scene:
        with self._with_session() as session:
            ctx = load_owner_context(session, owner_type, owner_id)
            self.delete(owner_type, owner_id, scene.id, session=session)
            _insert_scene(session, scene, owner_type, owner_id, owner_tenant_kwargs(ctx))
            if owner_type == "project":
                session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == scene.id).delete(synchronize_session=False)
                for task in scene.video_assets:
                    session.add(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return scene

    def delete(self, owner_type: str, owner_id: str, scene_id: str, session=None) -> None:
        with self._with_session(session) as active_session:
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "scene", ImageVariantRecord.owner_id == scene_id).delete(synchronize_session=False)
            active_session.query(SceneRecord).filter(SceneRecord.id == scene_id, SceneRecord.owner_type == owner_type, SceneRecord.owner_id == owner_id).delete(synchronize_session=False)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == scene_id).delete(synchronize_session=False)
