from .base import BaseRepository
from .mappers import _task_event_from_record, _task_event_record
from ..db.models import TaskEventRecord
from ..schemas.task_models import TaskEvent


class TaskEventRepository(BaseRepository[TaskEvent]):
    def create(self, event: TaskEvent, session=None) -> TaskEvent:
        with self._with_session(session) as session:
            session.merge(_task_event_record(event))
        return event

    def list_by_job(self, job_id: str) -> list[TaskEvent]:
        with self._with_session() as session:
            rows = (
                session.query(TaskEventRecord)
                .filter(TaskEventRecord.job_id == job_id)
                .order_by(TaskEventRecord.created_at.asc())
                .all()
            )
            return [_task_event_from_record(row) for row in rows]
