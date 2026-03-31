"""
系列跨对象命令服务。

这里只承接需要对整组共享素材做同步的命令。
"""

from typing import Callable

from ...db.models import CharacterRecord, PropRecord, SceneRecord
from ...db.session import session_scope
from ...repository import CharacterRepository, PropRepository, SceneRepository, SeriesRepository


class SeriesCommandService:
    """负责系列级跨对象命令。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.character_repository = CharacterRepository()
        self.scene_repository = SceneRepository()
        self.prop_repository = PropRepository()

    def sync_assets(self, series_id: str, expected_version: int, characters: list, scenes: list, props: list):
        desired_character_ids = {item.id for item in characters}
        desired_scene_ids = {item.id for item in scenes}
        desired_prop_ids = {item.id for item in props}

        def mutation(session):
            existing_character_ids = {
                row[0]
                for row in session.query(CharacterRecord.id).filter(
                    CharacterRecord.owner_type == "series",
                    CharacterRecord.owner_id == series_id,
                    CharacterRecord.is_deleted.is_(False),
                ).all()
            }
            existing_scene_ids = {
                row[0]
                for row in session.query(SceneRecord.id).filter(
                    SceneRecord.owner_type == "series",
                    SceneRecord.owner_id == series_id,
                    SceneRecord.is_deleted.is_(False),
                ).all()
            }
            existing_prop_ids = {
                row[0]
                for row in session.query(PropRecord.id).filter(
                    PropRecord.owner_type == "series",
                    PropRecord.owner_id == series_id,
                    PropRecord.is_deleted.is_(False),
                ).all()
            }

            for item in characters:
                self.character_repository.save("series", series_id, item, session=session)
            for item in scenes:
                self.scene_repository.save("series", series_id, item, session=session)
            for item in props:
                self.prop_repository.save("series", series_id, item, session=session)

            for item_id in existing_character_ids - desired_character_ids:
                self.character_repository.delete("series", series_id, item_id, session=session)
            for item_id in existing_scene_ids - desired_scene_ids:
                self.scene_repository.delete("series", series_id, item_id, session=session)
            for item_id in existing_prop_ids - desired_prop_ids:
                self.prop_repository.delete("series", series_id, item_id, session=session)

        return self._run(series_id, expected_version, mutation)

    def _run(self, series_id: str, expected_version: int, mutator: Callable) -> object:
        current_expected_version = expected_version
        for attempt in range(2):
            try:
                with session_scope() as session:
                    mutator(session)
                    self.series_repository.touch(series_id, current_expected_version, session=session)
                series = self.series_repository.get(series_id)
                if series is None:
                    raise ValueError(f"Series {series_id} not found")
                return series
            except ValueError as exc:
                if "version conflict" not in str(exc) or attempt > 0:
                    raise
                latest = self.series_repository.get(series_id)
                if latest is None:
                    raise ValueError(f"Series {series_id} not found") from exc
                current_expected_version = latest.version
        raise ValueError(f"Series {series_id} version conflict")
