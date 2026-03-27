from typing import List

from .base import BaseRepository
from .mappers import _insert_scene, _video_task_record, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, SceneRecord, VideoTaskRecord
from ..schemas.models import Scene
from ..utils.datetime import utc_now


class SceneRepository(BaseRepository[Scene]):
    def list_by_owner(self, owner_type: str, owner_id: str, include_deleted: bool = False) -> List[Scene]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return project.scenes if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return series.scenes if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, scene_id: str, include_deleted: bool = False) -> Scene | None:
        for scene in self.list_by_owner(owner_type, owner_id, include_deleted=include_deleted):
            if scene.id == scene_id:
                return scene
        return None

    def create(self, owner_type: str, owner_id: str, scene: Scene) -> Scene:
        with self._with_session() as session:
            ctx = load_owner_context(session, owner_type, owner_id)
            _insert_scene(session, scene, owner_type, owner_id, owner_tenant_kwargs(ctx))
            if owner_type == "project":
                for task in scene.video_assets:
                    session.merge(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return scene

    def patch(self, owner_type: str, owner_id: str, scene_id: str, patch: dict) -> Scene:
        with self._with_session() as session:
            record = self._get_active(session, SceneRecord, scene_id)
            if record is None or record.owner_type != owner_type or record.owner_id != owner_id:
                raise ValueError(f"Scene {scene_id} not found")
            self._patch_record(record, patch)
            return self.get(owner_type, owner_id, scene_id)

    def soft_delete(self, owner_type: str, owner_id: str, scene_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "scene", ImageVariantRecord.owner_id == scene_id, ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            active_session.query(SceneRecord).filter(SceneRecord.id == scene_id, SceneRecord.owner_type == owner_type, SceneRecord.owner_id == owner_id, SceneRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == scene_id, VideoTaskRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def save(self, owner_type: str, owner_id: str, scene: Scene) -> Scene:
        self.soft_delete(owner_type, owner_id, scene.id)
        return self.create(owner_type, owner_id, scene)

    def delete(self, owner_type: str, owner_id: str, scene_id: str, session=None) -> None:
        self.soft_delete(owner_type, owner_id, scene_id, session=session)
