from .base import BaseRepository
from .character_repository import CharacterRepository
from .mappers import _audit_time_kwargs, _image_variant_record, _new_id, _video_variant_record
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoVariantRecord
from ..schemas.models import AssetUnit
from ..utils.datetime import utc_now


class CharacterAssetUnitRepository(BaseRepository[AssetUnit]):
    def get(self, owner_type: str, owner_id: str, character_id: str, unit_type: str, include_deleted: bool = False) -> AssetUnit | None:
        repo = CharacterRepository()
        character = repo.get(owner_type, owner_id, character_id, include_deleted=include_deleted)
        if character is None:
            return None
        return getattr(character, unit_type, None)

    def create(self, character_id: str, unit_type: str, unit: AssetUnit) -> AssetUnit:
        with self._with_session() as session:
            character = session.get(CharacterRecord, character_id)
            if character is None or character.is_deleted:
                raise ValueError(f"character {character_id} not found")
            ctx = load_owner_context(session, "character", character_id)
            unit_id = f"{character_id}_{unit_type}"
            session.merge(
                CharacterAssetUnitRecord(
                    id=unit_id,
                    character_id=character_id,
                    unit_type=unit_type,
                    selected_image_id=unit.selected_image_id,
                    selected_video_id=unit.selected_video_id,
                    image_prompt=unit.image_prompt,
                    video_prompt=unit.video_prompt,
                    image_updated_at=unit.image_updated_at,
                    video_updated_at=unit.video_updated_at,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **owner_tenant_kwargs(ctx),
                    **_audit_time_kwargs(ctx),
                )
            )
            for variant in unit.image_variants:
                session.merge(_image_variant_record("character_asset_unit", unit_id, "image_variants", variant, owner_tenant_kwargs(ctx)))
            for variant in unit.video_variants:
                session.merge(_video_variant_record("character_asset_unit", unit_id, "video_variants", variant, owner_tenant_kwargs(ctx)))
        return unit

    def soft_delete(self, character_id: str, unit_type: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            now = utc_now()
            existing_ids = [row[0] for row in session.query(CharacterAssetUnitRecord.id).filter(
                CharacterAssetUnitRecord.character_id == character_id,
                CharacterAssetUnitRecord.unit_type == unit_type,
                CharacterAssetUnitRecord.is_deleted.is_(False),
            ).all()]
            if existing_ids:
                session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(existing_ids), ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
                session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(existing_ids), VideoVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
                session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.id.in_(existing_ids), CharacterAssetUnitRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def restore(self, character_id: str, unit_type: str) -> AssetUnit | None:
        with self._with_session() as session:
            record = session.query(CharacterAssetUnitRecord).filter(
                CharacterAssetUnitRecord.character_id == character_id,
                CharacterAssetUnitRecord.unit_type == unit_type,
            ).order_by(CharacterAssetUnitRecord.updated_at.desc()).first()
            if record is None:
                return None
            self._restore_record(record)
        return self.get("project", character_id, character_id, unit_type, include_deleted=True)

    def save(self, character_id: str, unit_type: str, unit: AssetUnit) -> AssetUnit:
        return self.create(character_id, unit_type, unit)

    def delete(self, character_id: str, unit_type: str) -> None:
        self.soft_delete(character_id, unit_type)
