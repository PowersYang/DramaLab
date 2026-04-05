import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class _StubSeriesMotionWorkflow:
    def __init__(self):
        self.series_calls = []
        self.project_calls = []

    def execute_series_motion_ref_generation(self, **kwargs):
        self.series_calls.append(kwargs)

        class _Series:
            id = kwargs["series_id"]

        return _Series()

    def execute_motion_ref_generation(self, **kwargs):
        self.project_calls.append(kwargs)

        class _Project:
            id = kwargs["script_id"]

        return _Project()


class _StubVideoProvider:
    def __init__(self, video_url: str):
        self.video_url = video_url
        self.calls = []

    def generate_i2v(self, **kwargs):
        self.calls.append(kwargs)
        return {"video_url": self.video_url}


class SeriesMotionRefTaskTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "series-motion-ref.db"
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

    def test_character_repository_save_auto_selects_first_video_variant_when_missing(self):
        from src.repository import CharacterRepository, SeriesRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Series, VideoVariant

        now = utc_now()
        series_repository = SeriesRepository()
        series_repository.create(
            Series(
                id="series_motion_ref_auto_select_1",
                title="Series Motion Ref",
                description="desc",
                characters=[
                    Character(
                        id="char_motion_ref_auto_select_1",
                        name="沈清辞",
                        description="京城女捕快",
                        full_body=AssetUnit(
                            selected_image_id="img_full_1",
                            image_variants=[
                                ImageVariant(id="img_full_1", url="oss://shenqingci-full", created_at=now),
                            ],
                        ),
                        full_body_image_url="oss://shenqingci-full",
                        image_url="oss://shenqingci-full",
                    )
                ],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )

        CharacterRepository().save(
            "series",
            "series_motion_ref_auto_select_1",
            Character(
                id="char_motion_ref_auto_select_1",
                name="沈清辞",
                description="京城女捕快",
                full_body=AssetUnit(
                    selected_image_id="img_full_1",
                    image_variants=[
                        ImageVariant(id="img_full_1", url="oss://shenqingci-full", created_at=now),
                    ],
                    video_variants=[
                        VideoVariant(id="vid_motion_1", url="oss://shenqingci-motion", created_at=now),
                    ],
                ),
                full_body_image_url="oss://shenqingci-full",
                image_url="oss://shenqingci-full",
            ),
        )

        reloaded_series = series_repository.get("series_motion_ref_auto_select_1")
        self.assertIsNotNone(reloaded_series)
        reloaded_character = reloaded_series.characters[0]
        self.assertEqual(len(reloaded_character.full_body.video_variants), 1)
        self.assertEqual(reloaded_character.full_body.video_variants[0].id, "vid_motion_1")
        self.assertEqual(reloaded_character.full_body.selected_video_id, "vid_motion_1")

    def test_asset_motion_ref_executor_uses_series_branch_without_project_id(self):
        from src.application.tasks.executors.asset_motion_ref import AssetMotionRefExecutor
        from src.schemas.task_models import TaskJob

        now = utc_now()
        executor = AssetMotionRefExecutor()
        stub_workflow = _StubSeriesMotionWorkflow()
        executor.asset_workflow = stub_workflow

        result = executor.execute(
            TaskJob(
                id="job_series_motion_ref_1",
                task_type="asset.motion_ref.generate",
                queue_name="video",
                payload_json={
                    "series_id": "series_motion_executor_1",
                    "asset_id": "char_motion_executor_1",
                    "asset_type": "full_body",
                    "prompt": "生成动态参考",
                    "duration": 5,
                    "batch_size": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )

        self.assertEqual(len(stub_workflow.series_calls), 1)
        self.assertEqual(stub_workflow.series_calls[0]["series_id"], "series_motion_executor_1")
        self.assertEqual(stub_workflow.project_calls, [])
        self.assertEqual(
            result,
            {
                "series_id": "series_motion_executor_1",
                "asset_id": "char_motion_executor_1",
                "asset_type": "full_body",
            },
        )

    def test_asset_motion_ref_executor_falls_back_to_job_series_id_when_payload_missing(self):
        from src.application.tasks.executors.asset_motion_ref import AssetMotionRefExecutor
        from src.schemas.task_models import TaskJob

        now = utc_now()
        executor = AssetMotionRefExecutor()
        stub_workflow = _StubSeriesMotionWorkflow()
        executor.asset_workflow = stub_workflow

        result = executor.execute(
            TaskJob(
                id="job_series_motion_ref_fallback_1",
                task_type="asset.motion_ref.generate",
                queue_name="video",
                series_id="series_motion_executor_fallback_1",
                payload_json={
                    "asset_id": "char_motion_executor_1",
                    "asset_type": "full_body",
                    "prompt": "生成动态参考",
                    "duration": 5,
                    "batch_size": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )

        self.assertEqual(len(stub_workflow.series_calls), 1)
        self.assertEqual(stub_workflow.series_calls[0]["series_id"], "series_motion_executor_fallback_1")
        self.assertEqual(stub_workflow.project_calls, [])
        self.assertEqual(
            result,
            {
                "series_id": "series_motion_executor_fallback_1",
                "asset_id": "char_motion_executor_1",
                "asset_type": "full_body",
            },
        )

    def test_asset_motion_ref_executor_prefers_job_scope_over_payload_scope(self):
        from src.application.tasks.executors.asset_motion_ref import AssetMotionRefExecutor
        from src.schemas.task_models import TaskJob

        now = utc_now()
        executor = AssetMotionRefExecutor()
        stub_workflow = _StubSeriesMotionWorkflow()
        executor.asset_workflow = stub_workflow

        result = executor.execute(
            TaskJob(
                id="job_series_motion_ref_scope_priority_1",
                task_type="asset.motion_ref.generate",
                queue_name="video",
                # 主表 scope 指向 series，payload 故意塞入 project_id，验证执行器不会被 payload 路由污染。
                series_id="series_motion_executor_priority_1",
                payload_json={
                    "project_id": "project_should_not_be_used",
                    "asset_id": "char_motion_executor_1",
                    "asset_type": "full_body",
                    "prompt": "生成动态参考",
                    "duration": 5,
                    "batch_size": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )

        self.assertEqual(len(stub_workflow.series_calls), 1)
        self.assertEqual(stub_workflow.series_calls[0]["series_id"], "series_motion_executor_priority_1")
        self.assertEqual(stub_workflow.project_calls, [])
        self.assertEqual(
            result,
            {
                "series_id": "series_motion_executor_priority_1",
                "asset_id": "char_motion_executor_1",
                "asset_type": "full_body",
            },
        )

    def test_execute_series_motion_ref_generation_persists_video_and_selected_video(self):
        from src.application.workflows.asset_workflow import AssetWorkflow
        from src.repository import SeriesRepository
        from src.schemas.models import AssetUnit, Character, ImageVariant, Series

        now = utc_now()
        series_repository = SeriesRepository()
        series_repository.create(
            Series(
                id="series_motion_ref_workflow_1",
                title="Series Workflow Motion Ref",
                description="desc",
                characters=[
                    Character(
                        id="char_motion_ref_workflow_1",
                        name="沈清辞",
                        description="京城女捕快",
                        full_body=AssetUnit(
                            selected_image_id="img_full_workflow_1",
                            image_variants=[
                                ImageVariant(id="img_full_workflow_1", url="oss://shenqingci-full-workflow", created_at=now),
                            ],
                        ),
                        full_body_image_url="oss://shenqingci-full-workflow",
                        image_url="oss://shenqingci-full-workflow",
                    )
                ],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )

        workflow = AssetWorkflow()
        stub_video_provider = _StubVideoProvider("oss://shenqingci-motion-workflow")
        workflow.video_provider = stub_video_provider

        updated_series = workflow.execute_series_motion_ref_generation(
            series_id="series_motion_ref_workflow_1",
            asset_id="char_motion_ref_workflow_1",
            asset_type="full_body",
            prompt="请生成角色动态参考视频",
            duration=5,
            batch_size=1,
        )

        self.assertEqual(updated_series.id, "series_motion_ref_workflow_1")
        self.assertEqual(len(stub_video_provider.calls), 1)

        reloaded_series = series_repository.get("series_motion_ref_workflow_1")
        self.assertIsNotNone(reloaded_series)
        reloaded_character = reloaded_series.characters[0]
        self.assertEqual(len(reloaded_character.full_body.video_variants), 1)
        self.assertEqual(reloaded_character.full_body.video_variants[0].url, "oss://shenqingci-motion-workflow")
        self.assertEqual(
            reloaded_character.full_body.selected_video_id,
            reloaded_character.full_body.video_variants[0].id,
        )

    def test_asset_motion_ref_executor_preserves_project_branch(self):
        from src.application.tasks.executors.asset_motion_ref import AssetMotionRefExecutor
        from src.schemas.task_models import TaskJob

        now = utc_now()
        executor = AssetMotionRefExecutor()
        stub_workflow = _StubSeriesMotionWorkflow()
        executor.asset_workflow = stub_workflow

        result = executor.execute(
            TaskJob(
                id="job_project_motion_ref_1",
                task_type="asset.motion_ref.generate",
                queue_name="video",
                payload_json={
                    "project_id": "project_motion_executor_1",
                    "asset_id": "char_motion_executor_1",
                    "asset_type": "full_body",
                    "prompt": "生成动态参考",
                    "duration": 5,
                    "batch_size": 1,
                },
                created_at=now,
                updated_at=now,
            )
        )

        self.assertEqual(len(stub_workflow.project_calls), 1)
        self.assertEqual(stub_workflow.project_calls[0]["script_id"], "project_motion_executor_1")
        self.assertEqual(stub_workflow.series_calls, [])
        self.assertEqual(
            result,
            {
                "project_id": "project_motion_executor_1",
                "asset_id": "char_motion_executor_1",
                "asset_type": "full_body",
            },
        )

    def test_retry_series_motion_ref_job_moves_to_dedicated_queue(self):
        from src.application.tasks.service import TaskService
        from src.repository import SeriesRepository
        from src.schemas.models import Series

        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_motion_ref_retry_1",
                title="Series Motion Retry",
                description="desc",
                characters=[],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )

        task_service = TaskService()
        receipt = task_service.create_job(
            task_type="asset.motion_ref.generate",
            payload={
                "series_id": "series_motion_ref_retry_1",
                "asset_id": "char_motion_ref_retry_1",
                "asset_type": "full_body",
            },
            project_id=None,
            series_id="series_motion_ref_retry_1",
            queue_name="video",
            resource_type="full_body",
            resource_id="char_motion_ref_retry_1",
        )
        task_service.mark_job_failed(receipt.job_id, "simulated failure")
        retried = task_service.retry_job(receipt.job_id)

        self.assertEqual(retried.queue_name, "video_series_motion")
        self.assertEqual(retried.status.value, "queued")


if __name__ == "__main__":
    unittest.main()
