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
                    "AUTH_PLATFORM_SUPER_ADMIN_EMAILS=admin@example.com",
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
        AuthService().ensure_existing_users_have_initial_password()

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
        captcha = self._captcha_payload()
        send_result = self.client.post("/auth/email-code/send", json={"email": email, "purpose": purpose, **captcha})
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

    def _login_phone(
        self,
        phone: str,
        display_name: str | None = None,
        purpose: str = "signup",
    ):
        captcha = self._captcha_payload()
        send_result = self.client.post("/auth/email-code/send", json={"target": phone, "channel": "phone", "purpose": purpose, **captcha})
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]
        verify_result = self.client.post(
            "/auth/email-code/verify",
            json={
                "target": phone,
                "channel": "phone",
                "code": debug_code,
                "purpose": purpose,
                "display_name": display_name,
            },
        )
        self.assertEqual(verify_result.status_code, 200)
        return verify_result.json()

    def _captcha_payload(self, client: TestClient | None = None):
        resolved_client = client or self.client
        captcha_result = resolved_client.get("/auth/captcha")
        self.assertEqual(captcha_result.status_code, 200)
        payload = captcha_result.json()
        return {
            "captcha_id": payload["captcha_id"],
            "captcha_code": payload["debug_code"],
        }

    def test_email_signin_creates_personal_workspace_and_session(self):
        payload = self._login("creator@example.com", "Creator")
        me = payload["me"]

        self.assertEqual(me["user"]["email"], "creator@example.com")
        self.assertEqual(me["current_role_code"], "individual_creator")
        self.assertEqual(len(me["workspaces"]), 1)
        self.assertEqual(me["workspaces"][0]["workspace_name"], "默认工作区")
        self.assertIn("project.create", me["capabilities"])
        self.assertIn("dramalab_refresh_token", self.client.cookies)

    def test_phone_code_signup_creates_personal_workspace_and_session(self):
        payload = self._login_phone("13800138000", "Phone Creator")
        me = payload["me"]

        self.assertEqual(me["user"]["phone"], "13800138000")
        self.assertEqual(me["current_role_code"], "individual_creator")
        self.assertEqual(len(me["workspaces"]), 1)

    def test_signup_bootstraps_default_task_concurrency_limits(self):
        payload = self._login("concurrency@example.com", "Concurrency User")

        from src.application.services.task_concurrency_service import DEFAULT_NEW_ORGANIZATION_TASK_MAX_CONCURRENCY
        from src.repository import TaskConcurrencyLimitRepository
        from src.schemas.task_models import TaskType

        organization_id = payload["me"]["current_organization_id"]
        limits = [
            item
            for item in TaskConcurrencyLimitRepository().list()
            if item.organization_id == organization_id
        ]

        self.assertEqual(len(limits), len(TaskType))
        self.assertTrue(all(item.max_concurrency == DEFAULT_NEW_ORGANIZATION_TASK_MAX_CONCURRENCY for item in limits))
        self.assertEqual({item.task_type for item in limits}, {task_type.value for task_type in TaskType})

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
        second_send = second_client.post(
            "/auth/email-code/send",
            json={"email": "bob@example.com", "purpose": "signup", **self._captcha_payload(second_client)},
        ).json()
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
        send_result = self.client.post("/auth/email-code/send", json={"email": "missing@example.com", "purpose": "signin", **self._captcha_payload()})
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]

        verify_result = self.client.post(
            "/auth/email-code/verify",
            json={"email": "missing@example.com", "code": debug_code, "purpose": "signin"},
        )
        self.assertEqual(verify_result.status_code, 400)
        self.assertEqual(verify_result.json()["detail"], "Account not found, please sign up first")

    def test_password_signup_creates_session_and_workspace(self):
        signup_result = self.client.post(
            "/auth/password/signup",
            json={
                "email": "password-user@example.com",
                "password": "strong-pass-123",
                **self._captcha_payload(),
                "display_name": "Password User",
                "signup_kind": "individual_creator",
            },
        )
        self.assertEqual(signup_result.status_code, 200)
        payload = signup_result.json()
        self.assertEqual(payload["me"]["user"]["email"], "password-user@example.com")
        self.assertEqual(payload["me"]["user"]["auth_provider"], "email_password")
        self.assertIn("access_token", payload["session"])
        self.assertIn("dramalab_refresh_token", self.client.cookies)

    def test_password_signin_works_for_existing_password_account(self):
        signup_result = self.client.post(
            "/auth/password/signup",
            json={
                "email": "password-login@example.com",
                "password": "strong-pass-123",
                **self._captcha_payload(),
                "display_name": "Password Login",
            },
        )
        self.assertEqual(signup_result.status_code, 200)

        signin_client = TestClient(self.app)
        signin_result = signin_client.post(
            "/auth/password/signin",
            json={
                "email": "password-login@example.com",
                "password": "strong-pass-123",
                **self._captcha_payload(signin_client),
            },
        )
        self.assertEqual(signin_result.status_code, 200)
        payload = signin_result.json()
        self.assertEqual(payload["me"]["user"]["email"], "password-login@example.com")
        self.assertIn("dramalab_refresh_token", signin_client.cookies)

    def test_password_signin_rejects_wrong_password(self):
        self.client.post(
            "/auth/password/signup",
            json={
                "email": "password-wrong@example.com",
                "password": "strong-pass-123",
                **self._captcha_payload(),
                "display_name": "Wrong Password",
            },
        )
        signin_result = self.client.post(
            "/auth/password/signin",
            json={
                "email": "password-wrong@example.com",
                "password": "bad-pass-123",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(signin_result.status_code, 400)
        self.assertEqual(signin_result.json()["detail"], "Email or password is incorrect")

    def test_phone_password_signup_and_signin_work(self):
        signup_result = self.client.post(
            "/auth/password/signup",
            json={
                "identifier": "13800138001",
                "channel": "phone",
                "password": "strong-pass-123",
                **self._captcha_payload(),
                "display_name": "Phone Login",
            },
        )
        self.assertEqual(signup_result.status_code, 200)
        self.assertEqual(signup_result.json()["me"]["user"]["phone"], "13800138001")

        signin_result = self.client.post(
            "/auth/password/signin",
            json={
                "identifier": "13800138001",
                "channel": "phone",
                "password": "strong-pass-123",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(signin_result.status_code, 200)

    def test_phone_reset_password_with_code_signs_user_in(self):
        self.client.post(
            "/auth/password/signup",
            json={
                "identifier": "13800138002",
                "channel": "phone",
                "password": "123456",
                **self._captcha_payload(),
                "display_name": "Phone Reset",
            },
        )
        send_result = self.client.post(
            "/auth/email-code/send",
            json={"target": "13800138002", "channel": "phone", "purpose": "reset_password", **self._captcha_payload()},
        )
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]

        reset_result = self.client.post(
            "/auth/password/reset",
            json={
                "identifier": "13800138002",
                "channel": "phone",
                "code": debug_code,
                "new_password": "654321",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(reset_result.status_code, 200)

    def test_password_signup_rejects_short_password(self):
        signup_result = self.client.post(
            "/auth/password/signup",
            json={
                "email": "short-pass@example.com",
                "password": "12345",
                **self._captcha_payload(),
                "display_name": "Short Pass",
            },
        )
        self.assertEqual(signup_result.status_code, 400)
        self.assertEqual(signup_result.json()["detail"], "Password must be at least 6 characters")

    def test_existing_email_code_user_receives_default_initial_password(self):
        self._login("otp-user@example.com", "Otp User")

        from src.application.services import AuthService

        AuthService().ensure_existing_users_have_initial_password()
        signin_result = self.client.post(
            "/auth/password/signin",
            json={
                "email": "otp-user@example.com",
                "password": "123456",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(signin_result.status_code, 200)

    def test_reset_password_with_email_code_signs_user_in(self):
        self.client.post(
            "/auth/password/signup",
            json={
                "email": "reset-user@example.com",
                "password": "123456",
                **self._captcha_payload(),
                "display_name": "Reset User",
            },
        )
        send_result = self.client.post(
            "/auth/email-code/send",
            json={"email": "reset-user@example.com", "purpose": "reset_password", **self._captcha_payload()},
        )
        self.assertEqual(send_result.status_code, 200)
        debug_code = send_result.json()["debug_code"]

        reset_result = self.client.post(
            "/auth/password/reset",
            json={
                "email": "reset-user@example.com",
                "code": debug_code,
                "new_password": "654321",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(reset_result.status_code, 200)
        self.assertEqual(reset_result.json()["me"]["user"]["email"], "reset-user@example.com")

        signin_result = self.client.post(
            "/auth/password/signin",
            json={
                "email": "reset-user@example.com",
                "password": "654321",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(signin_result.status_code, 200)

    def test_change_password_updates_credentials_for_authenticated_user(self):
        signup_result = self.client.post(
            "/auth/password/signup",
            json={
                "email": "change-user@example.com",
                "password": "123456",
                **self._captcha_payload(),
                "display_name": "Change User",
            },
        )
        access_token = signup_result.json()["session"]["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}

        change_result = self.client.post(
            "/auth/password/change",
            json={
                "current_password": "123456",
                "new_password": "654321",
            },
            headers=headers,
        )
        self.assertEqual(change_result.status_code, 200)

        signin_result = self.client.post(
            "/auth/password/signin",
            json={
                "email": "change-user@example.com",
                "password": "654321",
                **self._captcha_payload(),
            },
        )
        self.assertEqual(signin_result.status_code, 200)

    def test_signup_rejects_existing_account(self):
        self._login("existing@example.com", "Existing")
        send_result = self.client.post("/auth/email-code/send", json={"email": "existing@example.com", "purpose": "signup", **self._captcha_payload()})
        self.assertEqual(send_result.status_code, 400)
        self.assertEqual(send_result.json()["detail"], "Account already exists, please sign in")

    def test_signup_rejects_reserved_platform_admin_email_before_sending_code(self):
        send_result = self.client.post("/auth/email-code/send", json={"email": "admin@example.com", "purpose": "signup", **self._captcha_payload()})
        self.assertEqual(send_result.status_code, 400)
        self.assertEqual(
            send_result.json()["detail"],
            "This email is reserved for platform administration and cannot use public sign up",
        )

    def test_send_code_requires_captcha(self):
        send_result = self.client.post(
            "/auth/email-code/send",
            json={"email": "nocaptcha@example.com", "purpose": "signup"},
        )
        self.assertEqual(send_result.status_code, 422)

    def test_send_code_is_rate_limited_per_identifier(self):
        first_send = self.client.post(
            "/auth/email-code/send",
            json={"email": "limit@example.com", "purpose": "signup", **self._captcha_payload()},
        )
        self.assertEqual(first_send.status_code, 200)

        second_send = self.client.post(
            "/auth/email-code/send",
            json={"email": "limit@example.com", "purpose": "signup", **self._captcha_payload()},
        )
        self.assertEqual(second_send.status_code, 429)
        self.assertIn("Too many verification code requests. Please retry in", second_send.json()["detail"])
        self.assertEqual(second_send.headers.get("retry-after"), "60")

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
            json={"email": "maker@example.com", "purpose": "invite_accept", **self._captcha_payload()},
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

    def test_invitation_preview_endpoint_returns_workspace_context(self):
        owner_payload = self._login(
            "owner3@example.com",
            "Owner3",
            signup_kind="org_admin",
            organization_name="曙光影业",
        )
        owner_headers = {"Authorization": f"Bearer {owner_payload['session']['access_token']}"}
        invite_result = self.client.post(
            "/workspace/invitations",
            json={"email": "preview@example.com", "role_code": "producer"},
            headers=owner_headers,
        )
        self.assertEqual(invite_result.status_code, 200)
        invitation_id = invite_result.json()["id"]

        preview_result = self.client.get(f"/auth/invitations/{invitation_id}")
        self.assertEqual(preview_result.status_code, 200)
        preview = preview_result.json()
        self.assertEqual(preview["organization_name"], "曙光影业")
        self.assertEqual(preview["role_code"], "producer")
        self.assertFalse(preview["is_expired"])

    def test_org_and_workspace_settings_can_be_updated(self):
        owner_payload = self._login(
            "owner4@example.com",
            "Owner4",
            signup_kind="org_admin",
            organization_name="旧团队名",
        )
        owner_headers = {"Authorization": f"Bearer {owner_payload['session']['access_token']}"}

        update_org = self.client.patch("/organization/current", json={"name": "新团队名"}, headers=owner_headers)
        self.assertEqual(update_org.status_code, 200)
        self.assertEqual(update_org.json()["name"], "新团队名")

        update_workspace = self.client.patch("/workspace/current", json={"name": "创作一组"}, headers=owner_headers)
        self.assertEqual(update_workspace.status_code, 200)
        self.assertEqual(update_workspace.json()["name"], "创作一组")

        refreshed = self.client.get("/auth/me", headers=owner_headers)
        self.assertEqual(refreshed.status_code, 200)
        refreshed_payload = refreshed.json()
        self.assertEqual(refreshed_payload["workspaces"][0]["organization_name"], "新团队名")
        self.assertEqual(refreshed_payload["workspaces"][0]["workspace_name"], "创作一组")


if __name__ == "__main__":
    unittest.main()
