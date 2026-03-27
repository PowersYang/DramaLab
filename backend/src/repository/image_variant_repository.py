from .base import BaseRepository
from ..db.models import ImageVariantRecord
from ..utils.datetime import utc_now


class ImageVariantRepository(BaseRepository):
    def list_by_owner(self, owner_type: str, owner_id: str, variant_group: str | None = None, include_deleted: bool = False):
        with self._with_session() as session:
            query = session.query(ImageVariantRecord).filter(
                ImageVariantRecord.owner_type == owner_type,
                ImageVariantRecord.owner_id == owner_id,
            )
            if variant_group is not None:
                query = query.filter(ImageVariantRecord.variant_group == variant_group)
            if not include_deleted:
                query = query.filter(ImageVariantRecord.is_deleted.is_(False))
            return query.order_by(ImageVariantRecord.created_at).all()

    def patch(self, variant_id: str, patch: dict) -> ImageVariantRecord:
        with self._with_session() as session:
            record = self._get_active(session, ImageVariantRecord, variant_id)
            if record is None:
                raise ValueError(f"Image variant {variant_id} not found")
            self._patch_record(record, patch)
            return record

    def soft_delete(self, variant_id: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            now = utc_now()
            session.query(ImageVariantRecord).filter(
                ImageVariantRecord.id == variant_id,
                ImageVariantRecord.is_deleted.is_(False),
            ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
