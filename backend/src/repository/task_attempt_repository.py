from .base import BaseRepository
from .mappers import _task_attempt_from_record, _task_attempt_record
from ..db.models import TaskAttemptRecord
from ..schemas.task_models import TaskAttempt


class TaskAttemptRepository(BaseRepository[TaskAttempt]):
    def create(self, attempt: TaskAttempt) -> TaskAttempt:
        with self._with_session() as session:
            session.merge(_task_attempt_record(attempt))
        return attempt

    def list_by_job(self, job_id: str) -> list[TaskAttempt]:
        with self._with_session() as session:
            rows = (
                session.query(TaskAttemptRecord)
                .filter(TaskAttemptRecord.job_id == job_id)
                .order_by(TaskAttemptRecord.attempt_no.asc())
                .all()
            )
            return [_task_attempt_from_record(row) for row in rows]

    def patch(self, attempt_id: str, patch: dict) -> TaskAttempt:
        with self._with_session() as session:
            record = session.get(TaskAttemptRecord, attempt_id)
            if record is None:
                raise ValueError(f"Task attempt {attempt_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            return _task_attempt_from_record(record)
