from typing import List

from .base import BaseRepository
from .image_variant_repository import ImageVariantRepository
from .mappers import _audit_time_kwargs, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoTaskRecord, VideoVariantRecord
from ..schemas.models import AssetUnit, Character
from ..utils.datetime import utc_now


class CharacterRepository(BaseRepository[Character]):
    def __init__(self):
        from .character_asset_unit_repository import CharacterAssetUnitRepository

        self.character_asset_unit_repository = CharacterAssetUnitRepository()
        self.image_variant_repository = ImageVariantRepository()

    def list_by_owner(self, owner_type: str, owner_id: str, include_deleted: bool = False) -> List[Character]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return project.characters if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}, include_deleted=include_deleted).get(owner_id)
                return series.characters if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, character_id: str, include_deleted: bool = False) -> Character | None:
        for character in self.list_by_owner(owner_type, owner_id, include_deleted=include_deleted):
            if character.id == character_id:
                return character
        return None

    def create(self, owner_type: str, owner_id: str, character: Character, session=None, preserve_missing_media: bool = True) -> Character:
        with self._with_session(session) as active_session:
            if preserve_missing_media:
                existing = self._load_existing_character(active_session, owner_type, owner_id, character.id)
                character = self._merge_existing_media_state(existing, character)
            ctx = load_owner_context(active_session, owner_type, owner_id)
            tenant = owner_tenant_kwargs(ctx)
            active_session.merge(
                CharacterRecord(
                    id=character.id,
                    owner_type=owner_type,
                    owner_id=owner_id,
                    name=character.name,
                    description=character.description,
                    age=character.age,
                    gender=character.gender,
                    clothing=character.clothing,
                    visual_weight=character.visual_weight,
                    full_body_image_url=character.full_body_image_url,
                    full_body_prompt=character.full_body_prompt,
                    full_body_asset_selected_id=(character.full_body_asset.selected_id if character.full_body_asset else None),
                    three_view_image_url=character.three_view_image_url,
                    three_view_prompt=character.three_view_prompt,
                    three_view_asset_selected_id=(character.three_view_asset.selected_id if character.three_view_asset else None),
                    headshot_image_url=character.headshot_image_url,
                    headshot_prompt=character.headshot_prompt,
                    headshot_asset_selected_id=(character.headshot_asset.selected_id if character.headshot_asset else None),
                    video_prompt=character.video_prompt,
                    image_url=character.image_url,
                    avatar_url=character.avatar_url,
                    is_consistent=character.is_consistent,
                    full_body_updated_at=character.full_body_updated_at,
                    three_view_updated_at=character.three_view_updated_at,
                    headshot_updated_at=character.headshot_updated_at,
                    base_character_id=character.base_character_id,
                    voice_id=character.voice_id,
                    voice_name=character.voice_name,
                    voice_speed=character.voice_speed,
                    voice_pitch=character.voice_pitch,
                    voice_volume=character.voice_volume,
                    locked=character.locked,
                    status=character.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **tenant,
                    **_audit_time_kwargs(character),
                )
            )
            active_session.flush()
            # 中文注释：角色图片候选的数据库唯一真相统一收口到 character_asset_unit。
            # legacy ImageAsset 仅作为兼容前端/旧字段的投影视图保留在 CharacterRecord 上，
            # 不再把同一批 variant 以 owner_type="character" 再写一遍，避免与 unit 容器共享同一 variant.id 时发生主键冲突。
            self.character_asset_unit_repository.sync_units(
                character.id,
                {
                    "full_body": character.full_body or AssetUnit(),
                    "three_views": character.three_views or AssetUnit(),
                    "head_shot": character.head_shot or AssetUnit(),
                },
                session=active_session,
            )
        return character

    def patch(self, owner_type: str, owner_id: str, character_id: str, patch: dict, session=None) -> Character:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, CharacterRecord, character_id)
            if record is None or record.owner_type != owner_type or record.owner_id != owner_id:
                raise ValueError(f"Character {character_id} not found")
            self._patch_record(record, patch)
            refreshed = self.get(owner_type, owner_id, character_id)
            if refreshed is None:
                raise ValueError(f"Character {character_id} not found")
            return refreshed

    def soft_delete(self, owner_type: str, owner_id: str, character_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            self._soft_delete_graph(active_session, character_id, deleted_by)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(
                    VideoTaskRecord.project_id == owner_id,
                    VideoTaskRecord.asset_id == character_id,
                    VideoTaskRecord.is_deleted.is_(False),
                ).update({"is_deleted": True, "deleted_at": record_time(), "updated_at": record_time(), "deleted_by": deleted_by}, synchronize_session=False)

    def restore(self, owner_type: str, owner_id: str, character_id: str) -> Character:
        with self._with_session() as session:
            record = session.get(CharacterRecord, character_id)
            if record is None or record.owner_type != owner_type or record.owner_id != owner_id:
                raise ValueError(f"Character {character_id} not found")
            self._restore_record(record)
            restored = self.get(owner_type, owner_id, character_id)
            if restored is None:
                raise ValueError(f"Character {character_id} not found")
            return restored

    def _soft_delete_graph(self, session, character_id: str, deleted_by: str | None = None) -> None:
        now = record_time()
        unit_ids = [row[0] for row in session.query(CharacterAssetUnitRecord.id).filter(CharacterAssetUnitRecord.character_id == character_id, CharacterAssetUnitRecord.is_deleted.is_(False)).all()]
        if unit_ids:
            session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(unit_ids), ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(unit_ids), VideoVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.id.in_(unit_ids), CharacterAssetUnitRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
        session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character", ImageVariantRecord.owner_id == character_id, ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
        session.query(CharacterRecord).filter(CharacterRecord.id == character_id, CharacterRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def save(self, owner_type: str, owner_id: str, character: Character, session=None, preserve_missing_media: bool = True) -> Character:
        return self.create(
            owner_type,
            owner_id,
            character,
            session=session,
            preserve_missing_media=preserve_missing_media,
        )

    def delete(self, owner_type: str, owner_id: str, character_id: str, session=None) -> None:
        self.soft_delete(owner_type, owner_id, character_id, session=session)

    def _load_existing_character(self, session, owner_type: str, owner_id: str, character_id: str) -> Character | None:
        """在当前事务里读取现有角色聚合，给局部写入补齐未携带的媒体图谱。"""
        if owner_type == "project":
            project = hydrate_project_map(session, {owner_id}).get(owner_id)
            characters = project.characters if project else []
        elif owner_type == "series":
            series = hydrate_series_map(session, {owner_id}).get(owner_id)
            characters = series.characters if series else []
        else:
            raise ValueError(f"Unsupported owner_type: {owner_type}")
        return next((item for item in characters if item.id == character_id), None)

    def _merge_existing_media_state(self, existing: Character | None, incoming: Character) -> Character:
        """角色局部更新时保留未显式修改的素材候选，避免空列表把整组变体软删。"""
        if existing is None:
            return incoming

        for legacy_attr, unit_attr, url_attr, prompt_attr in (
            ("full_body_asset", "full_body", "full_body_image_url", "full_body_prompt"),
            ("three_view_asset", "three_views", "three_view_image_url", "three_view_prompt"),
            ("headshot_asset", "head_shot", "headshot_image_url", "headshot_prompt"),
        ):
            incoming_legacy = getattr(incoming, legacy_attr, None)
            incoming_unit = getattr(incoming, unit_attr, None)
            existing_legacy = getattr(existing, legacy_attr, None)
            existing_unit = getattr(existing, unit_attr, None)

            has_incoming_images = bool(
                (incoming_legacy and incoming_legacy.variants)
                or (incoming_unit and incoming_unit.image_variants)
            )
            has_existing_images = bool(
                (existing_legacy and existing_legacy.variants)
                or (existing_unit and existing_unit.image_variants)
            )

            if not has_incoming_images and has_existing_images:
                if existing_legacy is not None:
                    setattr(incoming, legacy_attr, existing_legacy.model_copy(deep=True))
                if existing_unit is not None:
                    setattr(incoming, unit_attr, existing_unit.model_copy(deep=True))
                incoming_legacy = getattr(incoming, legacy_attr, None)
                incoming_unit = getattr(incoming, unit_attr, None)
                has_incoming_images = True

            if incoming_unit is not None and existing_unit is not None:
                if not incoming_unit.video_variants and existing_unit.video_variants:
                    incoming_unit.video_variants = [item.model_copy(deep=True) for item in existing_unit.video_variants]
                if not incoming_unit.selected_video_id and existing_unit.selected_video_id:
                    incoming_unit.selected_video_id = existing_unit.selected_video_id
                if not incoming_unit.video_prompt and existing_unit.video_prompt:
                    incoming_unit.video_prompt = existing_unit.video_prompt
                if not incoming_unit.video_updated_at and existing_unit.video_updated_at:
                    incoming_unit.video_updated_at = existing_unit.video_updated_at
                if has_incoming_images:
                    if not incoming_unit.selected_image_id and existing_unit.selected_image_id:
                        incoming_unit.selected_image_id = existing_unit.selected_image_id
                    if not incoming_unit.image_prompt and existing_unit.image_prompt:
                        incoming_unit.image_prompt = existing_unit.image_prompt
                    if not incoming_unit.image_updated_at and existing_unit.image_updated_at:
                        incoming_unit.image_updated_at = existing_unit.image_updated_at

            if incoming_legacy is not None and existing_legacy is not None and has_incoming_images:
                if not incoming_legacy.selected_id and existing_legacy.selected_id:
                    incoming_legacy.selected_id = existing_legacy.selected_id

            if getattr(incoming, url_attr, None) is None and getattr(existing, url_attr, None) is not None:
                setattr(incoming, url_attr, getattr(existing, url_attr))
            if getattr(incoming, prompt_attr, None) is None and getattr(existing, prompt_attr, None) is not None:
                setattr(incoming, prompt_attr, getattr(existing, prompt_attr))

        if incoming.image_url is None and existing.image_url is not None:
            incoming.image_url = existing.image_url
        if incoming.avatar_url is None and existing.avatar_url is not None:
            incoming.avatar_url = existing.avatar_url
        if incoming.video_prompt is None and existing.video_prompt is not None:
            incoming.video_prompt = existing.video_prompt

        return incoming


def record_time() -> float:
    return utc_now()
