import tempfile
from src.utils.datetime import utc_now
import unittest
from pathlib import Path


class RepositoryPersistenceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "repo-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        override_env_path_for_tests(self.env_path)
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

    def test_project_repository_round_trip_and_delete(self):
        from src.repository import ProjectRepository
        from src.schemas.models import (
            AssetUnit,
            Character,
            ImageAsset,
            ImageVariant,
            Scene,
            Script,
            StoryboardFrame,
            VideoTask,
            VideoVariant,
        )

        repository = ProjectRepository()
        now = utc_now()
        project_task = VideoTask(
            id="task_1",
            project_id="project_1",
            asset_id="char_1",
            image_url="img://1",
            prompt="animate",
            video_url="video://1",
            created_at=now,
        )
        project = Script(
            id="project_1",
            title="Episode 1",
            original_text="hello",
            characters=[
                Character(
                    id="char_1",
                    name="Hero",
                    description="lead",
                    full_body=AssetUnit(
                        selected_image_id="imgv_1",
                        image_variants=[
                            ImageVariant(id="imgv_1", url="oss://hero-full", created_at=now),
                        ],
                        selected_video_id="vidv_1",
                        video_variants=[
                            VideoVariant(id="vidv_1", url="oss://hero-motion", created_at=now),
                        ],
                    ),
                    full_body_asset=ImageAsset(
                        selected_id="legacy_img_1",
                        variants=[ImageVariant(id="legacy_img_1", url="oss://legacy", created_at=now)],
                    ),
                    video_assets=[project_task],
                )
            ],
            scenes=[
                Scene(
                    id="scene_1",
                    name="Room",
                    description="interior",
                    image_asset=ImageAsset(
                        selected_id="scene_img_1",
                        variants=[ImageVariant(id="scene_img_1", url="oss://scene", created_at=now)],
                    ),
                )
            ],
            props=[],
            frames=[
                StoryboardFrame(
                    id="frame_1",
                    scene_id="scene_1",
                    character_ids=["char_1"],
                    image_asset=ImageAsset(
                        selected_id="frame_img_1",
                        variants=[ImageVariant(id="frame_img_1", url="oss://frame", created_at=now)],
                    ),
                )
            ],
            video_tasks=[project_task],
            created_at=now,
            updated_at=now,
            organization_id="org_1",
            workspace_id="ws_1",
            created_by="user_1",
            updated_by="user_1",
        )

        repository.sync([project])
        loaded = repository.list_map()
        self.assertIn(project.id, loaded)
        self.assertEqual(loaded[project.id].organization_id, "org_1")
        self.assertEqual(loaded[project.id].title, "Episode 1")
        self.assertEqual(len(loaded[project.id].characters), 1)
        self.assertEqual(loaded[project.id].characters[0].full_body.image_variants[0].id, "imgv_1")
        self.assertEqual(loaded[project.id].characters[0].full_body.video_variants[0].id, "vidv_1")
        self.assertEqual(loaded[project.id].characters[0].full_body_asset.selected_id, "legacy_img_1")
        self.assertEqual(len(loaded[project.id].frames), 1)
        self.assertEqual(loaded[project.id].frames[0].image_asset.selected_id, "frame_img_1")
        self.assertEqual(len(loaded[project.id].video_tasks), 1)

        repository.sync([])
        self.assertEqual(repository.list_map(), {})

    def test_series_repository_round_trip(self):
        from src.repository import SeriesRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Series

        repository = SeriesRepository()
        now = utc_now()
        series = Series(
            id="series_1",
            title="Series 1",
            description="desc",
            characters=[
                Character(
                    id="series_char_1",
                    name="Shared Hero",
                    description="shared",
                    full_body=AssetUnit(
                        image_variants=[ImageVariant(id="shared_img_1", url="oss://shared", created_at=now)]
                    ),
                )
            ],
            created_at=now,
            updated_at=now,
            organization_id="org_1",
            workspace_id="ws_1",
            created_by="user_1",
            updated_by="user_1",
        )

        repository.sync([series])
        loaded = repository.list_map()
        self.assertIn(series.id, loaded)
        self.assertEqual(loaded[series.id].description, "desc")
        self.assertEqual(loaded[series.id].workspace_id, "ws_1")
        self.assertEqual(loaded[series.id].characters[0].full_body.image_variants[0].id, "shared_img_1")

    def test_child_repositories_support_independent_character_crud(self):
        from src.repository import CharacterRepository, ProjectRepository
        from src.schemas.models import Character, Script

        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_child_1",
                title="Child CRUD",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        ])

        repository = CharacterRepository()
        repository.save(
            "project",
            "project_child_1",
            Character(id="char_child_1", name="Alice", description="v1"),
        )

        loaded_project = ProjectRepository().list_map()["project_child_1"]
        self.assertEqual(len(loaded_project.characters), 1)
        self.assertEqual(loaded_project.characters[0].name, "Alice")

        repository.save(
            "project",
            "project_child_1",
            Character(id="char_child_1", name="Alice 2", description="v2"),
        )
        loaded_character = repository.get("project", "project_child_1", "char_child_1")
        self.assertIsNotNone(loaded_character)
        self.assertEqual(loaded_character.name, "Alice 2")

        repository.delete("project", "project_child_1", "char_child_1")
        self.assertEqual(repository.list_by_owner("project", "project_child_1"), [])
        self.assertIsNotNone(repository.get("project", "project_child_1", "char_child_1", include_deleted=True))

    def test_child_repositories_support_independent_frame_and_task_crud(self):
        from src.repository import ProjectRepository, StoryboardFrameRepository, VideoTaskRepository
        from src.schemas.models import ImageAsset, ImageVariant, Script, StoryboardFrame, VideoTask

        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_child_2",
                title="Frame CRUD",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        ])

        frame_repo = StoryboardFrameRepository()
        task_repo = VideoTaskRepository()

        frame_repo.save(
            "project_child_2",
            StoryboardFrame(
                id="frame_child_1",
                scene_id="scene_x",
                image_asset=ImageAsset(
                    selected_id="frame_variant_1",
                    variants=[ImageVariant(id="frame_variant_1", url="oss://frame-1", created_at=now)],
                ),
            ),
        )
        task_repo.save(
            VideoTask(
                id="task_child_1",
                project_id="project_child_2",
                frame_id="frame_child_1",
                image_url="oss://frame-1",
                prompt="animate it",
                created_at=now,
            )
        )

        loaded_project = ProjectRepository().list_map()["project_child_2"]
        self.assertEqual(len(loaded_project.frames), 1)
        self.assertEqual(loaded_project.frames[0].image_asset.selected_id, "frame_variant_1")
        self.assertEqual(len(loaded_project.video_tasks), 1)

        task = task_repo.get("project_child_2", "task_child_1")
        self.assertIsNotNone(task)
        self.assertEqual(task.frame_id, "frame_child_1")

        frame_repo.delete("project_child_2", "frame_child_1")
        task_repo.delete("project_child_2", "task_child_1")
        reloaded_project = ProjectRepository().list_map()["project_child_2"]
        self.assertEqual(reloaded_project.frames, [])
        self.assertEqual(reloaded_project.video_tasks, [])
        self.assertIsNotNone(task_repo.get("project_child_2", "task_child_1", include_deleted=True))

    def test_task_job_repository_supports_global_recent_queries(self):
        from src.repository import TaskJobRepository
        from src.schemas.task_models import TaskJob, TaskStatus

        repository = TaskJobRepository()
        now = utc_now()
        repository.create(
            TaskJob(
                id="job_global_1",
                task_type="project.export",
                status=TaskStatus.RUNNING,
                queue_name="export",
                project_id="project_a",
                created_at=now,
                updated_at=now,
                scheduled_at=now,
            )
        )
        repository.create(
            TaskJob(
                id="job_global_2",
                task_type="series.import.preview",
                status=TaskStatus.QUEUED,
                queue_name="system",
                series_id="series_a",
                created_at=utc_now(),
                updated_at=utc_now(),
                scheduled_at=utc_now(),
            )
        )

        all_jobs = repository.list_jobs(limit=10)
        self.assertEqual([job.id for job in all_jobs], ["job_global_2", "job_global_1"])

        queued_jobs = repository.list_jobs(statuses=["queued"], limit=10)
        self.assertEqual([job.id for job in queued_jobs], ["job_global_2"])

        project_jobs = repository.list_jobs(project_id="project_a", limit=10)
        self.assertEqual([job.id for job in project_jobs], ["job_global_1"])

    def test_project_soft_delete_hides_graph_from_default_queries(self):
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Script

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_soft_delete",
                title="Soft Delete",
                original_text="text",
                characters=[Character(id="char_soft_1", name="Alice", description="lead")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        repository.soft_delete("project_soft_delete")
        self.assertIsNone(repository.get("project_soft_delete"))
        self.assertIsNotNone(repository.get("project_soft_delete", include_deleted=True))

    def test_style_preset_repository_bootstrap_and_save(self):
        from src.application.services.default_style_presets import DEFAULT_STYLE_PRESETS
        from src.repository import StylePresetRepository

        repository = StylePresetRepository()
        repository.ensure_defaults(DEFAULT_STYLE_PRESETS)

        loaded = repository.list_active()
        self.assertEqual([preset.id for preset in loaded], [preset.id for preset in DEFAULT_STYLE_PRESETS])
        self.assertEqual(loaded[0].name, "Cinematic Realism")

        updated = repository.save(
            loaded[0].model_copy(
                update={
                    "description": "数据库内更新后的描述",
                    "sort_order": 5,
                }
            )
        )
        self.assertEqual(updated.description, "数据库内更新后的描述")
        self.assertEqual(repository.list_active()[0].id, updated.id)


if __name__ == "__main__":
    unittest.main()
