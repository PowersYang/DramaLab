import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


class BillingApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "billing-api-test.db"
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(f"DATABASE_URL=sqlite:///{db_path}\n", encoding="utf-8")

        from src.db.base import Base
        from src.auth.dependencies import RequestContext, get_request_context, require_platform_role
        from src.settings.env_settings import override_env_path_for_tests
        from src.db.session import get_engine, get_session_factory, init_database
        from src.repository import OrganizationRepository, ProjectRepository, UserRepository
        from src.schemas.models import Organization, Script, User
        from src.utils.datetime import utc_now

        override_env_path_for_tests(self.env_path)
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        engine = get_engine()
        Base.metadata.drop_all(bind=engine)
        init_database()

        now = utc_now()
        self.organization = OrganizationRepository().create(
            Organization(id="org_billing_api", name="Billing Api Org", slug="billing-api-org", status="active")
        )
        ProjectRepository().sync([
            Script(
                id="project_billing_api",
                title="Billing API Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=self.organization.id,
                workspace_id="ws_billing_api",
                created_by="user_org_admin",
                updated_by="user_org_admin",
                created_at=now,
                updated_at=now,
            )
        ])
        self.org_admin = UserRepository().create(
            User(
                id="user_org_admin",
                email="org-admin@example.com",
                display_name="Org Admin",
                auth_provider="email_otp",
                platform_role=None,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        self.super_admin = UserRepository().create(
            User(
                id="user_super_admin_billing",
                email="super-admin@example.com",
                display_name="Super Admin",
                auth_provider="email_otp",
                platform_role="platform_super_admin",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        self.member_user = UserRepository().create(
            User(
                id="user_workspace_member",
                email="member@example.com",
                display_name="Workspace Member",
                auth_provider="email_otp",
                platform_role=None,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )

        from src.api.billing import router as billing_router

        app = FastAPI()
        app.include_router(billing_router)

        def _org_context():
            return RequestContext(
                user=self.org_admin,
                current_workspace_id="ws_billing_api",
                current_organization_id=self.organization.id,
                current_role_code="org_admin",
                capabilities={"org.manage"},
                refresh_token=None,
            )

        app.dependency_overrides[get_request_context] = _org_context
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

    def _seed_charge(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(
            organization_id=self.organization.id,
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="seed",
        )
        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_api", "text": "new text"},
            project_id="project_billing_api",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_api",
        )
        return receipt.job_id

    def test_current_billing_charges_lists_current_organization_charges(self):
        job_id = self._seed_charge()

        response = self.client.get("/billing/charges")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["job_id"], job_id)
        self.assertEqual(payload[0]["organization_id"], self.organization.id)

    def test_current_billing_charge_detail_returns_single_charge(self):
        job_id = self._seed_charge()

        from src.repository import BillingChargeRepository

        charge = BillingChargeRepository().get_by_job_id(job_id)
        response = self.client.get(f"/billing/charges/{charge.id}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], charge.id)
        self.assertEqual(payload["job_id"], job_id)

    def test_current_payment_order_create_and_simulate_paid_updates_balance(self):
        from src.application.services import BillingService

        response = self.client.post(
            "/billing/payment-orders",
            json={
                "channel": "wechat",
                "amount_cents": 6800,
                "subject": "DramaLab Topup",
                "description": "test payment",
                "idempotency_key": "pay-create-1",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "pending")
        self.assertEqual(payload["channel"], "wechat")
        self.assertTrue(payload["qr_code_svg"])

        account_before = BillingService().get_account(self.organization.id)
        self.assertEqual(account_before.balance_credits, 0)

        paid = self.client.post(f"/billing/payment-orders/{payload['id']}/simulate-paid", json={})
        self.assertEqual(paid.status_code, 200)
        paid_payload = paid.json()
        self.assertEqual(paid_payload["status"], "paid")

        account_after = BillingService().get_account(self.organization.id)
        self.assertEqual(account_after.balance_credits, 680)
        transactions = BillingService().list_transactions(self.organization.id)
        self.assertEqual([item.transaction_type for item in transactions], ["recharge"])

    def test_current_payment_order_detail_is_scoped_to_current_org(self):
        created = self.client.post(
            "/billing/payment-orders",
            json={
                "channel": "alipay",
                "amount_cents": 12800,
                "idempotency_key": "pay-detail-1",
            },
        )
        self.assertEqual(created.status_code, 200)

        detail = self.client.get(f"/billing/payment-orders/{created.json()['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["id"], created.json()["id"])

        events = self.client.get(f"/billing/payment-orders/{created.json()['id']}/events")
        self.assertEqual(events.status_code, 200)
        self.assertEqual(len(events.json()), 1)
        self.assertEqual(events.json()[0]["event_type"], "payment_order.created")

    def test_mock_provider_notify_marks_order_paid(self):
        from src.application.services import BillingService

        created = self.client.post(
            "/billing/payment-orders",
            json={
                "channel": "wechat",
                "amount_cents": 12800,
                "idempotency_key": "pay-notify-1",
            },
        )
        self.assertEqual(created.status_code, 200)

        order_id = created.json()["id"]
        notify = self.client.post(
            "/billing/payment-providers/wechat/notify",
            json={
                "order_id": order_id,
                "provider_trade_no": "wechat_trade_001",
                "provider_buyer_id": "buyer_001",
            },
        )

        self.assertEqual(notify.status_code, 200)
        self.assertEqual(notify.json()["code"], "SUCCESS")

        order = self.client.get(f"/billing/payment-orders/{order_id}")
        self.assertEqual(order.status_code, 200)
        self.assertEqual(order.json()["status"], "paid")

        account = BillingService().get_account(self.organization.id)
        self.assertEqual(account.balance_credits, 1280)

    def test_mock_provider_notify_is_idempotent(self):
        from src.application.services import BillingService

        created = self.client.post(
            "/billing/payment-orders",
            json={
                "channel": "alipay",
                "amount_cents": 6800,
                "idempotency_key": "pay-notify-repeat-1",
            },
        )
        self.assertEqual(created.status_code, 200)
        order_id = created.json()["id"]

        first = self.client.post(
            "/billing/payment-providers/alipay/notify",
            json={"order_id": order_id, "provider_trade_no": "alipay_trade_repeat_001"},
        )
        second = self.client.post(
            "/billing/payment-providers/alipay/notify",
            json={"order_id": order_id, "provider_trade_no": "alipay_trade_repeat_001"},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.text, "success")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.text, "success")

        account = BillingService().get_account(self.organization.id)
        self.assertEqual(account.balance_credits, 680)
        transactions = BillingService().list_transactions(self.organization.id)
        self.assertEqual(len(transactions), 1)

    def test_workspace_member_cannot_operate_other_users_payment_order(self):
        created = self.client.post(
            "/billing/payment-orders",
            json={
                "channel": "wechat",
                "amount_cents": 6800,
                "idempotency_key": "pay-member-guard-1",
            },
        )
        self.assertEqual(created.status_code, 200)

        from src.auth.dependencies import RequestContext, get_request_context

        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.member_user,
            current_workspace_id="ws_billing_api",
            current_organization_id=self.organization.id,
            current_role_code="member",
            capabilities={"workspace.view"},
            refresh_token=None,
        )

        order_id = created.json()["id"]
        detail = self.client.get(f"/billing/payment-orders/{order_id}")
        self.assertEqual(detail.status_code, 404)

        events = self.client.get(f"/billing/payment-orders/{order_id}/events")
        self.assertEqual(events.status_code, 404)

        cancel = self.client.post(f"/billing/payment-orders/{order_id}/cancel")
        self.assertEqual(cancel.status_code, 404)

    def test_admin_billing_charges_can_filter_by_organization(self):
        job_id = self._seed_charge()

        from src.auth.dependencies import RequestContext, get_request_context

        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        response = self.client.get(f"/admin/billing/charges?organization_id={self.organization.id}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["job_id"], job_id)
        self.assertEqual(payload[0]["organization_id"], self.organization.id)

    def test_admin_manual_adjust_credit_updates_balance_and_charge(self):
        job_id = self._seed_charge()

        from src.auth.dependencies import RequestContext, get_request_context
        from src.application.services import BillingService
        from src.repository import BillingChargeRepository

        charge = BillingChargeRepository().get_by_job_id(job_id)
        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        response = self.client.post(
            f"/admin/billing/charges/{charge.id}/manual-adjust",
            json={
                "direction": "credit",
                "amount_credits": 5,
                "reason": "qa_compensation",
                "remark": "refund partial credits",
                "idempotency_key": "manual-adjust-1",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["adjusted_credits"], 5)
        self.assertEqual(payload["status"], "adjusted")

        account = BillingService().get_account(self.organization.id)
        self.assertEqual(account.balance_credits, 90)
        adjustments = BillingService().list_transactions(self.organization.id, transaction_type="manual_adjust_credit")
        self.assertEqual(len(adjustments), 1)
        self.assertEqual(adjustments[0].amount_credits, 5)

    def test_admin_manual_adjust_debit_updates_balance_and_charge(self):
        job_id = self._seed_charge()

        from src.auth.dependencies import RequestContext, get_request_context
        from src.application.services import BillingService
        from src.repository import BillingChargeRepository

        charge = BillingChargeRepository().get_by_job_id(job_id)
        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        response = self.client.post(
            f"/admin/billing/charges/{charge.id}/manual-adjust",
            json={
                "direction": "debit",
                "amount_credits": 5,
                "reason": "supplier_cost_recovery",
                "remark": "charge back missing provider cost",
                "idempotency_key": "manual-adjust-debit-1",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["adjusted_credits"], -5)
        self.assertEqual(payload["status"], "adjusted")

        account = BillingService().get_account(self.organization.id)
        self.assertEqual(account.balance_credits, 80)
        adjustments = BillingService().list_transactions(self.organization.id, transaction_type="manual_adjust_debit")
        self.assertEqual(len(adjustments), 1)
        self.assertEqual(adjustments[0].amount_credits, 5)

    def test_admin_manual_adjust_is_idempotent(self):
        job_id = self._seed_charge()

        from src.auth.dependencies import RequestContext, get_request_context
        from src.application.services import BillingService
        from src.repository import BillingChargeRepository

        charge = BillingChargeRepository().get_by_job_id(job_id)
        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        payload = {
            "direction": "credit",
            "amount_credits": 5,
            "reason": "qa_compensation",
            "remark": "refund partial credits",
            "idempotency_key": "manual-adjust-idem-1",
        }
        response_1 = self.client.post(f"/admin/billing/charges/{charge.id}/manual-adjust", json=payload)
        response_2 = self.client.post(f"/admin/billing/charges/{charge.id}/manual-adjust", json=payload)

        self.assertEqual(response_1.status_code, 200)
        self.assertEqual(response_2.status_code, 200)
        self.assertEqual(response_1.json()["adjusted_credits"], 5)
        self.assertEqual(response_2.json()["adjusted_credits"], 5)

        account = BillingService().get_account(self.organization.id)
        self.assertEqual(account.balance_credits, 90)
        adjustments = BillingService().list_transactions(self.organization.id, transaction_type="manual_adjust_credit")
        self.assertEqual(len(adjustments), 1)

    def test_admin_reconcile_run_dry_run_returns_summary_without_mutation(self):
        from src.auth.dependencies import RequestContext, get_request_context
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository, TaskJobRepository
        from src.utils.datetime import utc_now

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(
            task_type="project.reparse",
            price_credits=0,
            reserve_credits=100,
            minimum_credits=0,
            charge_mode="usage",
            pricing_config_json={"per_second_credits": 10},
            usage_metric_key="seconds",
            actor_id="admin_1",
        )
        billing_service.manual_recharge(
            organization_id=self.organization.id,
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="reconcile-dry-run-seed",
        )
        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_api", "text": "new text"},
            project_id="project_billing_api",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_api",
        )
        billing_service.record_task_attempt_metrics(
            job_id=receipt.job_id,
            attempt_no=1,
            metrics_json={"version": "v1", "usage": {"seconds": 3}, "cost": {"currency": "USD", "amount": 0.02}},
            actor_id="worker_1",
        )
        TaskJobRepository().patch(
            receipt.job_id,
            {"status": "succeeded", "finished_at": utc_now(), "result_json": {"ok": True}},
        )
        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        response = self.client.post("/admin/billing/reconcile/run", json={"dry_run": True})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["repaired_count"], 1)
        self.assertEqual(payload["error_count"], 0)

        charge_after = BillingChargeRepository().get_by_job_id(receipt.job_id)
        account = billing_service.get_account(self.organization.id)
        self.assertEqual(charge_after.id, charge.id)
        self.assertEqual(charge_after.status, "held")
        self.assertIsNone(charge_after.final_credits)
        self.assertEqual(charge_after.reserved_credits, 100)
        self.assertEqual(account.balance_credits, 0)

    def test_admin_reconcile_run_repairs_and_creates_run_record(self):
        from src.auth.dependencies import RequestContext, get_request_context
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository, TaskJobRepository
        from src.utils.datetime import utc_now

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(
            organization_id=self.organization.id,
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="reconcile-run-seed",
        )
        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_api", "text": "new text"},
            project_id="project_billing_api",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_api",
        )
        TaskJobRepository().patch(
            receipt.job_id,
            {"status": "failed", "finished_at": utc_now(), "error_message": "boom"},
        )
        self.client.app.dependency_overrides[get_request_context] = lambda: RequestContext(
            user=self.super_admin,
            current_workspace_id=None,
            current_organization_id=None,
            current_role_code=None,
            capabilities={"org.manage"},
            refresh_token=None,
        )

        run_response = self.client.post("/admin/billing/reconcile/run", json={"dry_run": False})
        runs_response = self.client.get("/admin/billing/reconcile/runs?limit=5")

        self.assertEqual(run_response.status_code, 200)
        self.assertEqual(runs_response.status_code, 200)

        run_payload = run_response.json()
        runs_payload = runs_response.json()
        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        account = billing_service.get_account(self.organization.id)
        refunds = billing_service.list_transactions(self.organization.id, transaction_type="refund")

        self.assertFalse(run_payload["dry_run"])
        self.assertEqual(run_payload["status"], "completed")
        self.assertEqual(run_payload["repaired_count"], 1)
        self.assertEqual(run_payload["created_by"], self.super_admin.id)
        self.assertGreaterEqual(len(runs_payload), 1)
        self.assertEqual(runs_payload[0]["id"], run_payload["id"])
        self.assertEqual(runs_payload[0]["repaired_count"], 1)
        self.assertEqual(charge.status, "compensated")
        self.assertEqual(account.balance_credits, 100)
        self.assertEqual(len(refunds), 1)


if __name__ == "__main__":
    unittest.main()
