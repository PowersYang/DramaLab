import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class SeriesAssetExtractTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "series-asset-extract.db"
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

    def test_executor_extracts_series_assets_without_creating_project(self):
        from src.application.tasks.executors.series_assets_extract import SeriesAssetsExtractExecutor
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Character, Scene, Script, Series
        from src.schemas.task_models import TaskJob

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_extract_1",
                title="系列识别",
                description="desc",
                created_at=now,
                updated_at=now,
            )
        )

        executor = SeriesAssetsExtractExecutor()

        class FakeTextProvider:
            def parse_novel(self, title: str, text: str) -> Script:
                return Script(
                    id="parsed_series_extract_preview_1",
                    title=title,
                    original_text=text,
                    characters=[Character(id="preview_char_1", name="周野", description="预览角色")],
                    scenes=[Scene(id="preview_scene_1", name="审讯室", description="预览场景")],
                    props=[],
                    frames=[],
                    video_tasks=[],
                    created_at=now,
                    updated_at=now,
                )

            def get_last_metrics(self):
                return {}

        executor.series_asset_extract_service.text_provider = FakeTextProvider()

        result = executor.execute(
            TaskJob(
                id="job_series_extract_1",
                task_type="series.assets.extract",
                status="queued",
                queue_name="llm",
                payload_json={
                    "series_id": "series_extract_1",
                    "text": "周野推门走进审讯室。",
                },
                resource_type="series",
                resource_id="series_extract_1",
                created_at=now,
                updated_at=now,
            )
        )

        self.assertEqual(result["series_id"], "series_extract_1")
        self.assertEqual(result["character_count"], 1)
        self.assertEqual(result["scene_count"], 1)
        self.assertEqual(result["prop_count"], 0)
        self.assertEqual(result["characters"][0]["name"], "周野")
        self.assertEqual(result["scenes"][0]["name"], "审讯室")
        self.assertEqual(ProjectRepository().list(), [])


if __name__ == "__main__":
    unittest.main()
