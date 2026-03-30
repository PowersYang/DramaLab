import tempfile
import unittest
from pathlib import Path


class BillingServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "billing-test.db"
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

    def _create_org(self, organization_id: str = "org_billing"):
        from src.repository import OrganizationRepository
        from src.schemas.models import Organization

        return OrganizationRepository().create(
            Organization(id=organization_id, name="Billing Org", slug=f"{organization_id}-slug", status="active")
        )

    def test_manual_recharge_applies_bonus_rule(self):
        from src.application.services import BillingService

        org = self._create_org()
        service = BillingService()
        service.upsert_recharge_bonus_rule(
            min_recharge_cents=1000,
            max_recharge_cents=None,
            bonus_credits=30,
            actor_id="admin_1",
        )

        result = service.manual_recharge(
            organization_id=org.id,
            amount_cents=1000,
            actor_id="admin_1",
            idempotency_key="manual-1",
        )

        self.assertEqual(result["base_credits"], 100)
        self.assertEqual(result["bonus_credits"], 30)
        self.assertEqual(result["account"].balance_credits, 130)

        transactions = service.list_transactions(org.id)
        self.assertEqual(len(transactions), 2)
        self.assertEqual(transactions[0].transaction_type, "bonus")
        self.assertEqual(transactions[1].transaction_type, "recharge")

    def test_task_charge_debits_balance_once_per_idempotency_key(self):
        from src.application.services import BillingService
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        org = self._create_org()
        service = BillingService()
        service.upsert_pricing_rule(task_type="asset.generate", price_credits=25, actor_id="admin_1")
        service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        now = utc_now()
        job = TaskJob(
            id="job_billing_1",
            task_type="asset.generate",
            queue_name="image",
            organization_id=org.id,
            payload_json={},
            created_at=now,
            updated_at=now,
        )

        service.charge_task_submission(job=job, actor_id="user_1", idempotency_key="task-charge-1")
        service.charge_task_submission(job=job, actor_id="user_1", idempotency_key="task-charge-1")

        account = service.get_account(org.id)
        self.assertEqual(account.balance_credits, 75)
        transactions = service.list_transactions(org.id, transaction_type="task_debit")
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].related_id, "job_billing_1")

    def test_task_charge_rejects_when_balance_insufficient(self):
        from src.application.services import BillingInsufficientBalanceError, BillingService
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        org = self._create_org()
        service = BillingService()
        service.upsert_pricing_rule(task_type="video.generate.project", price_credits=200, actor_id="admin_1")
        service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed")

        now = utc_now()
        job = TaskJob(
            id="job_billing_2",
            task_type="video.generate.project",
            queue_name="video",
            organization_id=org.id,
            payload_json={},
            created_at=now,
            updated_at=now,
        )

        with self.assertRaises(BillingInsufficientBalanceError):
            service.charge_task_submission(job=job, actor_id="user_1", idempotency_key="task-charge-2")

        account = service.get_account(org.id)
        self.assertEqual(account.balance_credits, 50)

    def test_task_service_create_job_charges_and_persists_job_together(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org()
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_1",
                title="Billing Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_1",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed")

        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_1", "text": "new text"},
            project_id="project_billing_1",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_1",
            idempotency_key="job-idem-1",
        )

        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 35)
        self.assertIsNotNone(TaskService().get_job(receipt.job_id))
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="task_debit")), 1)


if __name__ == "__main__":
    unittest.main()
