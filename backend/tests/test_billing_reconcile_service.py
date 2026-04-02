import tempfile
import unittest
from pathlib import Path


class BillingReconcileServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "billing-reconcile-test.db"
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

    def tearDown(self):
        from src.db.base import Base
        from src.db.session import get_engine, get_session_factory
        from src.settings.env_settings import override_env_path_for_tests

        Base.metadata.drop_all(bind=get_engine())
        get_engine.cache_clear()
        get_session_factory.cache_clear()
        override_env_path_for_tests(None)
        self.temp_dir.cleanup()

    def _create_project(self, organization_id: str, project_id: str):
        from src.repository import OrganizationRepository, ProjectRepository
        from src.schemas.models import Organization, Script
        from src.utils.datetime import utc_now

        OrganizationRepository().create(
            Organization(id=organization_id, name="Billing Reconcile Org", slug=f"{organization_id}-slug", status="active")
        )
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id=project_id,
                title="Billing Reconcile Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=organization_id,
                workspace_id="ws_reconcile",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

    def test_reconcile_pending_charges_settles_succeeded_usage_job(self):
        from src.application.services import BillingReconcileService, BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository, TaskJobRepository
        from src.utils.datetime import utc_now

        self._create_project("org_reconcile_success", "project_reconcile_success")
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
            organization_id="org_reconcile_success",
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="seed",
        )
        task_service = TaskService()
        receipt = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_reconcile_success", "text": "new text"},
            project_id="project_reconcile_success",
            queue_name="llm",
            resource_type="project",
            resource_id="project_reconcile_success",
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

        summary = BillingReconcileService().reconcile_pending_charges()

        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        account = billing_service.get_account("org_reconcile_success")
        refunds = billing_service.list_transactions("org_reconcile_success", transaction_type="refund")
        self.assertEqual(summary.repaired_count, 1)
        self.assertEqual(charge.final_credits, 30)
        self.assertEqual(account.balance_credits, 70)
        self.assertEqual(len(refunds), 1)

    def test_reconcile_pending_charges_releases_failed_job(self):
        from src.application.services import BillingReconcileService, BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository, TaskJobRepository
        from src.utils.datetime import utc_now

        self._create_project("org_reconcile_failed", "project_reconcile_failed")
        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(
            organization_id="org_reconcile_failed",
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="seed",
        )
        task_service = TaskService()
        receipt = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_reconcile_failed", "text": "new text"},
            project_id="project_reconcile_failed",
            queue_name="llm",
            resource_type="project",
            resource_id="project_reconcile_failed",
        )
        TaskJobRepository().patch(
            receipt.job_id,
            {"status": "failed", "finished_at": utc_now(), "error_message": "boom"},
        )

        summary = BillingReconcileService().reconcile_pending_charges()

        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        account = billing_service.get_account("org_reconcile_failed")
        refunds = billing_service.list_transactions("org_reconcile_failed", transaction_type="refund")
        self.assertEqual(summary.repaired_count, 1)
        self.assertEqual(charge.status, "compensated")
        self.assertEqual(account.balance_credits, 100)
        self.assertEqual(len(refunds), 1)

    def test_reconcile_pending_charges_is_idempotent_on_second_run(self):
        from src.application.services import BillingReconcileService, BillingService
        from src.application.tasks import TaskService
        from src.repository import TaskJobRepository
        from src.utils.datetime import utc_now

        self._create_project("org_reconcile_idem", "project_reconcile_idem")
        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(
            organization_id="org_reconcile_idem",
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="seed",
        )
        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_reconcile_idem", "text": "new text"},
            project_id="project_reconcile_idem",
            queue_name="llm",
            resource_type="project",
            resource_id="project_reconcile_idem",
        )
        TaskJobRepository().patch(
            receipt.job_id,
            {"status": "failed", "finished_at": utc_now(), "error_message": "boom"},
        )

        service = BillingReconcileService()
        first = service.reconcile_pending_charges()
        second = service.reconcile_pending_charges()

        refunds = billing_service.list_transactions("org_reconcile_idem", transaction_type="refund")
        self.assertEqual(first.repaired_count, 1)
        self.assertEqual(second.repaired_count, 0)
        self.assertEqual(len(refunds), 1)


if __name__ == "__main__":
    unittest.main()
