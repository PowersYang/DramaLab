import tempfile
import time
import unittest
from datetime import timedelta
from pathlib import Path

from src.utils.datetime import utc_now


class TaskWorkerRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        db_path = Path(self.temp_dir.name) / "task-worker-test.db"
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

    def test_recover_stale_running_job_requeues_and_closes_attempt(self):
        from src.application.tasks import TaskService
        from src.schemas.task_models import TaskAttempt, TaskJob, TaskStatus

        service = TaskService()
        stale_at = utc_now() - timedelta(minutes=5)
        job = TaskJob(
            id="job_stale_requeue",
            task_type="asset.generate",
            status=TaskStatus.RUNNING,
            queue_name="image",
            max_attempts=2,
            attempt_count=1,
            timeout_seconds=1800,
            created_at=stale_at,
            updated_at=stale_at,
            scheduled_at=stale_at,
            claimed_at=stale_at,
            started_at=stale_at,
            heartbeat_at=stale_at,
            worker_id="worker-old",
        )
        service.task_job_repository.create(job)
        service.task_attempt_repository.create(
            TaskAttempt(
                id="attempt_stale_requeue",
                job_id=job.id,
                attempt_no=1,
                worker_id="worker-old",
                started_at=stale_at,
                created_at=stale_at,
                updated_at=stale_at,
            )
        )

        recovered = service.recover_stale_jobs(stale_after_seconds=60)

        self.assertEqual(len(recovered), 1)
        updated = service.get_job(job.id)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, TaskStatus.QUEUED)
        self.assertIsNone(updated.worker_id)
        self.assertIsNone(updated.heartbeat_at)
        self.assertIsNone(updated.started_at)
        self.assertIn("Recovered stale running job", updated.error_message or "")

        attempts = service.task_attempt_repository.list_by_job(job.id)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].outcome, "failed")
        self.assertIsNotNone(attempts[0].ended_at)
        self.assertIn("Recovered stale running job", attempts[0].error_message or "")

    def test_recover_stale_running_job_times_out_when_attempts_exhausted(self):
        from src.application.tasks import TaskService
        from src.schemas.task_models import TaskAttempt, TaskJob, TaskStatus

        service = TaskService()
        stale_at = utc_now() - timedelta(minutes=5)
        job = TaskJob(
            id="job_stale_timeout",
            task_type="asset.generate",
            status=TaskStatus.RUNNING,
            queue_name="image",
            max_attempts=1,
            attempt_count=1,
            timeout_seconds=1800,
            created_at=stale_at,
            updated_at=stale_at,
            scheduled_at=stale_at,
            claimed_at=stale_at,
            started_at=stale_at,
            heartbeat_at=stale_at,
            worker_id="worker-old",
        )
        service.task_job_repository.create(job)
        service.task_attempt_repository.create(
            TaskAttempt(
                id="attempt_stale_timeout",
                job_id=job.id,
                attempt_no=1,
                worker_id="worker-old",
                started_at=stale_at,
                created_at=stale_at,
                updated_at=stale_at,
            )
        )

        recovered = service.recover_stale_jobs(stale_after_seconds=60)

        self.assertEqual(len(recovered), 1)
        updated = service.get_job(job.id)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, TaskStatus.TIMED_OUT)
        self.assertEqual(updated.error_code, "task_timeout")
        self.assertIsNotNone(updated.finished_at)
        self.assertIn("Recovered stale running job", updated.error_message or "")

    def test_worker_heartbeat_refreshes_during_execution(self):
        from src.application.tasks import TaskService
        from src.schemas.task_models import TaskJob, TaskStatus
        from src.worker.task_worker import TaskWorker

        service = TaskService()
        now = utc_now()
        job = TaskJob(
            id="job_heartbeat",
            task_type="test.sleep",
            status=TaskStatus.QUEUED,
            queue_name="image",
            created_at=now,
            updated_at=now,
            scheduled_at=now,
        )
        service.task_job_repository.create(job)

        class SleepExecutor:
            def __init__(self, task_service: TaskService):
                self.task_service = task_service
                self.observed_heartbeat_at = None
                self.observed_started_at = None

            def execute(self, running_job):
                time.sleep(0.25)
                refreshed = self.task_service.get_job(running_job.id)
                self.observed_heartbeat_at = refreshed.heartbeat_at
                self.observed_started_at = refreshed.started_at
                return {"ok": True}

        class TestRegistry:
            def __init__(self, executor):
                self.executor = executor

            def get(self, task_type: str):
                return self.executor

        worker = TaskWorker(queues=["image"], heartbeat_interval=0.05, stale_after_seconds=60)
        worker.task_service = service
        executor = SleepExecutor(service)
        worker.registry = TestRegistry(executor)

        worker._run_job(job.id)

        updated = service.get_job(job.id)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, TaskStatus.SUCCEEDED)
        self.assertIsNotNone(executor.observed_started_at)
        self.assertIsNotNone(executor.observed_heartbeat_at)
        self.assertGreater(executor.observed_heartbeat_at, executor.observed_started_at)

    def test_worker_periodically_recovers_stale_jobs_while_running(self):
        from src.application.tasks import TaskService
        from src.schemas.task_models import TaskAttempt, TaskJob, TaskStatus
        from src.worker.task_worker import TaskWorker

        service = TaskService()
        stale_at = utc_now() - timedelta(minutes=5)
        job = TaskJob(
            id="job_periodic_recover",
            task_type="storyboard.analyze",
            status=TaskStatus.RUNNING,
            queue_name="llm",
            max_attempts=1,
            attempt_count=1,
            timeout_seconds=600,
            created_at=stale_at,
            updated_at=stale_at,
            scheduled_at=stale_at,
            claimed_at=stale_at,
            started_at=stale_at,
            heartbeat_at=stale_at,
            worker_id="worker-old",
        )
        service.task_job_repository.create(job)
        service.task_attempt_repository.create(
            TaskAttempt(
                id="attempt_periodic_recover",
                job_id=job.id,
                attempt_no=1,
                worker_id="worker-old",
                started_at=stale_at,
                created_at=stale_at,
                updated_at=stale_at,
            )
        )

        worker = TaskWorker(
            queues=["llm"],
            heartbeat_interval=0.05,
            stale_after_seconds=60,
            recovery_check_interval=0.01,
        )
        worker.task_service = service
        worker._last_recovery_check = 0.0

        worker._recover_stale_jobs_if_needed()

        updated = service.get_job(job.id)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, TaskStatus.TIMED_OUT)


if __name__ == "__main__":
    unittest.main()
