import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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
        self.assertEqual({item.transaction_type for item in transactions}, {"recharge", "bonus"})

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

    def test_task_charge_idempotency_returns_existing_even_when_balance_insufficient(self):
        from src.application.services import BillingService
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_idem_balance")
        service = BillingService()
        service.upsert_pricing_rule(task_type="asset.generate", price_credits=100, actor_id="admin_1")
        service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        now = utc_now()
        job = TaskJob(
            id="job_billing_idem_1",
            task_type="asset.generate",
            queue_name="image",
            organization_id=org.id,
            payload_json={},
            created_at=now,
            updated_at=now,
        )

        service.charge_task_submission(job=job, actor_id="user_1", idempotency_key="task-charge-idem-1")
        service.charge_task_submission(job=job, actor_id="user_1", idempotency_key="task-charge-idem-1")

        account = service.get_account(org.id)
        self.assertEqual(account.balance_credits, 0)
        transactions = service.list_transactions(org.id, transaction_type="task_debit")
        self.assertEqual(len(transactions), 1)

    def test_list_transactions_can_filter_by_operator(self):
        from src.application.services import BillingService
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        org = self._create_org()
        service = BillingService()
        service.upsert_pricing_rule(task_type="asset.generate", price_credits=10, actor_id="admin_1")
        service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        now = utc_now()
        service.charge_task_submission(
            job=TaskJob(
                id="job_billing_user_1",
                task_type="asset.generate",
                queue_name="image",
                organization_id=org.id,
                payload_json={},
                created_at=now,
                updated_at=now,
            ),
            actor_id="user_1",
            idempotency_key="task-charge-user-1",
        )
        service.charge_task_submission(
            job=TaskJob(
                id="job_billing_user_2",
                task_type="asset.generate",
                queue_name="image",
                organization_id=org.id,
                payload_json={},
                created_at=now,
                updated_at=now,
            ),
            actor_id="user_2",
            idempotency_key="task-charge-user-2",
        )

        transactions = service.list_transactions(org.id, transaction_type="task_debit", operator_user_id="user_1")
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].operator_user_id, "user_1")
        self.assertEqual(transactions[0].related_id, "job_billing_user_1")

    def test_list_active_pricing_rules_prefers_organization_override(self):
        from src.application.services import BillingService

        org = self._create_org()
        service = BillingService()
        service.upsert_pricing_rule(task_type="asset.generate", price_credits=20, actor_id="admin_1")
        service.upsert_pricing_rule(task_type="asset.generate", price_credits=35, organization_id=org.id, actor_id="admin_1")

        rules = service.list_active_pricing_rules(org.id)
        rule_map = {item.task_type: item for item in rules}
        self.assertEqual(rule_map["asset.generate"].price_credits, 35)

    def test_upsert_pricing_rule_supports_usage_pricing_fields(self):
        from src.application.services import BillingService

        service = BillingService()
        rule = service.upsert_pricing_rule(
            task_type="video.generate.project",
            price_credits=120,
            reserve_credits=180,
            minimum_credits=30,
            charge_mode="usage",
            pricing_config_json={
                "billing_unit": "provider_cost_ratio",
                "provider_cost_markup_ratio": 1.5,
                "per_second_credits": 8,
            },
            usage_metric_key="seconds",
            actor_id="admin_1",
            description="按秒计费的视频生成规则",
        )

        self.assertEqual(rule.charge_mode, "usage")
        self.assertEqual(rule.price_credits, 120)
        self.assertEqual(rule.reserve_credits, 180)
        self.assertEqual(rule.minimum_credits, 30)
        self.assertEqual(rule.pricing_config_json["per_second_credits"], 8)
        self.assertEqual(rule.usage_metric_key, "seconds")

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

    def test_calculate_usage_credits_supports_fixed_pricing(self):
        from src.application.services import BillingService

        service = BillingService()
        calculated = service.calculate_usage_credits(
            pricing_rule_snapshot={
                "charge_mode": "fixed",
                "price_credits": 25,
                "minimum_credits": 0,
                "pricing_config_json": {},
            },
            usage_snapshot={"seconds": 3.2},
            cost_snapshot={"amount": 0.2, "currency": "USD"},
        )

        self.assertEqual(calculated, 25)

    def test_calculate_usage_credits_supports_usage_pricing(self):
        from src.application.services import BillingService

        service = BillingService()
        calculated = service.calculate_usage_credits(
            pricing_rule_snapshot={
                "charge_mode": "usage",
                "price_credits": 0,
                "minimum_credits": 0,
                "usage_metric_key": "seconds",
                "pricing_config_json": {"per_second_credits": 8},
            },
            usage_snapshot={"seconds": 3.2},
            cost_snapshot={},
        )

        self.assertEqual(calculated, 26)

    def test_calculate_usage_credits_respects_minimum_credits(self):
        from src.application.services import BillingService

        service = BillingService()
        calculated = service.calculate_usage_credits(
            pricing_rule_snapshot={
                "charge_mode": "usage",
                "price_credits": 0,
                "minimum_credits": 30,
                "usage_metric_key": "seconds",
                "pricing_config_json": {"per_second_credits": 8},
            },
            usage_snapshot={"seconds": 1.0},
            cost_snapshot={},
        )

        self.assertEqual(calculated, 30)

    def test_task_charge_accepts_zero_priced_rule_and_persists_zero_debit(self):
        from src.application.services import BillingService
        from src.db.models import BillingTransactionRecord
        from src.schemas.task_models import TaskJob
        from src.utils.datetime import utc_now

        org = self._create_org()
        service = BillingService()
        service.upsert_pricing_rule(task_type="project.reparse", price_credits=0, actor_id="admin_1")

        now = utc_now()
        original_ensure_task_charge = BillingService._ensure_task_charge
        testcase = self

        def asserting_ensure_task_charge(self, *, job, billing_account_id, transaction, pricing_rule_snapshot, charge_amount, actor_id, idempotency_key, session):
            testcase.assertFalse(
                any(isinstance(record, BillingTransactionRecord) and record.id == transaction.id for record in session.new)
            )
            return original_ensure_task_charge(
                self,
                job=job,
                billing_account_id=billing_account_id,
                transaction=transaction,
                pricing_rule_snapshot=pricing_rule_snapshot,
                charge_amount=charge_amount,
                actor_id=actor_id,
                idempotency_key=idempotency_key,
                session=session,
            )

        with patch.object(BillingService, "_ensure_task_charge", autospec=True, side_effect=asserting_ensure_task_charge):
            transaction = service.charge_task_submission(
                job=TaskJob(
                    id="job_billing_zero_1",
                    task_type="project.reparse",
                    queue_name="llm",
                    organization_id=org.id,
                    payload_json={},
                    created_at=now,
                    updated_at=now,
                ),
                actor_id="user_zero",
                idempotency_key="task-charge-zero-1",
            )

        account = service.get_account(org.id)
        transactions = service.list_transactions(org.id, transaction_type="task_debit")
        self.assertIsNotNone(transaction)
        self.assertEqual(account.balance_credits, 0)
        self.assertEqual(account.total_consumed_credits, 0)
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].amount_credits, 0)
        self.assertEqual(transactions[0].balance_before, 0)
        self.assertEqual(transactions[0].balance_after, 0)
        self.assertEqual(transactions[0].related_id, "job_billing_zero_1")

    def test_task_service_create_job_charges_and_persists_job_together(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import TaskEventRepository
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
        self.assertEqual(len(TaskEventRepository().list_by_job(receipt.job_id)), 1)
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="task_debit")), 1)

    def test_task_service_create_job_flushes_task_job_before_charging(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.db.models import TaskJobRecord
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_order")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_order_1",
                title="Billing Order Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_order",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed-order")

        original_charge_task_submission = BillingService.charge_task_submission
        testcase = self

        def asserting_charge_task_submission(self, *, job, actor_id=None, idempotency_key=None, session=None):
            testcase.assertIsNotNone(session)
            testcase.assertFalse(
                any(isinstance(record, TaskJobRecord) and record.id == job.id for record in session.new)
            )
            return original_charge_task_submission(
                self,
                job=job,
                actor_id=actor_id,
                idempotency_key=idempotency_key,
                session=session,
            )

        with patch.object(BillingService, "charge_task_submission", autospec=True, side_effect=asserting_charge_task_submission):
            receipt = TaskService().create_job(
                task_type="project.reparse",
                payload={"project_id": "project_billing_order_1", "text": "new text"},
                project_id="project_billing_order_1",
                queue_name="llm",
                resource_type="project",
                resource_id="project_billing_order_1",
                idempotency_key="job-idem-order-1",
            )

        self.assertIsNotNone(TaskService().get_job(receipt.job_id))

    def test_task_service_create_series_job_inherits_series_workspace_and_charges_normally(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import SeriesRepository
        from src.schemas.models import Series
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_series_job")
        now = utc_now()
        SeriesRepository().create(
            Series(
                id="series_billing_job_1",
                title="Series Billing Job",
                description="desc",
                characters=[],
                scenes=[],
                props=[],
                organization_id=org.id,
                workspace_id="ws_series_job",
                created_by="user_series",
                updated_by="user_series",
                created_at=now,
                updated_at=now,
            )
        )

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="series.assets.extract", price_credits=6, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed-series-job")

        receipt = TaskService().create_job(
            task_type="series.assets.extract",
            payload={"series_id": "series_billing_job_1", "text": "周野推门走进审讯室。"},
            project_id=None,
            series_id="series_billing_job_1",
            queue_name="llm",
            resource_type="series",
            resource_id="series_billing_job_1",
        )

        job = TaskService().get_job(receipt.job_id)
        self.assertIsNotNone(job)
        self.assertEqual(job.organization_id, org.id)
        self.assertEqual(job.workspace_id, "ws_series_job")
        self.assertEqual(job.created_by, "user_series")
        self.assertEqual(billing_service.get_account(org.id).balance_credits, 44)

    def test_task_service_dedupe_reuse_does_not_charge_twice(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_dedupe")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_dedupe_1",
                title="Billing Dedupe Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_dedupe",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed")

        service = TaskService()
        receipt_1 = service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_dedupe_1", "text": "new text"},
            project_id="project_billing_dedupe_1",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_dedupe_1",
        )
        receipt_2 = service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_dedupe_1", "text": "new text"},
            project_id="project_billing_dedupe_1",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_dedupe_1",
        )

        self.assertEqual(receipt_1.job_id, receipt_2.job_id)
        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 35)
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="task_debit")), 1)

    def test_task_service_allows_resubmitting_same_payload_after_previous_job_completed(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_resubmit")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_resubmit_1",
                title="Billing Resubmit Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_resubmit",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=15, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=500, actor_id="admin_1", idempotency_key="seed-resubmit")

        task_service = TaskService()
        receipt_1 = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_resubmit_1", "text": "new text"},
            project_id="project_billing_resubmit_1",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_resubmit_1",
        )
        task_service.mark_job_succeeded(receipt_1.job_id, result_json={"ok": True})

        receipt_2 = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_resubmit_1", "text": "new text"},
            project_id="project_billing_resubmit_1",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_resubmit_1",
        )

        self.assertNotEqual(receipt_1.job_id, receipt_2.job_id)
        self.assertIsNotNone(BillingChargeRepository().get_by_job_id(receipt_1.job_id))
        self.assertIsNotNone(BillingChargeRepository().get_by_job_id(receipt_2.job_id))
        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 20)
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="task_debit")), 2)

    def test_task_charge_refunds_on_failure_and_reholds_on_retry(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_refund_retry")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_refund_retry",
                title="Billing Refund Retry Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_retry",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=10, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        task_service = TaskService()
        receipt = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_refund_retry", "text": "new text"},
            project_id="project_billing_refund_retry",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_refund_retry",
        )

        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 90)
        self.assertIsNotNone(BillingChargeRepository().get_by_job_id(receipt.job_id))

        task_service.mark_job_failed(receipt.job_id, "failed")
        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 100)
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="refund")), 1)

        task_service.mark_job_failed(receipt.job_id, "failed again")
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="refund")), 1)

        task_service.retry_job(receipt.job_id)
        account = billing_service.get_account(org.id)
        self.assertEqual(account.balance_credits, 90)
        self.assertEqual(len(billing_service.list_transactions(org.id, transaction_type="task_debit")), 2)

    def test_record_task_attempt_metrics_updates_charge_cost_snapshot(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_cost_snapshot")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_cost_snapshot",
                title="Billing Cost Snapshot Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_cost",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=10, actor_id="admin_1")
        billing_service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_cost_snapshot", "text": "new text"},
            project_id="project_billing_cost_snapshot",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_cost_snapshot",
        )

        metrics = {
            "version": "v1",
            "provider": {"name": "DUMMY", "model": "dummy-1"},
            "usage": {"input_tokens": 10, "output_tokens": 20, "seconds": 1.2},
            "cost": {"currency": "USD", "amount": 0.01},
            "supplier_reference": {"task_id": "supplier-task-1", "request_id": "supplier-request-1"},
        }
        billing_service.record_task_attempt_metrics(job_id=receipt.job_id, attempt_no=1, metrics_json=metrics, actor_id="worker_1")
        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        self.assertIsNotNone(charge)
        self.assertEqual(charge.status, "held")
        self.assertEqual(charge.cost_snapshot_json["attempts"][0]["attempt_no"], 1)
        self.assertEqual(charge.cost_snapshot_json["attempts"][0]["metrics"]["version"], "v1")
        self.assertEqual(charge.cost_snapshot_json["attempts"][0]["metrics"]["provider"]["name"], "DUMMY")
        self.assertEqual(charge.cost_snapshot_json["aggregated"]["usage_totals"]["input_tokens"], 10)
        self.assertEqual(charge.cost_snapshot_json["aggregated"]["cost_totals"]["USD"], 0.01)
        self.assertEqual(charge.cost_snapshot_json["aggregated"]["metric_versions"], ["v1"])
        self.assertEqual(charge.cost_snapshot_json["aggregated"]["supplier_task_ids"], ["supplier-task-1"])
        self.assertEqual(charge.cost_snapshot_json["aggregated"]["supplier_request_ids"], ["supplier-request-1"])

    def test_usage_pricing_settles_successful_job_and_releases_difference(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import BillingChargeRepository
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_usage_settle")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_usage_settle",
                title="Billing Usage Settle Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_usage",
                created_by="user_1",
                updated_by="user_1",
                created_at=now,
                updated_at=now,
            )
        ])

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
        billing_service.manual_recharge(organization_id=org.id, amount_cents=1000, actor_id="admin_1", idempotency_key="seed")

        task_service = TaskService()
        receipt = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_usage_settle", "text": "new text"},
            project_id="project_billing_usage_settle",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_usage_settle",
        )
        billing_service.record_task_attempt_metrics(
            job_id=receipt.job_id,
            attempt_no=1,
            metrics_json={
                "version": "v1",
                "usage": {"seconds": 3},
                "cost": {"currency": "USD", "amount": 0.02},
            },
            actor_id="worker_1",
        )

        task_service.mark_job_succeeded(receipt.job_id, result_json={"ok": True})

        account = billing_service.get_account(org.id)
        charge = BillingChargeRepository().get_by_job_id(receipt.job_id)
        refunds = billing_service.list_transactions(org.id, transaction_type="refund")

        self.assertEqual(account.balance_credits, 70)
        self.assertEqual(charge.final_credits, 30)
        self.assertEqual(charge.settled_credits, 30)
        self.assertEqual(charge.reserved_credits, 100)
        self.assertEqual(len(refunds), 1)
        self.assertEqual(refunds[0].amount_credits, 70)

    def test_task_service_create_job_allows_zero_balance_when_task_price_is_zero(self):
        from src.application.services import BillingService
        from src.application.tasks import TaskService
        from src.repository import TaskEventRepository
        from src.repository import ProjectRepository
        from src.schemas.models import Script
        from src.utils.datetime import utc_now

        org = self._create_org("org_billing_zero_job")
        now = utc_now()
        ProjectRepository().sync([
            Script(
                id="project_billing_zero_job",
                title="Zero Billing Project",
                original_text="text",
                characters=[],
                scenes=[],
                props=[],
                frames=[],
                video_tasks=[],
                organization_id=org.id,
                workspace_id="ws_zero",
                created_by="user_zero",
                updated_by="user_zero",
                created_at=now,
                updated_at=now,
            )
        ])

        billing_service = BillingService()
        billing_service.upsert_pricing_rule(task_type="project.reparse", price_credits=0, actor_id="admin_1")

        receipt = TaskService().create_job(
            task_type="project.reparse",
            payload={"project_id": "project_billing_zero_job", "text": "new text"},
            project_id="project_billing_zero_job",
            queue_name="llm",
            resource_type="project",
            resource_id="project_billing_zero_job",
            idempotency_key="job-idem-zero-1",
        )

        account = billing_service.get_account(org.id)
        transactions = billing_service.list_transactions(org.id, transaction_type="task_debit")
        self.assertEqual(account.balance_credits, 0)
        self.assertEqual(account.total_consumed_credits, 0)
        self.assertIsNotNone(TaskService().get_job(receipt.job_id))
        self.assertEqual(len(TaskEventRepository().list_by_job(receipt.job_id)), 1)
        self.assertEqual(len(transactions), 1)
        self.assertEqual(transactions[0].amount_credits, 0)
        self.assertEqual(transactions[0].related_id, receipt.job_id)


if __name__ == "__main__":
    unittest.main()
