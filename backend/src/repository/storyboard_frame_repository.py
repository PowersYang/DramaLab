from typing import List

from sqlalchemy import func

from .base import BaseRepository
from .mappers import _insert_frame, hydrate_project_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, StoryboardFrameRecord
from ..schemas.models import StoryboardFrame


class StoryboardFrameRepository(BaseRepository[StoryboardFrame]):
    def list_by_project(self, project_id: str) -> List[StoryboardFrame]:
        with self._with_session() as session:
            project = hydrate_project_map(session, {project_id}).get(project_id)
            return project.frames if project else []

    def get(self, project_id: str, frame_id: str) -> StoryboardFrame | None:
        for frame in self.list_by_project(project_id):
            if frame.id == frame_id:
                return frame
        return None

    def save(self, project_id: str, frame: StoryboardFrame, frame_order: int | None = None) -> StoryboardFrame:
        with self._with_session() as session:
            ctx = load_owner_context(session, "project", project_id)
            existing_order = session.query(StoryboardFrameRecord.frame_order).filter(
                StoryboardFrameRecord.project_id == project_id,
                StoryboardFrameRecord.id == frame.id,
            ).scalar()
            order = frame_order if frame_order is not None else existing_order
            if order is None:
                max_order = session.query(func.max(StoryboardFrameRecord.frame_order)).filter(StoryboardFrameRecord.project_id == project_id).scalar()
                order = 0 if max_order is None else max_order + 1

            self.delete(project_id, frame.id, session=session)
            _insert_frame(session, frame, project_id, order, owner_tenant_kwargs(ctx))
        return frame

    def delete(self, project_id: str, frame_id: str, session=None) -> None:
        with self._with_session(session) as active_session:
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "storyboard_frame", ImageVariantRecord.owner_id == frame_id).delete(synchronize_session=False)
            active_session.query(StoryboardFrameRecord).filter(
                StoryboardFrameRecord.project_id == project_id,
                StoryboardFrameRecord.id == frame_id,
            ).delete(synchronize_session=False)
