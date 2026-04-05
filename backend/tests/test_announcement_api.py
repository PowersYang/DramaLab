import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class AnnouncementApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "announcement-api-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.auth.dependencies import RequestContext, get_request_context
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database
        from src.schemas.models import AuthMeResponse, User
        from src.utils.datetime import utc_now

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        from src.api.announcement import router as announcement_router

        admin_user = User(
            id="user_admin",
            email="admin@example.com",
            display_name="Admin",
            auth_provider="email_otp",
            platform_role="platform_super_admin",
            status="active",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        member_user = User(
            id="user_member",
            email="member@example.com",
            display_name="Member",
            auth_provider="email_otp",
            platform_role="platform_member",
            status="active",
            created_at=utc_now(),
            updated_at=utc_now(),
        )

        self.admin_context = RequestContext(
            user=admin_user,
            me=AuthMeResponse(
                user=admin_user,
                current_workspace_id=None,
                current_organization_id=None,
                current_role_code=None,
                current_role_name=None,
                is_platform_super_admin=True,
                capabilities=["platform.manage"],
                workspaces=[],
                memberships=[],
            ),
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"platform.manage"},
            refresh_token=None,
        )
        self.member_context = RequestContext(
            user=member_user,
            me=AuthMeResponse(
                user=member_user,
                current_workspace_id=None,
                current_organization_id=None,
                current_role_code=None,
                current_role_name=None,
                is_platform_super_admin=False,
                capabilities=[],
                workspaces=[],
                memberships=[],
            ),
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities=set(),
            refresh_token=None,
        )
        self.current_context = self.admin_context

        app = FastAPI()
        app.include_router(announcement_router)
        app.dependency_overrides[get_request_context] = self._get_request_context
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

    def _get_request_context(self):
        """测试里按当前场景动态切换用户上下文，覆盖管理员与普通成员链路。"""
        return self.current_context

    def test_admin_can_create_announcement_and_member_can_read_it(self):
        self.current_context = self.admin_context
        created = self.client.post(
            "/announcements",
            json={
                "title": "平台维护通知",
                "content": "今晚 23:00 进行系统升级。",
                "status": "active",
                "priority": 2,
            },
        )
        # 这里当前会经过 signed_response 包装成 JSONResponse，实际返回码仍是 200。
        self.assertEqual(created.status_code, 200)
        payload = created.json()
        self.assertEqual(payload["created_by"], "user_admin")

        announcement_id = payload["id"]

        self.current_context = self.member_context
        listed = self.client.get("/announcements")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)
        self.assertFalse(listed.json()[0]["is_read"])

        marked = self.client.post(f"/announcements/{announcement_id}/read")
        self.assertEqual(marked.status_code, 200)

        fetched = self.client.get(f"/announcements/{announcement_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertTrue(fetched.json()["is_read"])
