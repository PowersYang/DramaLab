from .base import BaseRepository
from .character_repository import CharacterRepository
from .mappers import _audit_time_kwargs, _image_variant_record, _new_id, _video_variant_record
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoVariantRecord
from ..schemas.models import AssetUnit


class CharacterAssetUnitRepository(BaseRepository[AssetUnit]):
    def get(self, owner_type: str, owner_id: str, character_id: str, unit_type: str) -> AssetUnit | None:
        repo = CharacterRepository()
        character = repo.get(owner_type, owner_id, character_id)
        if character is None:
            return None
        return getattr(character, unit_type, None)

    def save(self, character_id: str, unit_type: str, unit: AssetUnit) -> AssetUnit:
        with self._with_session() as session:
            character = session.get(CharacterRecord, character_id)
            if character is None:
                raise ValueError(f"character {character_id} not found")
            ctx = load_owner_context(session, "character", character_id)

            existing_ids = [row[0] for row in session.query(CharacterAssetUnitRecord.id).filter(
                CharacterAssetUnitRecord.character_id == character_id,
                CharacterAssetUnitRecord.unit_type == unit_type,
            ).all()]
            if existing_ids:
                session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(existing_ids)).delete(synchronize_session=False)
                session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(existing_ids)).delete(synchronize_session=False)
                session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.id.in_(existing_ids)).delete(synchronize_session=False)

            unit_id = _new_id(f"{character_id}_{unit_type}")
            session.add(
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
                    **owner_tenant_kwargs(ctx),
                    **_audit_time_kwargs(ctx),
                )
            )
            for variant in unit.image_variants:
                session.add(_image_variant_record("character_asset_unit", unit_id, "image_variants", variant, owner_tenant_kwargs(ctx)))
            for variant in unit.video_variants:
                session.add(_video_variant_record("character_asset_unit", unit_id, "video_variants", variant, owner_tenant_kwargs(ctx)))
        return unit

    def delete(self, character_id: str, unit_type: str) -> None:
        with self._with_session() as session:
            existing_ids = [row[0] for row in session.query(CharacterAssetUnitRecord.id).filter(
                CharacterAssetUnitRecord.character_id == character_id,
                CharacterAssetUnitRecord.unit_type == unit_type,
            ).all()]
            if existing_ids:
                session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(existing_ids)).delete(synchronize_session=False)
                session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(existing_ids)).delete(synchronize_session=False)
                session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.id.in_(existing_ids)).delete(synchronize_session=False)
