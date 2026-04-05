import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class ProjectTimelineApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "timeline-api-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.auth.dependencies import RequestContext, get_request_context
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database
        from src.schemas.models import AuthMeResponse, Script, StoryboardFrame, User, VideoTask
        from src.repository import ProjectRepository
        from src.utils.datetime import utc_now

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        now = utc_now()
        ProjectRepository().create(
            Script(
                id="project_timeline_api_1",
                title="Timeline API",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[
                    StoryboardFrame(
                        id="frame_1",
                        scene_id="scene_1",
                        frame_order=0,
                        selected_video_id="video_1",
                        audio_url="oss://dialogue.mp3",
                        sfx_url="oss://sfx.mp3",
                    )
                ],
                video_tasks=[
                    VideoTask(
                        id="video_1",
                        project_id="project_timeline_api_1",
                        frame_id="frame_1",
                        image_url="oss://image.png",
                        prompt="animate",
                        status="completed",
                        video_url="oss://video.mp4",
                        duration=5,
                        created_at=now,
                    )
                ],
                created_at=now,
                updated_at=now,
            )
        )

        from src.api.media import router as media_router

        app = FastAPI()
        app.include_router(media_router)
        app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=User(
                id="user_1",
                email="user@example.com",
                display_name="User",
                auth_provider="email_otp",
                platform_role="platform_member",
                status="active",
                created_at=now,
                updated_at=now,
            ),
            me=AuthMeResponse(
                user=User(
                    id="user_1",
                    email="user@example.com",
                    display_name="User",
                    auth_provider="email_otp",
                    platform_role="platform_member",
                    status="active",
                    created_at=now,
                    updated_at=now,
                ),
                capabilities=[],
            ),
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities=set(),
            refresh_token=None,
        )
        self.client = TestClient(app)

    def tearDown(self):
        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def test_get_and_update_project_timeline(self):
        timeline = self.client.get("/projects/project_timeline_api_1/timeline")
        self.assertEqual(timeline.status_code, 200)
        payload = timeline.json()
        self.assertEqual(payload["project_id"], "project_timeline_api_1")
        self.assertEqual(len(payload["tracks"]), 4)
        self.assertEqual(payload["clips"][0]["track_id"], "track_video_main")
        self.assertIn("diagnostics", payload)
        self.assertIn("video_clip_count", payload["diagnostics"])
        self.assertIn("summary_notes", payload["diagnostics"])
        self.assertIn("export_readiness", payload["diagnostics"])
        self.assertIn("flags", payload["diagnostics"])
        dialogue_asset = next(item for item in payload["assets"] if item["role"] == "dialogue")
        self.assertIn("metadata", dialogue_asset)

        video_clip = next(item for item in payload["clips"] if item["track_id"] == "track_video_main")
        video_clip["source_start"] = 1.0
        video_clip["source_end"] = 4.0
        dialogue_clip = next(item for item in payload["clips"] if item["track_id"] == "track_dialogue_main")
        dialogue_clip["timeline_start"] = 1.5
        dialogue_clip["timeline_end"] = 4.5
        dialogue_clip["source_start"] = 0.5
        dialogue_clip["source_end"] = 3.5
        dialogue_clip["volume"] = 0.65

        updated = self.client.put(
            "/projects/project_timeline_api_1/timeline",
            json={
                "version": payload["version"],
                "tracks": payload["tracks"],
                "assets": payload["assets"],
                "clips": payload["clips"],
            },
        )
        self.assertEqual(updated.status_code, 200)
        updated_payload = updated.json()
        updated_video_clip = next(item for item in updated_payload["clips"] if item["track_id"] == "track_video_main")
        updated_dialogue_clip = next(item for item in updated_payload["clips"] if item["track_id"] == "track_dialogue_main")
        self.assertEqual(updated_video_clip["source_start"], 1.0)
        self.assertEqual(updated_video_clip["source_end"], 4.0)
        self.assertEqual(updated_dialogue_clip["timeline_start"], 1.5)
        self.assertEqual(updated_dialogue_clip["timeline_end"], 4.5)
        self.assertEqual(updated_dialogue_clip["source_start"], 0.5)
        self.assertEqual(updated_dialogue_clip["source_end"], 3.5)
        self.assertEqual(updated_dialogue_clip["volume"], 0.65)
        self.assertIn("diagnostics", updated_payload)
        self.assertGreaterEqual(updated_payload["diagnostics"]["audio_clip_count"], 1)
        self.assertGreater(updated_payload["version"], payload["version"])

    def test_get_project_timeline_preserves_existing_waveform_metadata(self):
        timeline = self.client.get("/projects/project_timeline_api_1/timeline")
        payload = timeline.json()
        dialogue_asset = next(item for item in payload["assets"] if item["role"] == "dialogue")
        dialogue_asset["metadata"] = {
            "waveform_peaks": [0.2, 0.6, 0.4],
            "waveform_bucket_count": 3,
        }

        updated = self.client.put(
            "/projects/project_timeline_api_1/timeline",
            json={
                "version": payload["version"],
                "tracks": payload["tracks"],
                "assets": payload["assets"],
                "clips": payload["clips"],
            },
        )
        self.assertEqual(updated.status_code, 200)
        updated_payload = updated.json()
        persisted_dialogue_asset = next(item for item in updated_payload["assets"] if item["role"] == "dialogue")
        self.assertEqual(persisted_dialogue_asset["metadata"]["waveform_peaks"], [0.2, 0.6, 0.4])
        self.assertEqual(persisted_dialogue_asset["metadata"]["waveform_bucket_count"], 3)
