import tempfile
import unittest
from pathlib import Path


class ModelProviderServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "model-provider-service.db"
        env_path = Path(self.temp_dir.name) / ".env"
        env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        override_env_path_for_tests(env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        from src.application.services.model_provider_service import ModelProviderService

        self.service = ModelProviderService()
        self.service.create_provider(
            {
                "provider_key": "DASHSCOPE",
                "display_name": "DashScope",
                "enabled": True,
                "base_url": "https://dashscope.example.com",
                "credential_fields": ["api_key"],
                "settings_json": {},
            }
        )
        self.service.create_model_catalog_entry(
            {
                "model_id": "wan2.6-t2i",
                "task_type": "t2i",
                "provider_key": "DASHSCOPE",
                "display_name": "Wan 2.6 T2I",
                "enabled": True,
                "is_public": True,
                "default_settings_json": {},
            }
        )
        self.service.create_model_catalog_entry(
            {
                "model_id": "wan2.5-t2i-preview",
                "task_type": "t2i",
                "provider_key": "DASHSCOPE",
                "display_name": "Wan 2.5 T2I Preview",
                "enabled": True,
                "is_public": True,
                "default_settings_json": {},
            }
        )

    def tearDown(self):
        from src.db.base import Base
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def test_list_available_models_filters_runtime_incomplete_models(self):
        catalog = self.service.list_available_models()
        model_ids = [item.model_id for item in catalog.t2i]

        self.assertIn("wan2.5-t2i-preview", model_ids)
        self.assertNotIn("wan2.6-t2i", model_ids)

    def test_ensure_model_settings_allowed_rejects_runtime_incomplete_model(self):
        with self.assertRaisesRegex(ValueError, "default_settings_json.request_path"):
            self.service.ensure_model_settings_allowed({"t2i_model": "wan2.6-t2i"})

    def test_resolve_model_for_execution_falls_back_to_safe_t2i_model(self):
        resolved = self.service.resolve_model_for_execution("wan2.6-t2i", "t2i")

        self.assertEqual(resolved, "wan2.5-t2i-preview")

    def test_resolve_model_execution_plan_returns_fallback_reason(self):
        plan = self.service.resolve_model_execution_plan("wan2.6-t2i", "t2i")

        self.assertEqual(plan["requested_model"], "wan2.6-t2i")
        self.assertEqual(plan["resolved_model"], "wan2.5-t2i-preview")
        self.assertIn("系统已回退到可运行模型", plan["fallback_reason"] or "")
