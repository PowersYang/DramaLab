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
        from src.auth.dependencies import require_platform_role
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        from src.api.tenant_admin import router as tenant_admin_router

        app = FastAPI()
        app.include_router(tenant_admin_router)
        app.dependency_overrides[require_platform_role] = lambda: None
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
