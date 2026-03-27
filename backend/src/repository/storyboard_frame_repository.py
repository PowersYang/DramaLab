from typing import List

from sqlalchemy import func

from .base import BaseRepository
from .mappers import _insert_frame, hydrate_project_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, StoryboardFrameRecord
from ..schemas.models import StoryboardFrame
from ..utils.datetime import utc_now


class StoryboardFrameRepository(BaseRepository[StoryboardFrame]):
    def list_by_project(self, project_id: str, include_deleted: bool = False) -> List[StoryboardFrame]:
        with self._with_session() as session:
            project = hydrate_project_map(session, {project_id}, include_deleted=include_deleted).get(project_id)
            return project.frames if project else []

    def get(self, project_id: str, frame_id: str, include_deleted: bool = False) -> StoryboardFrame | None:
        for frame in self.list_by_project(project_id, include_deleted=include_deleted):
            if frame.id == frame_id:
                return frame
        return None

    def create(self, project_id: str, frame: StoryboardFrame, frame_order: int | None = None) -> StoryboardFrame:
        with self._with_session() as session:
            ctx = load_owner_context(session, "project", project_id)
            existing_order = session.query(StoryboardFrameRecord.frame_order).filter(
                StoryboardFrameRecord.project_id == project_id,
                StoryboardFrameRecord.id == frame.id,
                StoryboardFrameRecord.is_deleted.is_(False),
            ).scalar()
            order = frame_order if frame_order is not None else existing_order
            if order is None:
                max_order = session.query(func.max(StoryboardFrameRecord.frame_order)).filter(StoryboardFrameRecord.project_id == project_id, StoryboardFrameRecord.is_deleted.is_(False)).scalar()
                order = 0 if max_order is None else max_order + 1
            _insert_frame(session, frame, project_id, order, owner_tenant_kwargs(ctx))
        return frame

    def patch(self, project_id: str, frame_id: str, patch: dict) -> StoryboardFrame:
        with self._with_session() as session:
            record = self._get_active(session, StoryboardFrameRecord, frame_id)
            if record is None or record.project_id != project_id:
                raise ValueError(f"Frame {frame_id} not found")
            self._patch_record(record, patch)
            return self.get(project_id, frame_id)

    def reorder(self, project_id: str, ordered_frame_ids: list[str]) -> None:
        with self._with_session() as session:
            now = utc_now()
            for index, frame_id in enumerate(ordered_frame_ids):
                session.query(StoryboardFrameRecord).filter(
                    StoryboardFrameRecord.project_id == project_id,
                    StoryboardFrameRecord.id == frame_id,
                    StoryboardFrameRecord.is_deleted.is_(False),
                ).update({"frame_order": index, "updated_at": now}, synchronize_session=False)

    def soft_delete(self, project_id: str, frame_id: str, deleted_by: str | None = None, session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "storyboard_frame", ImageVariantRecord.owner_id == frame_id, ImageVariantRecord.is_deleted.is_(False)).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)
            active_session.query(StoryboardFrameRecord).filter(
                StoryboardFrameRecord.project_id == project_id,
                StoryboardFrameRecord.id == frame_id,
                StoryboardFrameRecord.is_deleted.is_(False),
            ).update({"is_deleted": True, "deleted_at": now, "updated_at": now, "deleted_by": deleted_by}, synchronize_session=False)

    def save(self, project_id: str, frame: StoryboardFrame, frame_order: int | None = None) -> StoryboardFrame:
        self.soft_delete(project_id, frame.id)
        return self.create(project_id, frame, frame_order=frame_order)

    def delete(self, project_id: str, frame_id: str, session=None) -> None:
        self.soft_delete(project_id, frame_id, session=session)
