import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class ProjectSeriesCastingServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "project-series-casting.db"
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

    def test_sync_project_characters_reuses_existing_series_character_by_canonical_name(self):
        from src.application.services.project_series_casting_service import ProjectSeriesCastingService
        from src.repository import ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_casting_1",
                title="Series Casting",
                description="desc",
                characters=[
                    Character(
                        id="series_char_existing_1",
                        name="阿杰",
                        canonical_name="阿杰",
                        description="系列主角",
                    )
                ],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_casting_1",
                title="Episode 1",
                original_text="阿杰出场",
                series_id="series_casting_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        service = ProjectSeriesCastingService()
        result = service.sync_project_characters(
            project_id="project_casting_1",
            series_id="series_casting_1",
            incoming_characters=[
                Character(
                    id="incoming_char_1",
                    name="阿杰",
                    description="本集主角",
                )
            ],
        )

        self.assertEqual(len(result.links), 1)
        self.assertEqual(result.links[0].character_id, "series_char_existing_1")
        self.assertEqual(result.links[0].match_status, "auto_matched")
        self.assertEqual(len(SeriesRepository().get("series_casting_1").characters), 1)
        self.assertEqual(
            ProjectCharacterLinkRepository().list_by_project("project_casting_1")[0].character_id,
            "series_char_existing_1",
        )

    def test_reparse_series_project_writes_series_characters_and_links_without_creating_project_characters(self):
        from src.application.services.project_service import ProjectService
        from src.repository import CharacterRepository, ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_reparse_1",
                title="Series Reparse",
                description="desc",
                characters=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_reparse_series_1",
                title="Episode 1",
                original_text="old text",
                series_id="series_reparse_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        service = ProjectService()

        class FakeTextProvider:
            def parse_novel(self, title: str, text: str) -> Script:
                return Script(
                    id="parsed_project_series_1",
                    title=title,
                    original_text=text,
                    characters=[Character(id="series_new_char_1", name="小满", description="新角色")],
                    scenes=[],
                    props=[],
                    frames=[],
                    video_tasks=[],
                    created_at=now,
                    updated_at=now,
                )

        service.text_provider = FakeTextProvider()

        reparsed = service.reparse_project("project_reparse_series_1", "new text")

        self.assertEqual(reparsed.series_id, "series_reparse_1")
        self.assertEqual(reparsed.original_text, "new text")
        self.assertEqual(CharacterRepository().list_by_owner("project", "project_reparse_series_1"), [])
        self.assertEqual(len(ProjectCharacterLinkRepository().list_by_project("project_reparse_series_1")), 1)
        self.assertEqual(SeriesRepository().get("series_reparse_1").characters[0].name, "小满")


if __name__ == "__main__":
    unittest.main()
