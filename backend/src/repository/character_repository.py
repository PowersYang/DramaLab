from typing import List

from .base import BaseRepository
from .mappers import _insert_character, _video_task_record, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import CharacterAssetUnitRecord, CharacterRecord, ImageVariantRecord, VideoTaskRecord, VideoVariantRecord
from ..schemas.models import Character


class CharacterRepository(BaseRepository[Character]):
    def list_by_owner(self, owner_type: str, owner_id: str) -> List[Character]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}).get(owner_id)
                return project.characters if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}).get(owner_id)
                return series.characters if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, character_id: str) -> Character | None:
        for character in self.list_by_owner(owner_type, owner_id):
            if character.id == character_id:
                return character
        return None

    def save(self, owner_type: str, owner_id: str, character: Character) -> Character:
        with self._with_session() as session:
            ctx = load_owner_context(session, owner_type, owner_id)
            self.delete(owner_type, owner_id, character.id, session=session)
            _insert_character(session, character, owner_type, owner_id, owner_tenant_kwargs(ctx))
            session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == character.id).delete(synchronize_session=False)
            if owner_type == "project":
                for task in character.video_assets:
                    session.add(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return character

    def delete(self, owner_type: str, owner_id: str, character_id: str, session=None) -> None:
        with self._with_session(session) as active_session:
            self._delete_graph(active_session, character_id)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == character_id).delete(synchronize_session=False)

    def _delete_graph(self, session, character_id: str) -> None:
        unit_ids = [row[0] for row in session.query(CharacterAssetUnitRecord.id).filter(CharacterAssetUnitRecord.character_id == character_id).all()]
        if unit_ids:
            session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character_asset_unit", ImageVariantRecord.owner_id.in_(unit_ids)).delete(synchronize_session=False)
            session.query(VideoVariantRecord).filter(VideoVariantRecord.owner_type == "character_asset_unit", VideoVariantRecord.owner_id.in_(unit_ids)).delete(synchronize_session=False)
            session.query(CharacterAssetUnitRecord).filter(CharacterAssetUnitRecord.id.in_(unit_ids)).delete(synchronize_session=False)
        session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "character", ImageVariantRecord.owner_id == character_id).delete(synchronize_session=False)
        session.query(CharacterRecord).filter(CharacterRecord.id == character_id).delete(synchronize_session=False)
