from .base import BaseRepository
from .mappers import _video_variant_record
from ..db.models import VideoVariantRecord
from ..schemas.models import VideoVariant
from ..utils.datetime import utc_now


class VideoVariantRepository(BaseRepository):
    def list_by_owner(self, owner_type: str, owner_id: str, variant_group: str | None = None, include_deleted: bool = False):
        with self._with_session() as session:
            query = session.query(VideoVariantRecord).filter(
                VideoVariantRecord.owner_type == owner_type,
                VideoVariantRecord.owner_id == owner_id,
            )
            if variant_group is not None:
                query = query.filter(VideoVariantRecord.variant_group == variant_group)
            if not include_deleted:
                query = query.filter(VideoVariantRecord.is_deleted.is_(False))
            return query.order_by(VideoVariantRecord.created_at).all()

    def patch(self, variant_id: str, patch: dict, session=None) -> VideoVariantRecord:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, VideoVariantRecord, variant_id)
            if record is None:
                raise ValueError(f"Video variant {variant_id} not found")
            self._patch_record(record, patch)
            return record

    def soft_delete(self, variant_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            active_session.query(VideoVariantRecord).filter(
                VideoVariantRecord.id == variant_id,
                VideoVariantRecord.is_deleted.is_(False),
            ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def upsert_many(
        self,
        owner_type: str,
        owner_id: str,
        variant_group: str,
        variants: list[VideoVariant],
        tenant: dict,
        session=None,
    ) -> None:
        with self._with_session(session) as active_session:
            for variant in variants:
                existing = active_session.get(VideoVariantRecord, variant.id)
                if existing and (existing.owner_type != owner_type or existing.owner_id != owner_id or existing.variant_group != variant_group):
                    raise ValueError(f"Video variant {variant.id} owner mismatch")
                active_session.merge(_video_variant_record(owner_type, owner_id, variant_group, variant, tenant))

    def sync_exact(
        self,
        owner_type: str,
        owner_id: str,
        variant_group: str,
        variants: list[VideoVariant],
        tenant: dict,
        deleted_by: str | None = None,
        session=None,
    ) -> None:
        with self._with_session(session) as active_session:
            self.upsert_many(owner_type, owner_id, variant_group, variants, tenant, session=active_session)
            desired_ids = {variant.id for variant in variants}
            query = active_session.query(VideoVariantRecord).filter(
                VideoVariantRecord.owner_type == owner_type,
                VideoVariantRecord.owner_id == owner_id,
                VideoVariantRecord.variant_group == variant_group,
                VideoVariantRecord.is_deleted.is_(False),
            )
            if desired_ids:
                query = query.filter(~VideoVariantRecord.id.in_(desired_ids))
            now = utc_now()
            query.update(
                {
                    "is_deleted": True,
                    "deleted_at": now,
                    "updated_at": now,
                    "deleted_by": deleted_by,
                },
                synchronize_session=False,
            )
