import socket
import threading
import time

from ..application.tasks import TaskService
from ..application.tasks.registry import TaskExecutorRegistry
from ..common.log import get_logger
from ..utils.datetime import utc_now


logger = get_logger(__name__)


def build_worker_id() -> str:
    return f"worker-{socket.gethostname()}"


class TaskWorker:
    def __init__(self, queues: list[str], poll_interval: float = 2.0):
        self.queues = queues
        self.poll_interval = poll_interval
        self.worker_id = build_worker_id()
        self.task_service = TaskService()
        self.registry = TaskExecutorRegistry()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def run_forever(self):
        logger.info("TASK_WORKER: start worker_id=%s queues=%s poll_interval=%s", self.worker_id, self.queues, self.poll_interval)
        while not self._stop_event.is_set():
            try:
                jobs = self.task_service.task_job_repository.claim_next_jobs(
                    queue_names=self.queues,
                    limit=1,
                    worker_id=self.worker_id,
                )
            except Exception:
                logger.exception("TASK_WORKER: polling_failed worker_id=%s", self.worker_id)
                self._stop_event.wait(self.poll_interval)
                continue
            if not jobs:
                self._stop_event.wait(self.poll_interval)
                continue
            for job in jobs:
                if self._stop_event.is_set():
                    break
                self._run_job(job.id)
        logger.info("TASK_WORKER: stopped worker_id=%s", self.worker_id)

    def start_in_thread(self, name: str = "lumenx-task-worker"):
        if self._thread and self._thread.is_alive():
            logger.info("TASK_WORKER: thread already running worker_id=%s", self.worker_id)
            return self._thread
        self._stop_event.clear()
        self._thread = threading.Thread(target=self.run_forever, name=name, daemon=True)
        self._thread.start()
        logger.info("TASK_WORKER: thread_started worker_id=%s thread_name=%s", self.worker_id, name)
        return self._thread

    def stop(self, timeout: float = 5.0):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        logger.info("TASK_WORKER: stop_requested worker_id=%s", self.worker_id)

    def _run_job(self, job_id: str):
        job = self.task_service.get_job(job_id)
        if not job:
            return
        if job.status == "cancel_requested":
            self.task_service.mark_job_cancelled(job_id, "Task cancelled before execution")
            return
        attempt = self.task_service.create_attempt(job, self.worker_id)
        running_job = self.task_service.mark_job_running(job_id, self.worker_id)
        if running_job.cancel_requested_at:
            self.task_service.mark_job_cancelled(job_id)
            self.task_service.task_attempt_repository.patch(
                attempt.id,
                {"outcome": "cancelled", "ended_at": utc_now()},
            )
            return
        try:
            result = self.registry.get(running_job.task_type).execute(running_job)
            completed_job = self.task_service.mark_job_succeeded(job_id, result_json=result)
            self.task_service.task_attempt_repository.patch(
                attempt.id,
                {"outcome": "succeeded", "ended_at": completed_job.finished_at or utc_now()},
            )
        except Exception as exc:
            self.task_service.mark_job_failed(job_id, str(exc))
            self.task_service.task_attempt_repository.patch(
                attempt.id,
                {"outcome": "failed", "error_message": str(exc), "ended_at": utc_now()},
            )
