import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class AssetJobApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "asset-job-api-test.db"
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

        from src.auth.constants import CAP_ASSET_EDIT
        from src.auth.dependencies import RequestContext, get_request_context
        from src.schemas.models import AuthMeResponse, User
        from src.utils.datetime import utc_now

        now = utc_now()
        user = User(
            id="user_asset_api_1",
            email="asset@example.com",
            display_name="Asset API User",
            auth_provider="email_otp",
            platform_role=None,
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.context = RequestContext(
            user=user,
            me=AuthMeResponse(
                user=user,
                current_workspace_id=None,
                current_organization_id=None,
                current_role_code=None,
                current_role_name=None,
                is_platform_super_admin=False,
                capabilities=[CAP_ASSET_EDIT],
                workspaces=[],
                memberships=[],
            ),
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={CAP_ASSET_EDIT},
            refresh_token=None,
        )

        from src.api.asset import router as project_asset_router
        from src.api.asset_job import router as asset_job_router
        from src.api.series import router as series_router

        app = FastAPI()
        app.include_router(asset_job_router)
        app.include_router(project_asset_router)
        app.include_router(series_router)
        app.dependency_overrides[get_request_context] = lambda: self.context
        self.client = TestClient(app)

        from src.repository import ProjectCharacterLinkRepository, ProjectRepository, SeriesRepository
        from src.schemas.models import Character, ProjectCharacterLink, Scene, Script, Series

        self.series_id = "series_asset_job_api_1"
        self.project_id = "project_asset_job_api_1"
        self.character_id = "char_asset_job_api_1"
        self.scene_id = "scene_asset_job_api_1"

        SeriesRepository().create(
            Series(
                id=self.series_id,
                title="Series Asset Job",
                description="desc",
                characters=[
                    Character(
                        id=self.character_id,
                        name="王叔",
                        canonical_name="王叔",
                        description="系列角色",
                    )
                ],
                scenes=[],
                props=[],
                created_at=now,
                updated_at=now,
            )
        )
        from src.repository import SceneRepository
        SceneRepository().save(
            "series",
            self.series_id,
            Scene(
                id=self.scene_id,
                name="审讯室",
                description="昏暗、冷色调、桌椅金属质感",
            ),
        )
        ProjectRepository().create(
            Script(
                id=self.project_id,
                title="Episode 1",
                original_text="text",
                series_id=self.series_id,
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
            self.project_id,
            self.series_id,
            [
                ProjectCharacterLink(
                    id="pcl_asset_job_api_1",
                    project_id=self.project_id,
                    series_id=self.series_id,
                    character_id=self.character_id,
                    source_name="王叔",
                    match_status="confirmed",
                    created_at=now,
                    updated_at=now,
                )
            ],
        )

    def tearDown(self):
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory
        from src.settings.env_settings import override_env_path_for_tests

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def test_generate_asset_from_series_project_character_routes_to_series_scope(self):
        from src.application.tasks import TaskService

        response = self.client.post(
            "/asset-jobs/generate",
            json={
                "project_id": self.project_id,
                "asset_id": self.character_id,
                "asset_type": "character",
                "generation_type": "full_body",
                "prompt": "角色立绘",
                "apply_style": True,
                "batch_size": 1,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["task_type"], "asset.generate")
        self.assertEqual(payload["project_id"], self.project_id)
        self.assertEqual(payload["series_id"], self.series_id)

        job = TaskService().get_job(payload["job_id"])
        self.assertIsNotNone(job)
        self.assertEqual(job.project_id, self.project_id)
        self.assertEqual(job.series_id, self.series_id)
        self.assertEqual(job.task_type, "asset.generate")

    def test_generate_motion_ref_from_series_project_character_uses_series_queue(self):
        response = self.client.post(
            "/asset-jobs/generate_motion_ref",
            json={
                "project_id": self.project_id,
                "asset_id": self.character_id,
                "asset_type": "full_body",
                "prompt": "动作参考",
                "duration": 5,
                "batch_size": 1,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["task_type"], "asset.motion_ref.generate")
        self.assertEqual(payload["project_id"], self.project_id)
        self.assertEqual(payload["series_id"], self.series_id)
        self.assertEqual(payload["queue_name"], "video_series_motion")

    def test_generate_asset_with_series_id_only_routes_to_series_scope(self):
        response = self.client.post(
            "/asset-jobs/generate",
            json={
                "series_id": self.series_id,
                "asset_id": self.character_id,
                "asset_type": "character",
                "generation_type": "headshot",
                "prompt": "头像",
                "apply_style": True,
                "batch_size": 1,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsNone(payload["project_id"])
        self.assertEqual(payload["series_id"], self.series_id)

    def test_generate_asset_persists_image_prompt_state_and_can_be_read_back(self):
        create_response = self.client.post(
            "/asset-jobs/generate",
            json={
                "series_id": self.series_id,
                "asset_id": self.character_id,
                "asset_type": "character",
                "generation_type": "full_body",
                "prompt": "角色正向提示词A",
                "negative_prompt": "角色负向提示词A",
                "apply_style": True,
                "batch_size": 1,
            },
        )
        self.assertEqual(create_response.status_code, 200)

        list_response = self.client.get(
            "/asset-jobs/prompt-states",
            params={
                "series_id": self.series_id,
                "asset_id": self.character_id,
                "asset_type": "character",
            },
        )
        self.assertEqual(list_response.status_code, 200)
        payload = list_response.json()
        states = payload.get("states") or []
        full_body_state = next((item for item in states if item["output_type"] == "image" and item["slot_type"] == "full_body"), None)
        self.assertIsNotNone(full_body_state)
        self.assertEqual(full_body_state["positive_prompt"], "角色正向提示词A")
        self.assertEqual(full_body_state["negative_prompt"], "角色负向提示词A")

    def test_generate_motion_ref_persists_motion_prompt_state_with_character_slot(self):
        create_response = self.client.post(
            "/asset-jobs/generate_motion_ref",
            json={
                "series_id": self.series_id,
                "asset_id": self.character_id,
                "asset_type": "head_shot",
                "prompt": "头像动态提示词B",
                "negative_prompt": "头像动态负向词B",
                "duration": 5,
                "batch_size": 1,
            },
        )
        self.assertEqual(create_response.status_code, 200)

        list_response = self.client.get(
            "/asset-jobs/prompt-states",
            params={
                "series_id": self.series_id,
                "asset_id": self.character_id,
                "asset_type": "character",
                "output_type": "motion",
            },
        )
        self.assertEqual(list_response.status_code, 200)
        payload = list_response.json()
        states = payload.get("states") or []
        headshot_motion_state = next((item for item in states if item["slot_type"] == "head_shot"), None)
        self.assertIsNotNone(headshot_motion_state)
        self.assertEqual(headshot_motion_state["positive_prompt"], "头像动态提示词B")
        self.assertEqual(headshot_motion_state["negative_prompt"], "头像动态负向词B")

    def test_generate_scene_prompt_state_uses_default_slot(self):
        create_response = self.client.post(
            "/asset-jobs/generate",
            json={
                "series_id": self.series_id,
                "asset_id": self.scene_id,
                "asset_type": "scene",
                "generation_type": "all",
                "prompt": "场景正向提示词C",
                "negative_prompt": "场景负向提示词C",
                "apply_style": True,
                "batch_size": 1,
            },
        )
        self.assertEqual(create_response.status_code, 200)

        list_response = self.client.get(
            "/asset-jobs/prompt-states",
            params={
                "series_id": self.series_id,
                "asset_id": self.scene_id,
                "asset_type": "scene",
                "output_type": "image",
            },
        )
        self.assertEqual(list_response.status_code, 200)
        payload = list_response.json()
        states = payload.get("states") or []
        default_state = next((item for item in states if item["slot_type"] == "default"), None)
        self.assertIsNotNone(default_state)
        self.assertEqual(default_state["positive_prompt"], "场景正向提示词C")
        self.assertEqual(default_state["negative_prompt"], "场景负向提示词C")

    def test_legacy_generate_endpoints_return_410(self):
        project_response = self.client.post(
            f"/projects/{self.project_id}/assets/generate",
            json={
                "asset_id": self.character_id,
                "asset_type": "character",
                "generation_type": "full_body",
                "prompt": "角色立绘",
            },
        )
        self.assertEqual(project_response.status_code, 410)

        series_response = self.client.post(
            f"/series/{self.series_id}/assets/generate",
            json={
                "asset_id": self.character_id,
                "asset_type": "character",
                "generation_type": "full_body",
                "prompt": "角色立绘",
            },
        )
        self.assertEqual(series_response.status_code, 410)


if __name__ == "__main__":
    unittest.main()
