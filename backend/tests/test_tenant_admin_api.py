import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class TenantAdminApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "tenant-admin-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.auth.dependencies import RequestContext, get_request_context, require_platform_role
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database
        from src.repository import UserRepository
        from src.schemas.models import User
        from src.application.services.model_provider_service import ModelProviderService
        from src.utils.datetime import utc_now

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()
        model_provider_service = ModelProviderService()
        model_provider_service.create_provider(
            {
                "provider_key": "DASHSCOPE",
                "display_name": "DashScope",
                "enabled": True,
                "base_url": "https://dashscope.example.com",
                "credential_fields": ["api_key"],
                "settings_json": {
                    "default_text_model": "qwen3.5-plus",
                    "client_base_path": "/compatible-mode/v1",
                },
            }
        )
        model_provider_service.create_model_catalog_entry(
            {
                "model_id": "wan2.6-t2i",
                "task_type": "t2i",
                "provider_key": "DASHSCOPE",
                "display_name": "Wan 2.6 T2I",
                "enabled": True,
                "is_public": True,
            }
        )
        model_provider_service.create_model_catalog_entry(
            {
                "model_id": "wan2.6-image",
                "task_type": "i2i",
                "provider_key": "DASHSCOPE",
                "display_name": "Wan 2.6 Image",
                "enabled": True,
                "is_public": True,
            }
        )
        model_provider_service.create_model_catalog_entry(
            {
                "model_id": "wan2.6-i2v",
                "task_type": "i2v",
                "provider_key": "DASHSCOPE",
                "display_name": "Wan 2.6 I2V",
                "enabled": True,
                "is_public": True,
            }
        )
        model_provider_service.create_provider(
            {
                "provider_key": "KLING",
                "display_name": "Kling",
                "enabled": True,
                "base_url": "https://kling.example.com",
                "credential_fields": ["access_key", "secret_key"],
                "settings_json": {},
            }
        )
        model_provider_service.create_model_catalog_entry(
            {
                "model_id": "kling-v3",
                "task_type": "i2v",
                "provider_key": "KLING",
                "display_name": "Kling V3",
                "enabled": False,
                "is_public": True,
            }
        )
        UserRepository().create(
            User(
                id="user_super_admin",
                email="admin@example.com",
                display_name="Admin",
                auth_provider="email_otp",
                platform_role="platform_super_admin",
                status="active",
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )

        from src.api.billing import router as billing_router
        from src.api.tenant_admin import router as tenant_admin_router
        from src.api.system import router as system_router

        app = FastAPI()
        app.include_router(billing_router)
        app.include_router(tenant_admin_router)
        app.include_router(system_router)
        app.dependency_overrides[require_platform_role] = lambda: None
        app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=User(
                id="user_super_admin",
                email="admin@example.com",
                display_name="Admin",
                auth_provider="email_otp",
                platform_role="platform_super_admin",
                status="active",
                created_at=utc_now(),
                updated_at=utc_now(),
            ),
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
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

    def test_tenant_admin_crud_flow(self):
        organization = self.client.post(
            "/organizations",
            json={"name": "Acme Studio", "slug": "acme"},
        ).json()
        workspace = self.client.post(
            "/workspaces",
            json={"organization_id": organization["id"], "name": "Main Space", "slug": "main"},
        ).json()
        user = self.client.post(
            "/users",
            json={"email": "owner@example.com", "display_name": "Owner"},
        ).json()
        role = self.client.post(
            "/roles",
            json={"code": "org_admin", "name": "Organization Admin"},
        ).json()
        membership = self.client.post(
            "/memberships",
            json={
                "organization_id": organization["id"],
                "workspace_id": workspace["id"],
                "user_id": user["id"],
                "role_id": role["id"],
            },
        ).json()

        self.assertEqual(workspace["organization_id"], organization["id"])
        self.assertEqual(membership["organization_id"], organization["id"])

        listed_workspaces = self.client.get(f"/workspaces?organization_id={organization['id']}").json()
        listed_memberships = self.client.get(f"/memberships?workspace_id={workspace['id']}").json()
        self.assertEqual(len(listed_workspaces), 1)
        self.assertEqual(len(listed_memberships), 1)
        self.assertEqual(listed_memberships[0]["user_id"], user["id"])

        updated_user = self.client.put(
            f"/users/{user['id']}",
            json={"display_name": "Studio Owner", "email": None},
        ).json()
        updated_membership = self.client.put(
            f"/memberships/{membership['id']}",
            json={"status": "inactive"},
        ).json()
        self.assertIsNone(updated_user["email"])
        self.assertEqual(updated_user["display_name"], "Studio Owner")
        self.assertEqual(updated_membership["status"], "inactive")

        self.assertEqual(self.client.delete(f"/memberships/{membership['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/roles/{role['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/users/{user['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/workspaces/{workspace['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/organizations/{organization['id']}").status_code, 200)

    def test_delete_and_membership_conflict_guards(self):
        organization = self.client.post(
            "/organizations",
            json={"name": "Guard Studio", "slug": "guard"},
        ).json()
        workspace = self.client.post(
            "/workspaces",
            json={"organization_id": organization["id"], "name": "Guard Space"},
        ).json()
        user = self.client.post(
            "/users",
            json={"email": "guard@example.com"},
        ).json()
        role = self.client.post(
            "/roles",
            json={"code": "editor", "name": "Editor"},
        ).json()

        created_membership = self.client.post(
            "/memberships",
            json={
                "workspace_id": workspace["id"],
                "user_id": user["id"],
                "role_id": role["id"],
            },
        )
        self.assertEqual(created_membership.status_code, 200)
        membership = created_membership.json()
        self.assertEqual(membership["organization_id"], organization["id"])

        duplicate_membership = self.client.post(
            "/memberships",
            json={
                "organization_id": organization["id"],
                "workspace_id": workspace["id"],
                "user_id": user["id"],
                "role_id": role["id"],
            },
        )
        self.assertEqual(duplicate_membership.status_code, 409)

        blocked_workspace_delete = self.client.delete(f"/workspaces/{workspace['id']}")
        blocked_org_delete = self.client.delete(f"/organizations/{organization['id']}")
        self.assertEqual(blocked_workspace_delete.status_code, 400)
        self.assertEqual(blocked_org_delete.status_code, 400)

        self.assertEqual(self.client.delete(f"/memberships/{membership['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/workspaces/{workspace['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/organizations/{organization['id']}").status_code, 200)

    def test_workspace_organization_mismatch_is_rejected(self):
        org_a = self.client.post("/organizations", json={"name": "Org A", "slug": "org-a"}).json()
        org_b = self.client.post("/organizations", json={"name": "Org B", "slug": "org-b"}).json()
        workspace = self.client.post(
            "/workspaces",
            json={"organization_id": org_a["id"], "name": "Mismatch Space"},
        ).json()
        user = self.client.post("/users", json={"email": "mismatch@example.com"}).json()

        response = self.client.post(
            "/memberships",
            json={
                "organization_id": org_b["id"],
                "workspace_id": workspace["id"],
                "user_id": user["id"],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Workspace does not belong", response.json()["detail"])

    def test_model_provider_and_catalog_management_flow(self):
        providers = self.client.get("/model-providers")
        self.assertEqual(providers.status_code, 200)
        provider_list = providers.json()
        self.assertTrue(any(item["provider_key"] == "DASHSCOPE" for item in provider_list))
        dashscope_before = next(item for item in provider_list if item["provider_key"] == "DASHSCOPE")
        self.assertFalse(dashscope_before["has_credentials"])

        updated_provider = self.client.put(
            "/model-providers/DASHSCOPE",
            json={
                "enabled": True,
                "base_url": "https://dashscope.example.com",
                "credentials_patch": {"api_key": "sk-test-dashscope"},
                "settings_patch": {"default_text_model": "qwen-test"},
            },
        )
        self.assertEqual(updated_provider.status_code, 200)
        self.assertNotIn("credentials_json", updated_provider.json())
        self.assertTrue(updated_provider.json()["has_credentials"])
        self.assertIn("api_key", updated_provider.json()["configured_fields"])

        updated_model = self.client.put(
            "/model-catalog/wan2.6-i2v",
            json={"enabled": False, "display_name": "Wan 2.6 I2V Disabled"},
        )
        self.assertEqual(updated_model.status_code, 200)
        self.assertFalse(updated_model.json()["enabled"])

        available_models = self.client.get("/system/models/available")
        self.assertEqual(available_models.status_code, 200)
        payload = available_models.json()
        self.assertGreaterEqual(len(payload["t2i"]), 1)
        self.assertGreaterEqual(len(payload["i2i"]), 1)
        self.assertFalse(any(item["model_id"] == "wan2.6-i2v" for item in payload["i2v"]))

    def test_user_art_style_endpoints_keep_payload_shape_after_storage_split(self):
        initial = self.client.get("/art_direction/user-styles")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.json()["styles"], [])

        saved = self.client.put(
            "/art_direction/user-styles",
            json={
                "styles": [
                    {"id": "style_1", "name": "赛博水墨", "positive_prompt": "cyberpunk, ink wash"},
                ]
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["styles"][0]["id"], "style_1")

        reloaded = self.client.get("/art_direction/user-styles")
        self.assertEqual(reloaded.status_code, 200)
        self.assertEqual(reloaded.json()["styles"][0]["name"], "赛博水墨")

    def test_disabling_provider_turns_off_related_models_and_hides_them(self):
        enable_provider = self.client.put(
            "/model-providers/DASHSCOPE",
            json={"enabled": True},
        )
        self.assertEqual(enable_provider.status_code, 200)

        disable_provider = self.client.put(
            "/model-providers/DASHSCOPE",
            json={"enabled": False},
        )
        self.assertEqual(disable_provider.status_code, 200)
        self.assertFalse(disable_provider.json()["enabled"])

        catalog = self.client.get("/model-catalog")
        self.assertEqual(catalog.status_code, 200)
        dashscope_models = [item for item in catalog.json() if item["provider_key"] == "DASHSCOPE"]
        self.assertTrue(dashscope_models)
        self.assertTrue(all(item["enabled"] is False for item in dashscope_models))

        available_models = self.client.get("/system/models/available")
        self.assertEqual(available_models.status_code, 200)
        payload = available_models.json()
        self.assertEqual(payload["t2i"], [])
        self.assertEqual(payload["i2i"], [])
        self.assertEqual(payload["i2v"], [])

    def test_env_config_routes_are_removed(self):
        self.assertEqual(self.client.get("/config/env").status_code, 404)
        self.assertEqual(self.client.post("/config/env", json={}).status_code, 404)
        self.assertEqual(self.client.get("/config/info").status_code, 404)

    def test_task_concurrency_limit_management_flow(self):
        organization = self.client.post(
            "/organizations",
            json={"name": "Concurrency Studio", "slug": "concurrency-studio"},
        ).json()

        options = self.client.get("/task-concurrency-limits/options")
        self.assertEqual(options.status_code, 200)
        self.assertTrue(any(item["task_type"] == "asset.generate" for item in options.json()))

        upserted = self.client.put(
            "/task-concurrency-limits",
            json={
                "organization_id": organization["id"],
                "task_type": "asset.generate",
                "max_concurrency": 10,
            },
        )
        self.assertEqual(upserted.status_code, 200)
        self.assertEqual(upserted.json()["organization_id"], organization["id"])
        self.assertEqual(upserted.json()["task_type"], "asset.generate")
        self.assertEqual(upserted.json()["max_concurrency"], 10)
        self.assertEqual(upserted.json()["organization_name"], "Concurrency Studio")

        listed = self.client.get("/task-concurrency-limits")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(
            any(
                item["organization_id"] == organization["id"]
                and item["task_type"] == "asset.generate"
                and item["max_concurrency"] == 10
                for item in listed.json()
            )
        )

        deleted = self.client.delete(
            f"/task-concurrency-limits?organization_id={organization['id']}&task_type=asset.generate"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["status"], "deleted")

    def test_cannot_enable_model_when_provider_is_disabled(self):
        disabled_provider = self.client.put(
            "/model-providers/KLING",
            json={"enabled": False},
        )
        self.assertEqual(disabled_provider.status_code, 200)

        response = self.client.put(
            "/model-catalog/kling-v3",
            json={"enabled": True},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Cannot enable model under disabled provider", response.json()["detail"])

    def test_model_provider_and_catalog_full_crud(self):
        created_provider = self.client.post(
            "/model-providers",
            json={
                "provider_key": "ACME",
                "display_name": "Acme Provider",
                "description": "Custom provider for tests",
                "enabled": True,
                "base_url": "https://api.acme.test/v1",
                "credential_fields": ["api_key"],
                "credentials_patch": {"api_key": "sk-acme"},
                "settings_json": {"region": "cn-hangzhou"},
            },
        )
        self.assertEqual(created_provider.status_code, 200)
        self.assertEqual(created_provider.json()["provider_key"], "ACME")
        self.assertTrue(created_provider.json()["has_credentials"])
        self.assertEqual(created_provider.json()["credential_fields"], ["api_key"])

        created_model = self.client.post(
            "/model-catalog",
            json={
                "model_id": "acme-i2v-v1",
                "task_type": "i2v",
                "provider_key": "ACME",
                "display_name": "Acme I2V V1",
                "description": "Test model",
                "enabled": True,
                "sort_order": 5,
            },
        )
        self.assertEqual(created_model.status_code, 200)
        self.assertEqual(created_model.json()["provider_key"], "ACME")

        blocked_provider_delete = self.client.delete("/model-providers/ACME")
        self.assertEqual(blocked_provider_delete.status_code, 400)
        self.assertIn("dependent catalog entries", blocked_provider_delete.json()["detail"])

        deleted_model = self.client.delete("/model-catalog/acme-i2v-v1")
        self.assertEqual(deleted_model.status_code, 200)
        self.assertEqual(deleted_model.json()["model_id"], "acme-i2v-v1")

        deleted_provider = self.client.delete("/model-providers/ACME")
        self.assertEqual(deleted_provider.status_code, 200)
        self.assertEqual(deleted_provider.json()["provider_key"], "ACME")

    def test_admin_billing_pricing_rule_accepts_usage_fields(self):
        created = self.client.post(
            "/admin/billing/pricing-rules",
            json={
                "task_type": "video.generate.project",
                "price_credits": 120,
                "reserve_credits": 180,
                "minimum_credits": 30,
                "charge_mode": "usage",
                "pricing_config_json": {
                    "billing_unit": "provider_cost_ratio",
                    "provider_cost_markup_ratio": 1.5,
                    "per_second_credits": 8,
                },
                "usage_metric_key": "seconds",
                "description": "按秒结算的视频定价",
            },
        )

        self.assertEqual(created.status_code, 200)
        payload = created.json()
        self.assertEqual(payload["charge_mode"], "usage")
        self.assertEqual(payload["reserve_credits"], 180)
        self.assertEqual(payload["minimum_credits"], 30)
        self.assertEqual(payload["pricing_config_json"]["per_second_credits"], 8)
        self.assertEqual(payload["usage_metric_key"], "seconds")

        listed = self.client.get("/admin/billing/pricing-rules")
        self.assertEqual(listed.status_code, 200)
        rules = listed.json()
        created_rule = next(item for item in rules if item["task_type"] == "video.generate.project")
        self.assertEqual(created_rule["charge_mode"], "usage")
        self.assertEqual(created_rule["reserve_credits"], 180)
