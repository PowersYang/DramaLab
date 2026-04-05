import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class CharacterServiceSeriesProjectTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "character-service-series.db"
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

    def test_create_character_on_series_project_creates_series_master_and_link(self):
        from src.application.services.character_service import CharacterService
        from src.repository import CharacterRepository, ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Script, Series

        now = utc_now()
        SeriesRepository().create(Series(id="series_char_create_1", title="Series", description="", created_at=now, updated_at=now))
        ProjectRepository().create(
            Script(
                id="project_char_create_1",
                title="Episode",
                original_text="text",
                series_id="series_char_create_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated_project = CharacterService().create_character("project_char_create_1", "新角色", "系列项目新角色")

        self.assertEqual(CharacterRepository().list_by_owner("project", "project_char_create_1"), [])
        self.assertEqual(len(CharacterRepository().list_by_owner("series", "series_char_create_1")), 1)
        self.assertEqual(len(ProjectCharacterLinkRepository().list_by_project("project_char_create_1")), 1)
        self.assertEqual(len(updated_project.series_character_links), 1)
        self.assertEqual(updated_project.series_character_links[0].character.name, "新角色")

    def test_delete_character_on_series_project_removes_link_but_keeps_series_master(self):
        from src.application.services.character_service import CharacterService
        from src.repository import CharacterRepository, ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, ProjectCharacterLink, Script, Series, StoryboardFrame

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_char_delete_1",
                title="Series",
                description="",
                characters=[Character(id="series_char_keep_1", name="阿杰", canonical_name="阿杰", description="主角")],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_char_delete_1",
                title="Episode",
                original_text="text",
                series_id="series_char_delete_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[StoryboardFrame(id="frame_delete_1", scene_id="scene_1", character_ids=["series_char_keep_1"])],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectCharacterLinkRepository().sync_for_project(
            "project_char_delete_1",
            "series_char_delete_1",
            [
                ProjectCharacterLink(
                    id="pcl_delete_1",
                    project_id="project_char_delete_1",
                    series_id="series_char_delete_1",
                    character_id="series_char_keep_1",
                    source_name="阿杰",
                    match_status="confirmed",
                    created_at=now,
                    updated_at=now,
                )
            ],
        )

        updated_project = CharacterService().delete_character("project_char_delete_1", "series_char_keep_1")

        self.assertEqual(len(ProjectCharacterLinkRepository().list_by_project("project_char_delete_1")), 0)
        self.assertEqual(len(CharacterRepository().list_by_owner("series", "series_char_delete_1")), 1)
        self.assertEqual(updated_project.frames[0].character_ids, [])

    def test_bind_voice_on_series_project_updates_series_master_character(self):
        from src.application.services.character_service import CharacterService
        from src.repository import CharacterRepository, ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, ProjectCharacterLink, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_char_voice_1",
                title="Series",
                description="",
                characters=[Character(id="series_char_voice_target_1", name="阿杰", canonical_name="阿杰", description="主角")],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="project_char_voice_1",
                title="Episode",
                original_text="text",
                series_id="series_char_voice_1",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectCharacterLinkRepository().sync_for_project(
            "project_char_voice_1",
            "series_char_voice_1",
            [
                ProjectCharacterLink(
                    id="pcl_voice_1",
                    project_id="project_char_voice_1",
                    series_id="series_char_voice_1",
                    character_id="series_char_voice_target_1",
                    source_name="阿杰",
                    match_status="confirmed",
                    created_at=now,
                    updated_at=now,
                )
            ],
        )

        CharacterService().bind_voice("project_char_voice_1", "series_char_voice_target_1", "voice-1", "主播一号")

        updated_character = CharacterRepository().get("series", "series_char_voice_1", "series_char_voice_target_1")
        self.assertIsNotNone(updated_character)
        self.assertEqual(updated_character.voice_id, "voice-1")
        self.assertEqual(updated_character.voice_name, "主播一号")


if __name__ == "__main__":
    unittest.main()
