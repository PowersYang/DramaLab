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

    def test_project_patch_metadata_bumps_version_and_enforces_optimistic_lock(self):
        from src.repository import ProjectRepository
        from src.schemas.models import Script

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_patch_meta_1",
                title="Patch Meta",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated = repository.patch_metadata(
            "project_patch_meta_1",
            {"title": "Patch Meta v2"},
            expected_version=1,
        )
        self.assertEqual(updated.title, "Patch Meta v2")
        self.assertEqual(updated.version, 2)

        with self.assertRaisesRegex(ValueError, "version conflict"):
            repository.patch_metadata(
                "project_patch_meta_1",
                {"title": "Patch Meta stale"},
                expected_version=1,
            )

    def test_project_timeline_round_trip(self):
        from src.repository import ProjectRepository
        from src.schemas.models import ProjectTimeline, Script, TimelineAsset, TimelineClip, TimelineTrack

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_timeline_1",
                title="Timeline",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                timeline=ProjectTimeline(
                    project_id="project_timeline_1",
                    version=1,
                    tracks=[TimelineTrack(id="track_video_main", track_type="video", label="视频", order=0)],
                    assets=[TimelineAsset(id="asset_video_1", kind="video", source_url="oss://video-1", label="镜头 1", source_duration=5)],
                    clips=[TimelineClip(id="clip_video_1", asset_id="asset_video_1", track_id="track_video_main", clip_order=0, timeline_start=0, timeline_end=5, source_start=0, source_end=5)],
                    updated_at=now,
                ),
                created_at=now,
                updated_at=now,
            )
        )

        loaded = repository.get("project_timeline_1")
        self.assertIsNotNone(loaded)
        self.assertIsNotNone(loaded.timeline)
        self.assertEqual(loaded.timeline.project_id, "project_timeline_1")
        self.assertEqual(loaded.timeline.tracks[0].track_type, "video")
        self.assertEqual(loaded.timeline.assets[0].source_url, "oss://video-1")

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

    def test_series_workflow_import_assets_appends_without_dropping_existing_assets(self):
        from src.application.workflows.series_workflow import SeriesWorkflow
        from src.repository import SeriesRepository
        from src.schemas.models import Character, Scene, Series

        now = utc_now()
        repository = SeriesRepository()
        repository.sync(
            [
                Series(
                    id="series_target_1",
                    title="Target",
                    description="target",
                    characters=[Character(id="target_char_1", name="Existing Hero", description="keep me")],
                    scenes=[Scene(id="target_scene_1", name="Existing Room", description="keep scene")],
                    props=[],
                    created_at=now,
                    updated_at=now,
                ),
                Series(
                    id="series_source_1",
                    title="Source",
                    description="source",
                    characters=[Character(id="source_char_1", name="Imported Hero", description="import me")],
                    scenes=[],
                    props=[],
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )

        updated_series, imported_ids, skipped_ids = SeriesWorkflow().import_assets_from_series(
            "series_target_1",
            "series_source_1",
            ["source_char_1"],
        )

        self.assertEqual(imported_ids, ["source_char_1"])
        self.assertEqual(skipped_ids, [])
        self.assertEqual({item.name for item in updated_series.characters}, {"Existing Hero", "Imported Hero"})
        self.assertEqual([item.id for item in updated_series.scenes], ["target_scene_1"])

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

    def test_project_repository_avoids_duplicate_image_variant_rows_when_character_legacy_and_unit_share_ids(self):
        from src.db.models import ImageVariantRecord
        from src.db.session import get_session_factory
        from src.repository import ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageAsset, ImageVariant, Script

        now = utc_now()
        shared_variant = ImageVariant(
            id="shared_img_variant_1",
            url="oss://shared-character",
            created_at=now,
        )
        project = Script(
            id="project_shared_variant_1",
            title="Shared Variant Project",
            original_text="text",
            characters=[
                Character(
                    id="char_shared_1",
                    name="Hero",
                    description="lead",
                    full_body=AssetUnit(
                        selected_image_id=shared_variant.id,
                        image_variants=[shared_variant.model_copy(deep=True)],
                    ),
                    full_body_asset=ImageAsset(
                        selected_id=shared_variant.id,
                        variants=[shared_variant.model_copy(deep=True)],
                    ),
                )
            ],
            scenes=[],
            props=[],
            frames=[],
            video_tasks=[],
            created_at=now,
            updated_at=now,
        )

        repository = ProjectRepository()
        repository.sync([project])
        loaded = repository.get("project_shared_variant_1")

        self.assertIsNotNone(loaded)
        self.assertEqual(len(loaded.characters), 1)
        self.assertEqual(loaded.characters[0].full_body.selected_image_id, "shared_img_variant_1")

        SessionFactory = get_session_factory()
        with SessionFactory() as session:
            rows = session.query(ImageVariantRecord).filter(ImageVariantRecord.id == "shared_img_variant_1").all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].owner_type, "character_asset_unit")

    def test_asset_service_select_variant_persists_latest_character_selection_when_only_unit_variants_exist(self):
        from src.application.services.asset_service import AssetService
        from src.repository import ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Script

        now = utc_now()
        repository = ProjectRepository()
        repository.sync([
            Script(
                id="project_select_variant_1",
                title="Select Variant",
                original_text="text",
                characters=[
                    Character(
                        id="char_select_1",
                        name="Hero",
                        description="lead",
                        full_body_image_url="oss://hero-a",
                        image_url="oss://hero-a",
                        full_body=AssetUnit(
                            selected_image_id="imgv_a",
                            image_variants=[
                                ImageVariant(id="imgv_a", url="oss://hero-a", created_at=now),
                                ImageVariant(id="imgv_b", url="oss://hero-b", created_at=now),
                            ],
                        ),
                    )
                ],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        ])

        updated_project = AssetService().select_variant(
            "project_select_variant_1",
            "char_select_1",
            "character",
            "imgv_b",
            "full_body",
        )
        selected_character = next(character for character in updated_project.characters if character.id == "char_select_1")

        self.assertEqual(selected_character.full_body.selected_image_id, "imgv_b")
        self.assertEqual(selected_character.full_body_asset.selected_id, "imgv_b")
        self.assertEqual(selected_character.full_body_image_url, "oss://hero-b")
        self.assertEqual(selected_character.image_url, "oss://hero-b")

        reloaded_project = repository.get("project_select_variant_1")
        self.assertIsNotNone(reloaded_project)
        reloaded_character = next(character for character in reloaded_project.characters if character.id == "char_select_1")
        self.assertEqual(reloaded_character.full_body.selected_image_id, "imgv_b")
        self.assertEqual(reloaded_character.full_body_asset.selected_id, "imgv_b")
        self.assertEqual(reloaded_character.full_body_image_url, "oss://hero-b")
        self.assertEqual(reloaded_character.image_url, "oss://hero-b")
        self.assertEqual(reloaded_project.version, 1)

    def test_character_repository_save_preserves_unmodified_panel_media_when_partial_character_is_saved(self):
        from src.repository import CharacterRepository, ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageAsset, ImageVariant, Script, VideoVariant

        now = utc_now()
        repository = ProjectRepository()
        repository.sync([
            Script(
                id="project_partial_character_save_1",
                title="Partial Character Save",
                original_text="text",
                characters=[
                    Character(
                        id="char_partial_1",
                        name="Hero",
                        description="lead",
                        full_body_image_url="oss://hero-full-2",
                        image_url="oss://hero-full-2",
                        full_body=AssetUnit(
                            selected_image_id="imgv_full_2",
                            image_variants=[
                                ImageVariant(id="imgv_full_1", url="oss://hero-full-1", created_at=now),
                                ImageVariant(id="imgv_full_2", url="oss://hero-full-2", created_at=now),
                            ],
                            selected_video_id="vidv_full_1",
                            video_variants=[
                                VideoVariant(id="vidv_full_1", url="oss://hero-motion-1", created_at=now),
                            ],
                        ),
                        full_body_asset=ImageAsset(
                            selected_id="imgv_full_2",
                            variants=[
                                ImageVariant(id="imgv_full_1", url="oss://hero-full-1", created_at=now),
                                ImageVariant(id="imgv_full_2", url="oss://hero-full-2", created_at=now),
                            ],
                        ),
                        three_view_image_url="oss://hero-sheet-2",
                        three_views=AssetUnit(
                            selected_image_id="imgv_sheet_2",
                            image_variants=[
                                ImageVariant(id="imgv_sheet_1", url="oss://hero-sheet-1", created_at=now),
                                ImageVariant(id="imgv_sheet_2", url="oss://hero-sheet-2", created_at=now),
                            ],
                        ),
                        headshot_image_url="oss://hero-head-2",
                        avatar_url="oss://hero-head-2",
                        head_shot=AssetUnit(
                            selected_image_id="imgv_head_2",
                            image_variants=[
                                ImageVariant(id="imgv_head_1", url="oss://hero-head-1", created_at=now),
                                ImageVariant(id="imgv_head_2", url="oss://hero-head-2", created_at=now),
                            ],
                            selected_video_id="vidv_head_1",
                            video_variants=[
                                VideoVariant(id="vidv_head_1", url="oss://hero-head-motion-1", created_at=now),
                            ],
                        ),
                    )
                ],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        ])

        CharacterRepository().save(
            "project",
            "project_partial_character_save_1",
            Character(
                id="char_partial_1",
                name="Hero",
                description="lead updated",
                full_body_image_url="oss://hero-full-4",
                image_url="oss://hero-full-4",
                full_body=AssetUnit(
                    selected_image_id="imgv_full_4",
                    image_variants=[
                        ImageVariant(id="imgv_full_1", url="oss://hero-full-1", created_at=now),
                        ImageVariant(id="imgv_full_2", url="oss://hero-full-2", created_at=now),
                        ImageVariant(id="imgv_full_3", url="oss://hero-full-3", created_at=now),
                        ImageVariant(id="imgv_full_4", url="oss://hero-full-4", created_at=now),
                    ],
                ),
            ),
        )

        reloaded_project = repository.get("project_partial_character_save_1")
        self.assertIsNotNone(reloaded_project)
        reloaded_character = reloaded_project.characters[0]
        self.assertEqual(reloaded_character.description, "lead updated")
        self.assertEqual(len(reloaded_character.full_body.image_variants), 4)
        self.assertEqual(reloaded_character.full_body.selected_image_id, "imgv_full_4")
        self.assertEqual(len(reloaded_character.full_body.video_variants), 1)
        self.assertEqual(reloaded_character.full_body.video_variants[0].id, "vidv_full_1")
        self.assertEqual(len(reloaded_character.three_views.image_variants), 2)
        self.assertEqual(reloaded_character.three_views.selected_image_id, "imgv_sheet_2")
        self.assertEqual(len(reloaded_character.head_shot.image_variants), 2)
        self.assertEqual(reloaded_character.head_shot.selected_image_id, "imgv_head_2")
        self.assertEqual(len(reloaded_character.head_shot.video_variants), 1)
        self.assertEqual(reloaded_character.head_shot.video_variants[0].id, "vidv_head_1")

    def test_character_repository_save_keeps_single_variant_row_when_legacy_and_unit_share_ids(self):
        from src.db.models import ImageVariantRecord
        from src.db.session import get_session_factory
        from src.repository import CharacterRepository, ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageAsset, ImageVariant, Script

        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_character_save_shared_variant_1",
                title="Character Save Shared Variant",
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

        shared_variant = ImageVariant(
            id="shared_save_variant_1",
            url="oss://shared-save-character",
            created_at=now,
        )

        CharacterRepository().save(
            "project",
            "project_character_save_shared_variant_1",
            Character(
                id="char_shared_save_1",
                name="Hero",
                description="lead",
                full_body=AssetUnit(
                    selected_image_id=shared_variant.id,
                    image_variants=[shared_variant.model_copy(deep=True)],
                ),
                full_body_asset=ImageAsset(
                    selected_id=shared_variant.id,
                    variants=[shared_variant.model_copy(deep=True)],
                ),
            ),
        )

        SessionFactory = get_session_factory()
        with SessionFactory() as session:
            rows = session.query(ImageVariantRecord).filter(ImageVariantRecord.id == shared_variant.id).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].owner_type, "character_asset_unit")

        reloaded_character = CharacterRepository().get(
            "project",
            "project_character_save_shared_variant_1",
            "char_shared_save_1",
        )
        self.assertIsNotNone(reloaded_character)
        self.assertEqual(reloaded_character.full_body.selected_image_id, shared_variant.id)
        self.assertEqual(reloaded_character.full_body_asset.selected_id, shared_variant.id)
        self.assertEqual(len(reloaded_character.full_body.image_variants), 1)
        self.assertEqual(len(reloaded_character.full_body_asset.variants), 1)

    def test_character_service_single_object_update_does_not_bump_project_version(self):
        from src.application.services.character_service import CharacterService
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Script

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_character_voice_1",
                title="Character Voice",
                original_text="text",
                characters=[Character(id="char_voice_1", name="Hero", description="lead")],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated_project = CharacterService().bind_voice(
            "project_character_voice_1",
            "char_voice_1",
            "voice_123",
            "Warm Voice",
        )
        self.assertEqual(updated_project.version, 1)
        updated_character = next(character for character in updated_project.characters if character.id == "char_voice_1")
        self.assertEqual(updated_character.voice_id, "voice_123")
        self.assertEqual(updated_character.voice_name, "Warm Voice")

    def test_storyboard_frame_single_object_update_does_not_bump_project_version(self):
        from src.application.services.storyboard_frame_service import StoryboardFrameService
        from src.repository import ProjectRepository
        from src.schemas.models import Script, StoryboardFrame

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_frame_patch_1",
                title="Frame Patch",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[
                    StoryboardFrame(
                        id="frame_patch_1",
                        scene_id="scene_x",
                        action_description="old action",
                    )
                ],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated_project = StoryboardFrameService().update_frame(
            "project_frame_patch_1",
            "frame_patch_1",
            action_description="new action",
        )
        self.assertEqual(updated_project.version, 1)
        self.assertEqual(updated_project.frames[0].action_description, "new action")

    def test_series_asset_single_object_update_does_not_bump_series_version(self):
        from src.application.services.series_service import SeriesService
        from src.repository import SeriesRepository
        from src.schemas.models import Character, Series

        now = utc_now()
        repository = SeriesRepository()
        repository.create(
            Series(
                id="series_asset_patch_1",
                title="Series Asset Patch",
                description="desc",
                characters=[Character(id="series_char_patch_1", name="Hero", description="old desc")],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )

        updated_series = SeriesService().update_asset_attributes(
            "series_asset_patch_1",
            "series_char_patch_1",
            "character",
            {"description": "new desc"},
        )
        self.assertEqual(updated_series.version, 1)
        self.assertEqual(updated_series.characters[0].description, "new desc")

    def test_project_repository_resave_keeps_character_unit_variants_active(self):
        from src.db.models import ImageVariantRecord, VideoVariantRecord
        from src.db.session import get_session_factory
        from src.repository import ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Script, VideoVariant

        now = utc_now()
        repository = ProjectRepository()
        project = Script(
            id="project_resave_variants_1",
            title="Resave Variants",
            original_text="text",
            characters=[
                Character(
                    id="char_resave_1",
                    name="Hero",
                    description="lead",
                    full_body=AssetUnit(
                        selected_image_id="imgv_keep_1",
                        image_variants=[
                            ImageVariant(id="imgv_keep_1", url="oss://hero-full", created_at=now),
                        ],
                        selected_video_id="vidv_keep_1",
                        video_variants=[
                            VideoVariant(id="vidv_keep_1", url="oss://hero-motion", created_at=now),
                        ],
                    ),
                    full_body_image_url="oss://hero-full",
                    image_url="oss://hero-full",
                )
            ],
            scenes=[],
            props=[],
            frames=[],
            video_tasks=[],
            created_at=now,
            updated_at=now,
        )

        repository.sync([project])
        repository.sync([project.model_copy(update={"title": "Resave Variants v2", "updated_at": utc_now()})])

        reloaded_project = repository.get("project_resave_variants_1")
        self.assertIsNotNone(reloaded_project)
        reloaded_character = reloaded_project.characters[0]
        self.assertEqual(len(reloaded_character.full_body.image_variants), 1)
        self.assertEqual(reloaded_character.full_body.image_variants[0].id, "imgv_keep_1")
        self.assertEqual(len(reloaded_character.full_body.video_variants), 1)
        self.assertEqual(reloaded_character.full_body.video_variants[0].id, "vidv_keep_1")

        SessionFactory = get_session_factory()
        with SessionFactory() as session:
            image_row = session.query(ImageVariantRecord).filter(ImageVariantRecord.id == "imgv_keep_1").one()
            video_row = session.query(VideoVariantRecord).filter(VideoVariantRecord.id == "vidv_keep_1").one()
            self.assertFalse(image_row.is_deleted)
            self.assertIsNone(image_row.deleted_at)
            self.assertFalse(video_row.is_deleted)
            self.assertIsNone(video_row.deleted_at)

    def test_project_repository_recovers_soft_deleted_character_unit_variants_on_read(self):
        from src.db.models import ImageVariantRecord, VideoVariantRecord
        from src.db.session import get_session_factory
        from src.repository import ProjectRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Script, VideoVariant

        now = utc_now()
        repository = ProjectRepository()
        repository.sync([
            Script(
                id="project_recover_variants_1",
                title="Recover Variants",
                original_text="text",
                characters=[
                    Character(
                        id="char_recover_1",
                        name="Hero",
                        description="lead",
                        full_body=AssetUnit(
                            selected_image_id="imgv_recover_1",
                            image_variants=[
                                ImageVariant(id="imgv_recover_1", url="oss://hero-recover-full", created_at=now),
                                ImageVariant(id="imgv_recover_2", url="oss://hero-recover-full-2", created_at=now),
                            ],
                            selected_video_id="vidv_recover_1",
                            video_variants=[
                                VideoVariant(id="vidv_recover_1", url="oss://hero-recover-motion", created_at=now),
                            ],
                        ),
                        full_body_image_url="oss://hero-recover-full",
                        image_url="oss://hero-recover-full",
                    )
                ],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                created_at=now,
                updated_at=now,
            )
        ])

        SessionFactory = get_session_factory()
        with SessionFactory() as session:
            session.query(ImageVariantRecord).filter(
                ImageVariantRecord.owner_type == "character_asset_unit",
                ImageVariantRecord.owner_id == "char_recover_1_full_body",
            ).update(
                {
                    "is_deleted": True,
                    "deleted_at": utc_now(),
                },
                synchronize_session=False,
            )
            session.query(VideoVariantRecord).filter(
                VideoVariantRecord.owner_type == "character_asset_unit",
                VideoVariantRecord.owner_id == "char_recover_1_full_body",
            ).update(
                {
                    "is_deleted": True,
                    "deleted_at": utc_now(),
                },
                synchronize_session=False,
            )
            session.commit()

        recovered_project = repository.get("project_recover_variants_1")
        self.assertIsNotNone(recovered_project)
        recovered_character = recovered_project.characters[0]
        self.assertEqual(len(recovered_character.full_body.image_variants), 2)
        self.assertEqual(
            [variant.id for variant in recovered_character.full_body.image_variants],
            ["imgv_recover_1", "imgv_recover_2"],
        )
        self.assertEqual(len(recovered_character.full_body.video_variants), 1)
        self.assertEqual(recovered_character.full_body.video_variants[0].id, "vidv_recover_1")

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

    def test_project_service_reparse_preserves_non_entity_graph_and_reuses_ids(self):
        from src.application.services.project_service import ProjectService
        from src.repository import ProjectRepository
        from src.schemas.models import Character, Prop, Scene, Script, StoryboardFrame, VideoTask

        now = utc_now()
        repository = ProjectRepository()
        repository.create(
            Script(
                id="project_reparse_keep_1",
                title="Reparse Keep",
                original_text="old text",
                characters=[Character(id="char_keep_1", name="Alice", description="old desc")],
                scenes=[Scene(id="scene_keep_1", name="Living Room", description="old room")],
                props=[Prop(id="prop_keep_1", name="Sword", description="old sword")],
                frames=[
                    StoryboardFrame(
                        id="frame_keep_1",
                        scene_id="scene_keep_1",
                        character_ids=["char_keep_1"],
                        prop_ids=["prop_keep_1"],
                        action_description="Alice holds the sword",
                    )
                ],
                video_tasks=[
                    VideoTask(
                        id="task_keep_1",
                        project_id="project_reparse_keep_1",
                        frame_id="frame_keep_1",
                        image_url="oss://frame-keep",
                        prompt="animate",
                        status="completed",
                        video_url="oss://video-keep",
                        created_at=now,
                    )
                ],
                merged_video_url="oss://merged-keep",
                created_at=now,
                updated_at=now,
            )
        )

        service = ProjectService()
        reparsed = Script(
            id="fresh_script_id",
            title="Reparse Keep",
            original_text="new text",
            characters=[
                Character(id="char_new_temp_1", name="Alice", description="new desc"),
                Character(id="char_new_temp_2", name="Bob", description="new teammate"),
            ],
            scenes=[Scene(id="scene_new_temp_1", name="Living Room", description="new room desc")],
            props=[Prop(id="prop_new_temp_1", name="Sword", description="new sword desc")],
            frames=[],
            video_tasks=[],
            created_at=now,
            updated_at=now,
        )
        service.text_provider.parse_novel = lambda title, text: reparsed.model_copy(deep=True)

        updated_project = service.reparse_project("project_reparse_keep_1", "new text")

        self.assertEqual(updated_project.version, 3)
        self.assertEqual(updated_project.original_text, "new text")
        self.assertEqual(updated_project.merged_video_url, "oss://merged-keep")
        self.assertEqual([frame.id for frame in updated_project.frames], ["frame_keep_1"])
        self.assertEqual([task.id for task in updated_project.video_tasks], ["task_keep_1"])
        self.assertEqual(
            {character.name: character.id for character in updated_project.characters},
            {
                "Alice": "char_keep_1",
                "Bob": "char_new_temp_2",
            },
        )
        self.assertEqual([scene.id for scene in updated_project.scenes], ["scene_keep_1"])
        self.assertEqual([prop.id for prop in updated_project.props], ["prop_keep_1"])

        reloaded_project = repository.get("project_reparse_keep_1")
        self.assertIsNotNone(reloaded_project)
        self.assertEqual(reloaded_project.frames[0].character_ids, ["char_keep_1"])
        self.assertEqual(reloaded_project.frames[0].scene_id, "scene_keep_1")
        self.assertEqual(reloaded_project.frames[0].prop_ids, ["prop_keep_1"])

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

    def test_user_art_style_repository_stores_one_style_per_row(self):
        from src.repository import UserArtStyleRepository, UserRepository
        from src.schemas.models import User, UserArtStyle

        now = utc_now()
        user_repository = UserRepository()
        user_repository.create(
            User(
                id="user_style_repo_1",
                email="style-repo@example.com",
                display_name="Style Repo",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )

        repository = UserArtStyleRepository()
        created = repository.replace_for_user(
            "user_style_repo_1",
            [
                UserArtStyle(
                    id="ink-drama",
                    user_id="user_style_repo_1",
                    name="水墨戏剧",
                    positive_prompt="ink wash, dramatic lighting",
                    negative_prompt="",
                    sort_order=0,
                )
            ],
        )
        reloaded = repository.list_by_user_id("user_style_repo_1")

        self.assertEqual(created[0].user_id, "user_style_repo_1")
        self.assertEqual(reloaded[0].id, "ink-drama")
        self.assertEqual(reloaded[0].positive_prompt, "ink wash, dramatic lighting")

        updated = repository.replace_for_user(
            "user_style_repo_1",
            [
                UserArtStyle(
                    id="noir",
                    user_id="user_style_repo_1",
                    name="黑色电影",
                    positive_prompt="film noir, high contrast",
                    negative_prompt="",
                    sort_order=0,
                )
            ],
        )
        self.assertEqual([style.id for style in updated], ["noir"])
        self.assertEqual([style.id for style in repository.list_by_user_id("user_style_repo_1")], ["noir"])

    def test_runtime_application_code_does_not_call_root_graph_save_helpers(self):
        application_root = Path(__file__).resolve().parents[1] / "src" / "application"
        forbidden_tokens = (
            "project_repository.save(",
            "project_repository.replace_graph(",
            "series_repository.save(",
            "series_repository.replace_graph(",
        )

        matches = []
        for path in application_root.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            for line_number, line in enumerate(text.splitlines(), start=1):
                if any(token in line for token in forbidden_tokens):
                    matches.append(f"{path.relative_to(application_root.parent)}:{line_number}: {line.strip()}")

        self.assertEqual(matches, [], "\n".join(matches))

    def test_project_and_series_command_services_are_used_only_in_cross_object_paths(self):
        application_root = Path(__file__).resolve().parents[1] / "src" / "application"
        allowed_paths = {
            "services/__init__.py",
            "services/project_command_service.py",
            "services/project_mutation_service.py",
            "services/project_service.py",
            "services/character_service.py",
            "services/scene_service.py",
            "services/prop_service.py",
            "services/storyboard_frame_service.py",
            "services/series_command_service.py",
            "services/series_mutation_service.py",
            "workflows/storyboard_workflow.py",
            "workflows/series_workflow.py",
        }
        command_tokens = (
            "ProjectCommandService",
            "project_command_service",
            "SeriesCommandService",
            "series_command_service",
        )

        unexpected = []
        for path in application_root.rglob("*.py"):
            rel_path = path.relative_to(application_root).as_posix()
            text = path.read_text(encoding="utf-8")
            if any(token in text for token in command_tokens) and rel_path not in allowed_paths:
                unexpected.append(rel_path)

        self.assertEqual(unexpected, [], "\n".join(unexpected))


if __name__ == "__main__":
    unittest.main()
