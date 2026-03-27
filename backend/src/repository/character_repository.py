from typing import List

from .base import BaseRepository
from .mappers import _insert_character, _video_task_record, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoTaskRecord, VideoVariantRecord
from ..schemas.models import Character
from ..utils.datetime import utc_now


class CharacterRepository(BaseRepository[Character]):
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

    def create(self, owner_type: str, owner_id: str, character: Character) -> Character:
        with self._with_session() as session:
            ctx = load_owner_context(session, owner_type, owner_id)
            _insert_character(session, character, owner_type, owner_id, owner_tenant_kwargs(ctx))
            if owner_type == "project":
                for task in character.video_assets:
                    session.merge(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return character

    def patch(self, owner_type: str, owner_id: str, character_id: str, patch: dict) -> Character:
        with self._with_session() as session:
            record = self._get_active(session, CharacterRecord, character_id)
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

    def save(self, owner_type: str, owner_id: str, character: Character) -> Character:
        self.soft_delete(owner_type, owner_id, character.id)
        return self.create(owner_type, owner_id, character)

    def delete(self, owner_type: str, owner_id: str, character_id: str, session=None) -> None:
        self.soft_delete(owner_type, owner_id, character_id, session=session)


def record_time() -> float:
    return utc_now()
