from typing import List

from .base import BaseRepository
from .mappers import _video_task_from_record, _video_task_record
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import VideoTaskRecord
from ..schemas.models import VideoTask


class VideoTaskRepository(BaseRepository[VideoTask]):
    def list_by_project(self, project_id: str) -> List[VideoTask]:
        with self._with_session() as session:
            rows = session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id).order_by(VideoTaskRecord.created_at).all()
            return [_video_task_from_record(row) for row in rows]

    def get(self, project_id: str, task_id: str) -> VideoTask | None:
        with self._with_session() as session:
            row = session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id, VideoTaskRecord.id == task_id).one_or_none()
            return _video_task_from_record(row) if row else None

    def save(self, task: VideoTask) -> VideoTask:
        with self._with_session() as session:
            ctx = load_owner_context(session, "project", task.project_id)
            session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == task.project_id, VideoTaskRecord.id == task.id).delete(synchronize_session=False)
            session.add(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return task

    def delete(self, project_id: str, task_id: str) -> None:
        with self._with_session() as session:
            session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == project_id, VideoTaskRecord.id == task_id).delete(synchronize_session=False)
