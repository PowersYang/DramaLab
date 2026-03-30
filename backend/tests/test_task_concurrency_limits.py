import tempfile
import unittest
from pathlib import Path

from src.utils.datetime import utc_now


class TaskConcurrencyLimitsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "task-concurrency-test.db"
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

    def test_claim_next_jobs_respects_organization_task_limit(self):
        from src.application.services.task_concurrency_service import TaskConcurrencyService
        from src.application.tasks import TaskService
        from src.repository import OrganizationRepository
        from src.schemas.models import Organization
        from src.schemas.task_models import TaskJob, TaskStatus

        organization_repository = OrganizationRepository()
        org_a = organization_repository.create(
            Organization(id="org_a", name="Org A", slug="org-a", status="active")
        )
        org_b = organization_repository.create(
            Organization(id="org_b", name="Org B", slug="org-b", status="active")
        )

        concurrency_service = TaskConcurrencyService()
        concurrency_service.upsert_limit(
            organization_id=org_a.id,
            task_type="asset.generate",
            max_concurrency=1,
        )

        task_service = TaskService()
        now = utc_now()
        task_service.task_job_repository.create(
            TaskJob(
                id="job_running_org_a",
                task_type="asset.generate",
                status=TaskStatus.RUNNING,
                queue_name="image",
                organization_id=org_a.id,
                created_at=now,
                updated_at=now,
                scheduled_at=now,
                started_at=now,
                heartbeat_at=now,
            )
        )
        task_service.task_job_repository.create(
            TaskJob(
                id="job_queued_blocked",
                task_type="asset.generate",
                status=TaskStatus.QUEUED,
                queue_name="image",
                organization_id=org_a.id,
                created_at=now,
                updated_at=now,
                scheduled_at=now,
            )
        )
        task_service.task_job_repository.create(
            TaskJob(
                id="job_queued_other_org",
                task_type="asset.generate",
                status=TaskStatus.QUEUED,
                queue_name="image",
                organization_id=org_b.id,
                created_at=now,
                updated_at=now,
                scheduled_at=now,
            )
        )
        task_service.task_job_repository.create(
            TaskJob(
                id="job_queued_other_type",
                task_type="storyboard.analyze",
                status=TaskStatus.QUEUED,
                queue_name="image",
                organization_id=org_a.id,
                created_at=now,
                updated_at=now,
                scheduled_at=now,
            )
        )

        claimed = task_service.claim_next_jobs(["image"], 3, "worker-test")
        claimed_ids = [item.id for item in claimed]

        self.assertNotIn("job_queued_blocked", claimed_ids)
        self.assertIn("job_queued_other_org", claimed_ids)
        self.assertIn("job_queued_other_type", claimed_ids)

        blocked = task_service.get_job("job_queued_blocked")
        self.assertIsNotNone(blocked)
        self.assertEqual(blocked.status, TaskStatus.QUEUED)


if __name__ == "__main__":
    unittest.main()
