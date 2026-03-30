"""组织级任务并发限制仓储。"""

from __future__ import annotations

from ..db.models import TaskConcurrencyLimitRecord
from ..schemas.models import TaskConcurrencyLimit
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: TaskConcurrencyLimitRecord) -> TaskConcurrencyLimit:
    return TaskConcurrencyLimit(
        id=record.id,
        organization_id=record.organization_id,
        task_type=record.task_type,
        max_concurrency=record.max_concurrency,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class TaskConcurrencyLimitRepository(BaseRepository[TaskConcurrencyLimit]):
    """为组织和任务类型提供独立的并发限制 CRUD。"""

    def list(self) -> list[TaskConcurrencyLimit]:
        with self._with_session() as session:
            records = (
                session.query(TaskConcurrencyLimitRecord)
                .order_by(TaskConcurrencyLimitRecord.organization_id.asc(), TaskConcurrencyLimitRecord.task_type.asc())
                .all()
            )
            return [_to_domain(record) for record in records]

    def get_by_scope(self, organization_id: str, task_type: str) -> TaskConcurrencyLimit | None:
        with self._with_session() as session:
            record = (
                session.query(TaskConcurrencyLimitRecord)
                .filter(
                    TaskConcurrencyLimitRecord.organization_id == organization_id,
                    TaskConcurrencyLimitRecord.task_type == task_type,
                )
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def create(self, item: TaskConcurrencyLimit) -> TaskConcurrencyLimit:
        with self._with_session() as session:
            record = TaskConcurrencyLimitRecord(
                id=item.id,
                organization_id=item.organization_id,
                task_type=item.task_type,
                max_concurrency=item.max_concurrency,
                created_by=item.created_by,
                updated_by=item.updated_by,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            session.add(record)
            return _to_domain(record)

    def update(self, item_id: str, patch: dict) -> TaskConcurrencyLimit:
        with self._with_session() as session:
            record = session.get(TaskConcurrencyLimitRecord, item_id)
            if record is None:
                raise ValueError("Task concurrency limit not found")
            for key, value in patch.items():
                if hasattr(record, key) and value is not None:
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_domain(record)

    def upsert_by_scope(
        self,
        *,
        organization_id: str,
        task_type: str,
        max_concurrency: int,
        actor_id: str | None = None,
        record_id: str | None = None,
    ) -> TaskConcurrencyLimit:
        with self._with_session() as session:
            record = (
                session.query(TaskConcurrencyLimitRecord)
                .filter(
                    TaskConcurrencyLimitRecord.organization_id == organization_id,
                    TaskConcurrencyLimitRecord.task_type == task_type,
                )
                .one_or_none()
            )
            now = utc_now()
            if record is None:
                record = TaskConcurrencyLimitRecord(
                    id=record_id or f"tcl_{organization_id}_{task_type}".replace(".", "_"),
                    organization_id=organization_id,
                    task_type=task_type,
                    max_concurrency=max_concurrency,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(record)
            else:
                record.max_concurrency = max_concurrency
                record.updated_by = actor_id
                record.updated_at = now
            return _to_domain(record)

    def delete_by_scope(self, organization_id: str, task_type: str) -> None:
        with self._with_session() as session:
            record = (
                session.query(TaskConcurrencyLimitRecord)
                .filter(
                    TaskConcurrencyLimitRecord.organization_id == organization_id,
                    TaskConcurrencyLimitRecord.task_type == task_type,
                )
                .one_or_none()
            )
            if record is None:
                raise ValueError("Task concurrency limit not found")
            session.delete(record)

    def list_map(self):
        return {(item.organization_id, item.task_type): item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("TaskConcurrencyLimitRepository does not support bulk sync")
