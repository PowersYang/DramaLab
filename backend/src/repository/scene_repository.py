from typing import List

from .base import BaseRepository
from .image_variant_repository import ImageVariantRepository
from .mappers import _audit_time_kwargs, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, SceneRecord, VideoTaskRecord
from ..schemas.models import Scene
from ..utils.datetime import utc_now


class SceneRepository(BaseRepository[Scene]):
    def __init__(self):
        self.image_variant_repository = ImageVariantRepository()

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

    def create(self, owner_type: str, owner_id: str, scene: Scene, session=None) -> Scene:
        with self._with_session(session) as active_session:
            ctx = load_owner_context(active_session, owner_type, owner_id)
            tenant = owner_tenant_kwargs(ctx)
            active_session.merge(
                SceneRecord(
                    id=scene.id,
                    owner_type=owner_type,
                    owner_id=owner_id,
                    name=scene.name,
                    description=scene.description,
                    visual_weight=scene.visual_weight,
                    time_of_day=scene.time_of_day,
                    lighting_mood=scene.lighting_mood,
                    image_url=scene.image_url,
                    image_selected_id=(scene.image_asset.selected_id if scene.image_asset else None),
                    video_prompt=scene.video_prompt,
                    locked=scene.locked,
                    status=scene.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **tenant,
                    **_audit_time_kwargs(scene),
                )
            )
            self.image_variant_repository.sync_exact(
                "scene",
                scene.id,
                "image_asset",
                list(scene.image_asset.variants if scene.image_asset else []),
                tenant,
                session=active_session,
            )
        return scene

    def patch(self, owner_type: str, owner_id: str, scene_id: str, patch: dict, session=None) -> Scene:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, SceneRecord, scene_id)
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

    def save(self, owner_type: str, owner_id: str, scene: Scene, session=None) -> Scene:
        return self.create(owner_type, owner_id, scene, session=session)

    def delete(self, owner_type: str, owner_id: str, scene_id: str, session=None) -> None:
        self.soft_delete(owner_type, owner_id, scene_id, session=session)
