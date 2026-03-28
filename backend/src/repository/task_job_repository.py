from __future__ import annotations

from typing import Iterable

from sqlalchemy import or_

from .base import BaseRepository
from .mappers import _task_job_from_record, _task_job_record
from ..db.models import TaskJobRecord
from ..schemas.task_models import TaskJob
from ..utils.datetime import utc_now


ACTIVE_JOB_STATUSES = ("queued", "claimed", "running", "retry_waiting", "cancel_requested")


class TaskJobRepository(BaseRepository[TaskJob]):
    """任务主表仓储。

    这里同时服务项目页的定向查询和任务中心的聚合查询，
    避免前端再自己拼装“先拿项目再逐个拉任务”的脆弱链路。
    """

    def create(self, job: TaskJob) -> TaskJob:
        with self._with_session() as session:
            session.merge(_task_job_record(job))
        return job

    def save(self, job: TaskJob) -> TaskJob:
        return self.create(job)

    def get(self, job_id: str) -> TaskJob | None:
        with self._with_session() as session:
            row = session.get(TaskJobRecord, job_id)
            return _task_job_from_record(row) if row else None

    def get_by_idempotency_key(self, idempotency_key: str) -> TaskJob | None:
        with self._with_session() as session:
            row = session.query(TaskJobRecord).filter(TaskJobRecord.idempotency_key == idempotency_key).one_or_none()
            return _task_job_from_record(row) if row else None

    def get_active_by_dedupe_key(self, dedupe_key: str) -> TaskJob | None:
        with self._with_session() as session:
            row = (
                session.query(TaskJobRecord)
                .filter(
                    TaskJobRecord.dedupe_key == dedupe_key,
                    TaskJobRecord.status.in_(ACTIVE_JOB_STATUSES),
                )
                .order_by(TaskJobRecord.created_at.desc())
                .first()
            )
            return _task_job_from_record(row) if row else None

    def list_by_project(self, project_id: str, statuses: Iterable[str] | None = None) -> list[TaskJob]:
        with self._with_session() as session:
            query = session.query(TaskJobRecord).filter(TaskJobRecord.project_id == project_id)
            if statuses:
                query = query.filter(TaskJobRecord.status.in_(list(statuses)))
            rows = query.order_by(TaskJobRecord.created_at.desc()).all()
            return [_task_job_from_record(row) for row in rows]

    def list_jobs(
        self,
        *,
        project_id: str | None = None,
        series_id: str | None = None,
        statuses: Iterable[str] | None = None,
        limit: int | None = 200,
    ) -> list[TaskJob]:
        """按可选维度聚合查询任务。

        任务中心页需要直接展示最近任务；这里统一支持按项目、系列和状态过滤，
        并允许携带 limit，避免一次性扫出过多历史记录。
        """
        with self._with_session() as session:
            query = session.query(TaskJobRecord)
            if project_id:
                query = query.filter(TaskJobRecord.project_id == project_id)
            if series_id:
                query = query.filter(TaskJobRecord.series_id == series_id)
            if statuses:
                query = query.filter(TaskJobRecord.status.in_(list(statuses)))
            query = query.order_by(TaskJobRecord.created_at.desc())
            if limit is not None:
                query = query.limit(limit)
            rows = query.all()
            return [_task_job_from_record(row) for row in rows]

    def list_by_resource(self, resource_type: str, resource_id: str, statuses: Iterable[str] | None = None) -> list[TaskJob]:
        with self._with_session() as session:
            query = session.query(TaskJobRecord).filter(
                TaskJobRecord.resource_type == resource_type,
                TaskJobRecord.resource_id == resource_id,
            )
            if statuses:
                query = query.filter(TaskJobRecord.status.in_(list(statuses)))
            rows = query.order_by(TaskJobRecord.created_at.desc()).all()
            return [_task_job_from_record(row) for row in rows]

    def claim_next_jobs(self, queue_names: list[str], limit: int, worker_id: str) -> list[TaskJob]:
        claimed: list[TaskJob] = []
        with self._with_session() as session:
            query = (
                session.query(TaskJobRecord)
                .filter(
                    TaskJobRecord.queue_name.in_(queue_names),
                    or_(TaskJobRecord.status == "queued", TaskJobRecord.status == "retry_waiting"),
                    TaskJobRecord.scheduled_at <= utc_now(),
                )
                .order_by(TaskJobRecord.priority.asc(), TaskJobRecord.created_at.asc())
            )
            # PostgreSQL 环境下用 skip locked 避免多 worker 抢到同一行；SQLite 测试会自动退化。
            if session.bind and session.bind.dialect.name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            rows = query.limit(limit).all()
            now = utc_now()
            for row in rows:
                row.status = "claimed"
                row.claimed_at = now
                row.heartbeat_at = now
                row.worker_id = worker_id
                row.updated_at = now
                claimed.append(_task_job_from_record(row))
        return claimed

    def patch(self, job_id: str, patch: dict) -> TaskJob:
        with self._with_session() as session:
            record = session.get(TaskJobRecord, job_id)
            if record is None:
                raise ValueError(f"Task job {job_id} not found")
            # 任务状态机会频繁把字段显式清空，因此这里不能复用“忽略 None”的通用 patch 语义。
            now = utc_now()
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = now
            return _task_job_from_record(record)
