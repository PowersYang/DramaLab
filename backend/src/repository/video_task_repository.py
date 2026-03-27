from typing import List

from .base import BaseRepository
from .mappers import _video_task_from_record, _video_task_record
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import VideoTaskRecord
from ..schemas.models import VideoTask
from ..utils.datetime import utc_now


class VideoTaskRepository(BaseRepository[VideoTask]):
    def list_by_project(self, project_id: str, include_deleted: bool = False) -> List[VideoTask]:
        with self._with_session() as session:
            query = session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id)
            if not include_deleted:
                query = query.filter(VideoTaskRecord.is_deleted.is_(False))
            rows = query.order_by(VideoTaskRecord.created_at).all()
            return [_video_task_from_record(row) for row in rows]

    def get(self, project_id: str, task_id: str, include_deleted: bool = False) -> VideoTask | None:
        with self._with_session() as session:
            query = session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id, VideoTaskRecord.id == task_id)
            if not include_deleted:
                query = query.filter(VideoTaskRecord.is_deleted.is_(False))
            row = query.one_or_none()
            return _video_task_from_record(row) if row else None

    def create(self, task: VideoTask) -> VideoTask:
        with self._with_session() as session:
            ctx = load_owner_context(session, "project", task.project_id)
            session.merge(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return task

    def patch(self, project_id: str, task_id: str, patch: dict) -> VideoTask:
        with self._with_session() as session:
            record = self._get_active(session, VideoTaskRecord, task_id)
            if record is None or record.project_id != project_id:
                raise ValueError(f"Video task {task_id} not found")
            self._patch_record(record, patch)
            return self.get(project_id, task_id)

    def soft_delete(self, project_id: str, task_id: str, deleted_by: str | None = None) -> None:
        with self._with_session() as session:
            now = utc_now()
            session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id, VideoTaskRecord.id == task_id, VideoTaskRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def restore(self, project_id: str, task_id: str) -> VideoTask:
        with self._with_session() as session:
            record = session.get(VideoTaskRecord, task_id)
            if record is None or record.project_id != project_id:
                raise ValueError(f"Video task {task_id} not found")
            self._restore_record(record)
            return self.get(project_id, task_id)

    def save(self, task: VideoTask) -> VideoTask:
        return self.create(task)

    def delete(self, project_id: str, task_id: str) -> None:
        self.soft_delete(project_id, task_id)
