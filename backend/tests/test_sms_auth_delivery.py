import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class SmsAuthDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "sms-auth-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    f"DATABASE_URL=sqlite:///{db_path}",
                    "AUTH_JWT_SECRET=test-secret",
                    "AUTH_EXPOSE_TEST_CODE=true",
                    "AUTH_SMS_PROVIDER=mock",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory, init_database
        from src.providers.sms import reset_mock_sms_outbox
        from src.settings.env_settings import override_env_path_for_tests
        from src.application.services import AuthService

        reset_mock_sms_outbox()
        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()
        AuthService().ensure_default_roles()
        AuthService().ensure_existing_users_have_initial_password()

        from src.api.auth import router as auth_router

        app = FastAPI()
        app.include_router(auth_router)
        self.client = TestClient(app)

    def tearDown(self):
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory
        from src.settings.env_settings import override_env_path_for_tests

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def _captcha_payload(self):
        captcha_result = self.client.get("/auth/captcha")
        self.assertEqual(captcha_result.status_code, 200)
        payload = captcha_result.json()
        return {
            "captcha_id": payload["captcha_id"],
            "captcha_code": payload["debug_code"],
        }

    def test_phone_channel_sends_sms_without_debug_code(self):
        from src.providers.sms import get_mock_sms_outbox

        captcha = self._captcha_payload()
        send_result = self.client.post(
            "/auth/email-code/send",
            json={"target": "13800138000", "channel": "phone", "purpose": "signup", **captcha},
        )
        self.assertEqual(send_result.status_code, 200)
        payload = send_result.json()
        self.assertNotIn("debug_code", payload)

        outbox = get_mock_sms_outbox()
        self.assertEqual(len(outbox), 1)
        self.assertEqual(outbox[0].phone, "13800138000")
        self.assertEqual(outbox[0].purpose, "signup")
        self.assertTrue(outbox[0].code)
