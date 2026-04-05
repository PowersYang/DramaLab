import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class SeriesCharacterMigrationServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "series-character-migration.db"
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

    def test_build_candidate_groups_only_scans_projects_inside_series(self):
        from src.application.services.series_character_migration_service import SeriesCharacterMigrationService
        from src.repository import ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, ProjectCharacterLink, Script, Series, StoryboardFrame

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_migration_1",
                title="Migration Series",
                description="desc",
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="series_project_1",
                title="Ep1",
                original_text="text",
                series_id="series_migration_1",
                characters=[Character(id="char_ep1_1", name="阿杰", description="少年主角")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="series_project_2",
                title="Ep2",
                original_text="text",
                series_id="series_migration_1",
                characters=[Character(id="char_ep2_1", name="阿杰", description="第二集主角")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="standalone_project_1",
                title="Standalone",
                original_text="text",
                characters=[Character(id="char_single_1", name="阿杰", description="独立项目角色")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        candidates = SeriesCharacterMigrationService().build_candidate_groups("series_migration_1")

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["normalized_name"], "阿杰")
        self.assertEqual({item["project_id"] for item in candidates[0]["items"]}, {"series_project_1", "series_project_2"})
        self.assertNotIn("standalone_project_1", {item["project_id"] for item in candidates[0]["items"]})

    def test_build_series_audit_summarizes_character_and_link_readiness(self):
        from src.application.services.series_character_migration_service import SeriesCharacterMigrationService
        from src.repository import ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, ProjectCharacterLink, Script, Series, StoryboardFrame

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_migration_2",
                title="Audit Series",
                description="desc",
                characters=[
                    Character(id="series_char_1", name="沈清辞", description="系列主档", owner_type="series", owner_id="series_migration_2"),
                ],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="series_project_3",
                title="Ep3",
                original_text="text",
                series_id="series_migration_2",
                characters=[Character(id="char_ep3_1", name="沈清辞", description="第一版角色")],
                frames=[
                    StoryboardFrame(
                        id="frame_ep3_1",
                        scene_id="scene-placeholder",
                        character_ids=["char_ep3_1"],
                    )
                ],
                scenes=[],
                props=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectCharacterLinkRepository().sync_for_project(
            project_id="series_project_3",
            series_id="series_migration_2",
            links=[
                ProjectCharacterLink(
                    id="link_ep3_1",
                    project_id="series_project_3",
                    series_id="series_migration_2",
                    character_id="series_char_1",
                    match_status="confirmed",
                    created_at=now,
                    updated_at=now,
                )
            ],
        )
        ProjectRepository().create(
            Script(
                id="series_project_4",
                title="Ep4",
                original_text="text",
                series_id="series_migration_2",
                characters=[Character(id="char_ep4_1", name="沈清辞", description="第二版角色")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        audit = SeriesCharacterMigrationService().build_series_audit("series_migration_2")

        self.assertEqual(audit["series_character_count"], 1)
        self.assertEqual(audit["project_character_count"], 2)
        self.assertEqual(audit["project_character_link_count"], 1)
        self.assertEqual(audit["frame_character_reference_count"], 1)
        self.assertEqual(audit["duplicate_candidate_group_count"], 1)
        self.assertEqual(audit["duplicate_candidates"][0]["normalized_name"], "沈清辞")
        self.assertEqual(audit["project_series_shadow_candidate_count"], 2)
        self.assertEqual({item["project_id"] for item in audit["project_series_shadow_candidates"]}, {"series_project_3", "series_project_4"})
        self.assertEqual({item["name"] for item in audit["project_series_shadow_candidates"]}, {"沈清辞"})
        self.assertEqual(len(audit["projects"]), 2)

    def test_build_series_audit_ignores_series_shared_characters_in_project_fallback_view(self):
        from src.application.services.series_character_migration_service import SeriesCharacterMigrationService
        from src.repository import ProjectRepository, SeriesRepository
        from src.schemas.models import Character, Script, Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_migration_3",
                title="Audit Shared Characters",
                description="desc",
                characters=[
                    Character(id="series_shared_char_1", name="柳若烟", description="系列共享角色"),
                ],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="series_project_5",
                title="Ep5",
                original_text="text",
                series_id="series_migration_3",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )
        ProjectRepository().create(
            Script(
                id="series_project_6",
                title="Ep6",
                original_text="text",
                series_id="series_migration_3",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        audit = SeriesCharacterMigrationService().build_series_audit("series_migration_3")

        self.assertEqual(audit["series_character_count"], 1)
        self.assertEqual(audit["project_character_count"], 0)
        self.assertEqual(audit["duplicate_candidate_group_count"], 0)
        self.assertEqual(audit["duplicate_candidates"], [])
        self.assertEqual(audit["project_series_shadow_candidate_count"], 0)
        self.assertEqual(audit["project_series_shadow_candidates"], [])
        self.assertEqual([item["character_count"] for item in audit["projects"]], [0, 0])


if __name__ == "__main__":
    unittest.main()
