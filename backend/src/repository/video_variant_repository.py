from .base import BaseRepository
from ..db.models import VideoVariantRecord
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

    def patch(self, variant_id: str, patch: dict) -> VideoVariantRecord:
        with self._with_session() as session:
            record = self._get_active(session, VideoVariantRecord, variant_id)
            if record is None:
                raise ValueError(f"Video variant {variant_id} not found")
            self._patch_record(record, patch)
            return record

    def soft_delete(self, variant_id: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            now = utc_now()
            session.query(VideoVariantRecord).filter(
                VideoVariantRecord.id == variant_id,
                VideoVariantRecord.is_deleted.is_(False),
            ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
