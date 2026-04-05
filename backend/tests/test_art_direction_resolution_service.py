import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class ArtDirectionResolutionServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "art-direction.db"
        env_path = Path(self.temp_dir.name) / ".env"
        env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        override_env_path_for_tests(env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

    def tearDown(self):
        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def test_resolves_series_default_and_project_override(self):
        from src.application.services.art_direction_resolution_service import ArtDirectionResolutionService
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import ArtDirection, Script, Series

        now = utc_now()
        series_repository = SeriesRepository()
        project_repository = ProjectRepository()
        service = ArtDirectionResolutionService()

        series_repository.create(
            Series(
                id="series_1",
                title="Series",
                description="",
                art_direction=ArtDirection(
                    selected_style_id="series-style",
                    style_config={
                        "id": "series-style",
                        "name": "剧集标准",
                        "positive_prompt": "series positive",
                        "negative_prompt": "series negative",
                        "is_custom": False,
                    },
                ),
                created_at=now,
                updated_at=now,
            )
        )
        project_repository.create(
            Script(
                id="project_1",
                title="EP1",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                series_id="series_1",
                art_direction_source="series_default",
                created_at=now,
                updated_at=now,
            )
        )

        payload = service.get_resolved_project_payload("project_1")
        self.assertEqual(payload["source"], "series_default")
        self.assertEqual(payload["resolved_art_direction"]["style_config"]["positive_prompt"], "series positive")

        updated = service.save_project_override(
            "project_1",
            selected_style_id="override-style",
            style_config={
                "id": "override-style",
                "name": "单集梦境",
                "positive_prompt": "override positive",
                "negative_prompt": "override negative",
                "is_custom": True,
            },
            updated_by="user_1",
        )
        self.assertEqual(updated.art_direction_source, "project_override")
        self.assertEqual(updated.art_direction_resolved.style_config["positive_prompt"], "override positive")
        self.assertEqual(updated.art_direction_override["selected_style_id"], "override-style")

        reset = service.clear_project_override("project_1", updated_by="user_1")
        self.assertEqual(reset.art_direction_source, "series_default")

    def test_resolves_standalone_project_from_project_art_direction(self):
        from src.application.services.art_direction_resolution_service import ArtDirectionResolutionService
        from src.repository import ProjectRepository
        from src.schemas.models import ArtDirection, Script

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="standalone_1",
                title="Standalone",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                art_direction=ArtDirection(
                    selected_style_id="solo-style",
                    style_config={
                        "id": "solo-style",
                        "name": "独立项目风格",
                        "positive_prompt": "solo positive",
                        "negative_prompt": "solo negative",
                        "is_custom": False,
                    },
                ),
                art_direction_source="standalone",
                created_at=now,
                updated_at=now,
            )
        )

        payload = ArtDirectionResolutionService().get_resolved_project_payload("standalone_1")
        self.assertEqual(payload["source"], "standalone")
        self.assertEqual(payload["resolved_art_direction"]["selected_style_id"], "solo-style")
