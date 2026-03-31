from .base import BaseRepository
from .mappers import _image_variant_record
from ..db.models import ImageVariantRecord
from ..schemas.models import ImageVariant
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

    def patch(self, variant_id: str, patch: dict, session=None) -> ImageVariantRecord:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, ImageVariantRecord, variant_id)
            if record is None:
                raise ValueError(f"Image variant {variant_id} not found")
            self._patch_record(record, patch)
            return record

    def soft_delete(self, variant_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            active_session.query(ImageVariantRecord).filter(
                ImageVariantRecord.id == variant_id,
                ImageVariantRecord.is_deleted.is_(False),
            ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def upsert_many(
        self,
        owner_type: str,
        owner_id: str,
        variant_group: str,
        variants: list[ImageVariant],
        tenant: dict,
        session=None,
    ) -> None:
        with self._with_session(session) as active_session:
            for variant in variants:
                existing = active_session.get(ImageVariantRecord, variant.id)
                if existing and (existing.owner_type != owner_type or existing.owner_id != owner_id or existing.variant_group != variant_group):
                    if existing.owner_type == "character_asset_unit" and owner_type == "character":
                        # 角色 legacy 容器可能引用与 unit 容器同一个候选图 ID。
                        # 这类共享行应继续以 unit owner 为唯一真相，不要在 legacy owner 下重复写一行。
                        continue
                    raise ValueError(f"Image variant {variant.id} owner mismatch")
                active_session.merge(_image_variant_record(owner_type, owner_id, variant_group, variant, tenant))

    def sync_exact(
        self,
        owner_type: str,
        owner_id: str,
        variant_group: str,
        variants: list[ImageVariant],
        tenant: dict,
        deleted_by: str | None = None,
        session=None,
    ) -> None:
        with self._with_session(session) as active_session:
            self.upsert_many(owner_type, owner_id, variant_group, variants, tenant, session=active_session)
            desired_ids = {variant.id for variant in variants}
            query = active_session.query(ImageVariantRecord).filter(
                ImageVariantRecord.owner_type == owner_type,
                ImageVariantRecord.owner_id == owner_id,
                ImageVariantRecord.variant_group == variant_group,
                ImageVariantRecord.is_deleted.is_(False),
            )
            if desired_ids:
                query = query.filter(~ImageVariantRecord.id.in_(desired_ids))
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
