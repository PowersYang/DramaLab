import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class AuthApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "auth-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    f"DATABASE_URL=sqlite:///{db_path}",
                    "AUTH_JWT_SECRET=test-secret",
                    "AUTH_EXPOSE_TEST_CODE=true",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database
        from src.application.services import AuthService

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()
        AuthService().ensure_default_roles()

        from src.api.auth import router as auth_router
        from src.api.project import router as project_router

        app = FastAPI()
        app.include_router(auth_router)
        app.include_router(project_router)
        self.app = app
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

    def _login(
        self,
        email: str,
        display_name: str | None = None,
        signup_kind: str | None = None,
        organization_name: str | None = None,
        purpose: str = "signup",
    ):
        send_result = self.client.post("/auth/email-code/send", json={"email": email, "purpose": purpose})
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]
        verify_result = self.client.post(
            "/auth/email-code/verify",
            json={
                "email": email,
                "code": debug_code,
                "purpose": purpose,
                "display_name": display_name,
                "signup_kind": signup_kind,
                "organization_name": organization_name,
            },
        )
        self.assertEqual(verify_result.status_code, 200)
        return verify_result.json()

    def test_email_signin_creates_personal_workspace_and_session(self):
        payload = self._login("creator@example.com", "Creator")
        me = payload["me"]

        self.assertEqual(me["user"]["email"], "creator@example.com")
        self.assertEqual(me["current_role_code"], "individual_creator")
        self.assertEqual(len(me["workspaces"]), 1)
        self.assertEqual(me["workspaces"][0]["workspace_name"], "默认工作区")
        self.assertIn("project.create", me["capabilities"])
        self.assertIn("lumenx_refresh_token", self.client.cookies)

    def test_authenticated_project_routes_are_scoped_to_current_workspace(self):
        login_payload = self._login("alice@example.com", "Alice")
        access_token = login_payload["session"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        created_project = self.client.post(
            "/projects?skip_analysis=true",
            json={"title": "Alice Draft", "text": "剧本草稿"},
            headers=headers,
        )
        self.assertEqual(created_project.status_code, 200)

        list_result = self.client.get("/projects/summaries", headers=headers)
        self.assertEqual(list_result.status_code, 200)
        self.assertEqual(len(list_result.json()), 1)
        self.assertEqual(list_result.json()[0]["title"], "Alice Draft")

        second_client = TestClient(self.app)
        second_send = second_client.post("/auth/email-code/send", json={"email": "bob@example.com", "purpose": "signup"}).json()
        second_login = second_client.post(
            "/auth/email-code/verify",
            json={"email": "bob@example.com", "code": second_send["debug_code"], "purpose": "signup", "display_name": "Bob"},
        ).json()
        second_headers = {"Authorization": f"Bearer {second_login['session']['access_token']}"}

        bob_list = second_client.get("/projects/summaries", headers=second_headers)
        self.assertEqual(bob_list.status_code, 200)
        self.assertEqual(bob_list.json(), [])

    def test_auth_refresh_restores_access_token(self):
        payload = self._login("refresh@example.com", "Refresh User")
        self.assertIn("access_token", payload["session"])

        refresh_result = self.client.post("/auth/refresh")
        self.assertEqual(refresh_result.status_code, 200)
        refreshed = refresh_result.json()
        self.assertEqual(refreshed["me"]["user"]["email"], "refresh@example.com")
        self.assertIn("access_token", refreshed["session"])

    def test_signin_requires_existing_account(self):
        send_result = self.client.post("/auth/email-code/send", json={"email": "missing@example.com", "purpose": "signin"})
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]

        verify_result = self.client.post(
            "/auth/email-code/verify",
            json={"email": "missing@example.com", "code": debug_code, "purpose": "signin"},
        )
        self.assertEqual(verify_result.status_code, 400)
        self.assertEqual(verify_result.json()["detail"], "Account not found, please sign up first")

    def test_signup_rejects_existing_account(self):
        self._login("existing@example.com", "Existing")
        send_result = self.client.post("/auth/email-code/send", json={"email": "existing@example.com", "purpose": "signup"})
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]

        verify_result = self.client.post(
            "/auth/email-code/verify",
            json={"email": "existing@example.com", "code": debug_code, "purpose": "signup", "display_name": "Another Name"},
        )
        self.assertEqual(verify_result.status_code, 400)
        self.assertEqual(verify_result.json()["detail"], "Account already exists, please sign in")

    def test_org_admin_signup_creates_team_workspace(self):
        payload = self._login(
            "owner@example.com",
            "Owner",
            signup_kind="org_admin",
            organization_name="银河短剧",
        )
        me = payload["me"]

        self.assertEqual(me["user"]["email"], "owner@example.com")
        self.assertEqual(me["current_role_code"], "org_admin")
        self.assertEqual(me["workspaces"][0]["organization_name"], "银河短剧")
        self.assertIn("workspace.manage_members", me["capabilities"])

    def test_invited_member_can_activate_account_without_personal_workspace_signup(self):
        owner_payload = self._login(
            "owner2@example.com",
            "Owner2",
            signup_kind="org_admin",
            organization_name="霓虹剧场",
        )
        owner_headers = {"Authorization": f"Bearer {owner_payload['session']['access_token']}"}

        invite_result = self.client.post(
            "/workspace/invitations",
            json={"email": "maker@example.com", "role_code": "producer"},
            headers=owner_headers,
        )
        self.assertEqual(invite_result.status_code, 200)

        verify_code = self.client.post(
            "/auth/email-code/send",
            json={"email": "maker@example.com", "purpose": "invite_accept"},
        )
        self.assertEqual(verify_code.status_code, 200)
        debug_code = verify_code.json()["debug_code"]

        invited_client = TestClient(self.app)
        accepted = invited_client.post(
            "/auth/email-code/verify",
            json={
                "email": "maker@example.com",
                "code": debug_code,
                "purpose": "invite_accept",
                "display_name": "Maker",
            },
        )
        self.assertEqual(accepted.status_code, 200)
        accepted_payload = accepted.json()
        self.assertEqual(accepted_payload["me"]["current_role_code"], "producer")
        self.assertEqual(len(accepted_payload["me"]["workspaces"]), 1)
        self.assertEqual(accepted_payload["me"]["workspaces"][0]["organization_name"], "霓虹剧场")


if __name__ == "__main__":
    unittest.main()
