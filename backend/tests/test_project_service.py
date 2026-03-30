import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class ProjectServiceReparseTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "project-service-test.db"
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

    def test_reparse_same_text_still_runs_for_draft_project_without_entities(self):
        from src.application.services.project_service import ProjectService
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Script

        now = utc_now()
        ProjectRepository().create(
            Script(
                id="project_draft_1",
                title="Draft",
                original_text="same text",
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
        parse_calls: list[tuple[str, str]] = []

        class FakeTextProvider:
            def parse_novel(self, title: str, text: str) -> Script:
                parse_calls.append((title, text))
                return Script(
                    id="parsed_project",
                    title=title,
                    original_text=text,
                    characters=[Character(id="char_1", name="Hero", description="lead")],
                    scenes=[],
                    props=[],
                    frames=[],
                    video_tasks=[],
                    created_at=now,
                    updated_at=now,
                )

        service.text_provider = FakeTextProvider()

        reparsed = service.reparse_project("project_draft_1", "same text")

        self.assertEqual(parse_calls, [("Draft", "same text")])
        self.assertEqual(len(reparsed.characters), 1)
        stored = ProjectRepository().get("project_draft_1")
        self.assertIsNotNone(stored)
        self.assertEqual(len(stored.characters), 1)

    def test_reparse_same_text_still_runs_when_project_already_has_entities(self):
        from src.application.services.project_service import ProjectService
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Script

        now = utc_now()
        existing = Script(
            id="project_parsed_1",
            title="Parsed",
            original_text="same text",
            characters=[Character(id="char_1", name="Hero", description="lead")],
            scenes=[],
            props=[],
            frames=[],
            video_tasks=[],
            created_at=now,
            updated_at=now,
        )
        ProjectRepository().create(existing)

        service = ProjectService()

        parse_calls: list[tuple[str, str]] = []

        class FakeTextProvider:
            def parse_novel(self, title: str, text: str) -> Script:
                parse_calls.append((title, text))
                return Script(
                    id="parsed_project_again",
                    title=title,
                    original_text=text,
                    characters=[Character(id="char_2", name="Hero 2", description="lead 2")],
                    scenes=[],
                    props=[],
                    frames=[],
                    video_tasks=[],
                    created_at=now,
                    updated_at=now,
                )

        service.text_provider = FakeTextProvider()

        reparsed = service.reparse_project("project_parsed_1", "same text")

        self.assertEqual(reparsed.id, "project_parsed_1")
        self.assertEqual(len(reparsed.characters), 1)
        self.assertEqual(reparsed.characters[0].id, "char_2")
        self.assertEqual(parse_calls, [("Parsed", "same text")])

    def test_reparse_preserves_existing_frames_and_video_tasks(self):
        from src.application.services.project_service import ProjectService
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Script, StoryboardFrame, VideoTask

        now = utc_now()
        existing = Script(
            id="project_keep_outputs_1",
            title="Parsed",
            original_text="old text",
            characters=[Character(id="char_old_1", name="Old Hero", description="old lead")],
            scenes=[],
            props=[],
            frames=[
                StoryboardFrame(
                    id="frame_existing_1",
                    scene_id="scene_existing_1",
                    action_description="旧分镜",
                )
            ],
            video_tasks=[
                VideoTask(
                    id="video_existing_1",
                    project_id="project_keep_outputs_1",
                    frame_id="frame_existing_1",
                    image_url="oss://frame-existing",
                    prompt="old video",
                    video_url="oss://video-existing",
                    created_at=now,
                )
            ],
            created_at=now,
            updated_at=now,
        )
        ProjectRepository().create(existing)

        service = ProjectService()

        class FakeTextProvider:
            def parse_novel(self, title: str, text: str) -> Script:
                return Script(
                    id="parsed_project_again",
                    title=title,
                    original_text=text,
                    characters=[Character(id="char_new_1", name="New Hero", description="new lead")],
                    scenes=[],
                    props=[],
                    frames=[],
                    video_tasks=[],
                    created_at=now,
                    updated_at=now,
                )

        service.text_provider = FakeTextProvider()

        reparsed = service.reparse_project("project_keep_outputs_1", "new text")

        self.assertEqual(reparsed.original_text, "new text")
        self.assertEqual([item.id for item in reparsed.characters], ["char_new_1"])
        self.assertEqual([item.id for item in reparsed.frames], ["frame_existing_1"])
        self.assertEqual([item.id for item in reparsed.video_tasks], ["video_existing_1"])

        stored = ProjectRepository().get("project_keep_outputs_1")
        self.assertIsNotNone(stored)
        self.assertEqual(stored.original_text, "new text")
        self.assertEqual([item.id for item in stored.characters], ["char_new_1"])
        self.assertEqual([item.id for item in stored.frames], ["frame_existing_1"])
        self.assertEqual([item.id for item in stored.video_tasks], ["video_existing_1"])


if __name__ == "__main__":
    unittest.main()
