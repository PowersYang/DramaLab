import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class SeriesAssetInboxServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "series-asset-inbox.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory, init_database
        from src.settings.env_settings import override_env_path_for_tests

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

    def tearDown(self):
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory
        from src.settings.env_settings import override_env_path_for_tests

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def test_append_and_remove_inbox_candidates(self):
        from src.application.services.series_asset_inbox_service import SeriesAssetInboxService
        from src.repository import SeriesRepository
        from src.schemas.models import Character, Prop, Scene, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_inbox_1",
                title="Inbox Series",
                description="desc",
                characters=[Character(id="char_existing_1", name="阿杰", description="已有角色")],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )

        service = SeriesAssetInboxService()
        service.upsert_inbox(
            series_id="series_inbox_1",
            characters=[Character(id="char_inbox_1", name="小满", description="待确认角色")],
            scenes=[Scene(id="scene_inbox_1", name="客厅", description="待确认场景")],
            props=[Prop(id="prop_inbox_1", name="玩具熊", description="待确认道具")],
            mode="append",
        )

        # 中文注释：重复追加同名候选应被收件箱去重，避免运营端重复确认同一资产。
        service.upsert_inbox(
            series_id="series_inbox_1",
            characters=[Character(id="char_inbox_2", name="小满", description="重复角色候选")],
            scenes=[Scene(id="scene_inbox_2", name="客厅", description="重复候选")],
            props=[],
            mode="append",
        )

        inbox = service.get_inbox("series_inbox_1")
        self.assertEqual(len(inbox["characters"]), 1)
        self.assertEqual(len(inbox["scenes"]), 1)
        self.assertEqual(len(inbox["props"]), 1)

        inbox = service.remove_items(
            series_id="series_inbox_1",
            character_ids=["char_inbox_1"],
            scene_ids=["scene_inbox_1"],
            prop_ids=[],
        )
        self.assertEqual(len(inbox["characters"]), 0)
        self.assertEqual(len(inbox["scenes"]), 0)
        self.assertEqual(len(inbox["props"]), 1)


if __name__ == "__main__":
    unittest.main()
