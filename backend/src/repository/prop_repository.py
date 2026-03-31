from typing import List

from .base import BaseRepository
from .image_variant_repository import ImageVariantRepository
from .mappers import _audit_time_kwargs, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, PropRecord, VideoTaskRecord
from ..schemas.models import Prop
from ..utils.datetime import utc_now


class PropRepository(BaseRepository[Prop]):
    def __init__(self):
        self.image_variant_repository = ImageVariantRepository()

    def list_by_owner(self, owner_type: str, owner_id: str, include_deleted: bool = False) -> List[Prop]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return project.props if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return series.props if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, prop_id: str, include_deleted: bool = False) -> Prop | None:
        for prop in self.list_by_owner(owner_type, owner_id, include_deleted=include_deleted):
            if prop.id == prop_id:
                return prop
        return None

    def create(self, owner_type: str, owner_id: str, prop: Prop, session=None) -> Prop:
        with self._with_session(session) as active_session:
            ctx = load_owner_context(active_session, owner_type, owner_id)
            tenant = owner_tenant_kwargs(ctx)
            active_session.merge(
                PropRecord(
                    id=prop.id,
                    owner_type=owner_type,
                    owner_id=owner_id,
                    name=prop.name,
                    description=prop.description,
                    video_url=prop.video_url,
                    audio_url=prop.audio_url,
                    sfx_url=prop.sfx_url,
                    bgm_url=prop.bgm_url,
                    image_url=prop.image_url,
                    image_selected_id=(prop.image_asset.selected_id if prop.image_asset else None),
                    video_prompt=prop.video_prompt,
                    locked=prop.locked,
                    status=prop.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **tenant,
                    **_audit_time_kwargs(prop),
                )
            )
            self.image_variant_repository.sync_exact(
                "prop",
                prop.id,
                "image_asset",
                list(prop.image_asset.variants if prop.image_asset else []),
                tenant,
                session=active_session,
            )
        return prop

    def patch(self, owner_type: str, owner_id: str, prop_id: str, patch: dict, session=None) -> Prop:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, PropRecord, prop_id)
            if record is None or record.owner_type != owner_type or record.owner_id != owner_id:
                raise ValueError(f"Prop {prop_id} not found")
            self._patch_record(record, patch)
            return self.get(owner_type, owner_id, prop_id)

    def soft_delete(self, owner_type: str, owner_id: str, prop_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "prop", ImageVariantRecord.owner_id == prop_id, ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            active_session.query(PropRecord).filter(PropRecord.id == prop_id, PropRecord.owner_type == owner_type, PropRecord.owner_id == owner_id, PropRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == prop_id, VideoTaskRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def save(self, owner_type: str, owner_id: str, prop: Prop, session=None) -> Prop:
        return self.create(owner_type, owner_id, prop, session=session)

    def delete(self, owner_type: str, owner_id: str, prop_id: str, session=None) -> None:
        self.soft_delete(owner_type, owner_id, prop_id, session=session)
