import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class SeriesScenePropReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "series-scene-prop-reference.db"
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

    def test_series_project_can_read_series_scenes_and_props(self):
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Prop, Scene, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_scene_ref_1",
                title="Series",
                description="",
                scenes=[Scene(id="series_scene_1", name="客厅", description="共享客厅")],
                props=[Prop(id="series_prop_1", name="玩具熊", description="共享玩具")],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_scene_ref_1",
                title="Episode 1",
                original_text="text",
                series_id="series_scene_ref_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        loaded = ProjectRepository().get("project_scene_ref_1")
        self.assertIsNotNone(loaded)
        self.assertEqual([item.id for item in loaded.scenes], ["series_scene_1"])
        self.assertEqual([item.id for item in loaded.props], ["series_prop_1"])

    def test_create_scene_and_prop_on_series_project_persists_to_series_library(self):
        from src.application.services import PropService, SceneService
        from src.db.models import PropRecord, SceneRecord
        from src.db.session import session_scope
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Script, Series

        now = utc_now()
        SeriesRepository().create(Series(id="series_scene_ref_2", title="Series", description="", created_at=now, updated_at=now))
        ProjectRepository().create(
            Script(
                id="project_scene_ref_2",
                title="Episode 2",
                original_text="text",
                series_id="series_scene_ref_2",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        SceneService().create_scene("project_scene_ref_2", "天台", "夜晚天台")
        PropService().create_prop("project_scene_ref_2", "雨伞", "黑色长柄伞")

        with session_scope() as session:
            scene_rows = session.query(SceneRecord).filter(SceneRecord.name == "天台", SceneRecord.is_deleted.is_(False)).all()
            prop_rows = session.query(PropRecord).filter(PropRecord.name == "雨伞", PropRecord.is_deleted.is_(False)).all()
            self.assertEqual(len(scene_rows), 1)
            self.assertEqual(scene_rows[0].owner_type, "series")
            self.assertEqual(scene_rows[0].owner_id, "series_scene_ref_2")
            self.assertEqual(len(prop_rows), 1)
            self.assertEqual(prop_rows[0].owner_type, "series")
            self.assertEqual(prop_rows[0].owner_id, "series_scene_ref_2")

        loaded = ProjectRepository().get("project_scene_ref_2")
        self.assertTrue(any(item.name == "天台" for item in loaded.scenes))
        self.assertTrue(any(item.name == "雨伞" for item in loaded.props))

    def test_update_series_scene_from_episode_context_writes_series_owner(self):
        from src.application.services.asset_service import AssetService
        from src.db.models import SceneRecord
        from src.db.session import session_scope
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Scene, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_scene_ref_3",
                title="Series",
                description="",
                scenes=[Scene(id="series_scene_update_1", name="办公室", description="旧描述")],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_scene_ref_3",
                title="Episode 3",
                original_text="text",
                series_id="series_scene_ref_3",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        AssetService().update_attributes(
            "project_scene_ref_3",
            "series_scene_update_1",
            "scene",
            {"description": "新描述"},
        )

        with session_scope() as session:
            row = (
                session.query(SceneRecord)
                .filter(SceneRecord.id == "series_scene_update_1", SceneRecord.is_deleted.is_(False))
                .one_or_none()
            )
            self.assertIsNotNone(row)
            self.assertEqual(row.owner_type, "series")
            self.assertEqual(row.owner_id, "series_scene_ref_3")
            self.assertEqual(row.description, "新描述")

    def test_delete_series_scene_from_episode_only_unlinks_local_frame(self):
        from src.application.services.scene_service import SceneService
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Scene, Script, Series, StoryboardFrame

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_scene_ref_4",
                title="Series",
                description="",
                scenes=[Scene(id="series_scene_keep_1", name="医院走廊", description="共享场景")],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_scene_ref_4",
                title="Episode 4",
                original_text="text",
                series_id="series_scene_ref_4",
                characters=[],
                scenes=[],
                props=[],
                frames=[StoryboardFrame(id="frame_scene_ref_4", scene_id="series_scene_keep_1", character_ids=[], prop_ids=[])],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated_project = SceneService().delete_scene("project_scene_ref_4", "series_scene_keep_1")
        self.assertEqual(updated_project.frames[0].scene_id, "")
        series = SeriesRepository().get("series_scene_ref_4")
        self.assertTrue(any(item.id == "series_scene_keep_1" for item in (series.scenes or [])))


if __name__ == "__main__":
    unittest.main()
