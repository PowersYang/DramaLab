from .base import BaseRepository
from .image_variant_repository import ImageVariantRepository
from .mappers import _audit_time_kwargs
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoVariantRecord
from ..schemas.models import AssetUnit
from ..utils.datetime import utc_now
from .video_variant_repository import VideoVariantRepository


class CharacterAssetUnitRepository(BaseRepository[AssetUnit]):
    def __init__(self):
        self.image_variant_repository = ImageVariantRepository()
        self.video_variant_repository = VideoVariantRepository()

    def get(self, owner_type: str, owner_id: str, character_id: str, unit_type: str, include_deleted: bool = False) -> AssetUnit | None:
        from .character_repository import CharacterRepository

        repo = CharacterRepository()
        character = repo.get(owner_type, owner_id, character_id, include_deleted=include_deleted)
        if character is None:
            return None
        return getattr(character, unit_type, None)

    def create(self, character_id: str, unit_type: str, unit: AssetUnit, session=None) -> AssetUnit:
        with self._with_session(session) as active_session:
            character = active_session.get(CharacterRecord, character_id)
            if character is None or character.is_deleted:
                raise ValueError(f"character {character_id} not found")
            ctx = load_owner_context(active_session, "character", character_id)
            unit_id = f"{character_id}_{unit_type}"
            tenant = owner_tenant_kwargs(ctx)
            active_session.merge(
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
                    **tenant,
                    **_audit_time_kwargs(ctx),
                )
            )
            self.image_variant_repository.sync_exact(
                "character_asset_unit",
                unit_id,
                "image_variants",
                unit.image_variants,
                tenant,
                session=active_session,
            )
            self.video_variant_repository.sync_exact(
                "character_asset_unit",
                unit_id,
                "video_variants",
                unit.video_variants,
                tenant,
                session=active_session,
            )
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

    def sync_units(self, character_id: str, units_by_type: dict[str, AssetUnit], deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            character = active_session.get(CharacterRecord, character_id)
            if character is None or character.is_deleted:
                raise ValueError(f"character {character_id} not found")
            ctx = load_owner_context(active_session, "character", character_id)
            tenant = owner_tenant_kwargs(ctx)
            now = utc_now()
            desired_unit_ids: set[str] = set()
            for unit_type, unit in units_by_type.items():
                unit_id = f"{character_id}_{unit_type}"
                desired_unit_ids.add(unit_id)
                active_session.merge(
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
                        **tenant,
                        **_audit_time_kwargs(character),
                    )
                )
                self.image_variant_repository.sync_exact(
                    "character_asset_unit",
                    unit_id,
                    "image_variants",
                    unit.image_variants,
                    tenant,
                    deleted_by=deleted_by,
                    session=active_session,
                )
                self.video_variant_repository.sync_exact(
                    "character_asset_unit",
                    unit_id,
                    "video_variants",
                    unit.video_variants,
                    tenant,
                    deleted_by=deleted_by,
                    session=active_session,
                )

            extra_unit_query = active_session.query(CharacterAssetUnitRecord).filter(
                CharacterAssetUnitRecord.character_id == character_id,
                CharacterAssetUnitRecord.is_deleted.is_(False),
            )
            if desired_unit_ids:
                extra_unit_query = extra_unit_query.filter(~CharacterAssetUnitRecord.id.in_(desired_unit_ids))
            extra_unit_ids = [row[0] for row in extra_unit_query.with_entities(CharacterAssetUnitRecord.id).all()]
            if extra_unit_ids:
                active_session.query(ImageVariantRecord).filter(
                    ImageVariantRecord.owner_type == "character_asset_unit",
                    ImageVariantRecord.owner_id.in_(extra_unit_ids),
                    ImageVariantRecord.is_deleted.is_(False),
                ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
                active_session.query(VideoVariantRecord).filter(
                    VideoVariantRecord.owner_type == "character_asset_unit",
                    VideoVariantRecord.owner_id.in_(extra_unit_ids),
                    VideoVariantRecord.is_deleted.is_(False),
                ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
                active_session.query(CharacterAssetUnitRecord).filter(
                    CharacterAssetUnitRecord.id.in_(extra_unit_ids),
                    CharacterAssetUnitRecord.is_deleted.is_(False),
                ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def delete(self, character_id: str, unit_type: str) -> None:
        self.soft_delete(character_id, unit_type)
