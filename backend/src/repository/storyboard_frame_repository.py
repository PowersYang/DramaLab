from typing import List

from sqlalchemy import func

from .base import BaseRepository
from .image_variant_repository import ImageVariantRepository
from .mappers import _audit_time_kwargs, hydrate_project_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, StoryboardFrameRecord
from ..schemas.models import StoryboardFrame
from ..utils.datetime import utc_now


class StoryboardFrameRepository(BaseRepository[StoryboardFrame]):
    def __init__(self):
        self.image_variant_repository = ImageVariantRepository()

    def list_by_project(self, project_id: str, include_deleted: bool = False) -> List[StoryboardFrame]:
        with self._with_session() as session:
            project = hydrate_project_map(session, {project_id}, include_deleted=include_deleted).get(project_id)
            return project.frames if project else []

    def get(self, project_id: str, frame_id: str, include_deleted: bool = False) -> StoryboardFrame | None:
        for frame in self.list_by_project(project_id, include_deleted=include_deleted):
            if frame.id == frame_id:
                return frame
        return None

    def create(self, project_id: str, frame: StoryboardFrame, frame_order: int | None = None, session=None) -> StoryboardFrame:
        with self._with_session(session) as active_session:
            ctx = load_owner_context(active_session, "project", project_id)
            tenant = owner_tenant_kwargs(ctx)
            existing_order = active_session.query(StoryboardFrameRecord.frame_order).filter(
                StoryboardFrameRecord.project_id == project_id,
                StoryboardFrameRecord.id == frame.id,
                StoryboardFrameRecord.is_deleted.is_(False),
            ).scalar()
            order = frame_order if frame_order is not None else existing_order
            if order is None:
                max_order = active_session.query(func.max(StoryboardFrameRecord.frame_order)).filter(StoryboardFrameRecord.project_id == project_id, StoryboardFrameRecord.is_deleted.is_(False)).scalar()
                order = 0 if max_order is None else max_order + 1
            active_session.merge(
                StoryboardFrameRecord(
                    id=frame.id,
                    project_id=project_id,
                    frame_order=order,
                    scene_id=frame.scene_id,
                    character_ids=frame.character_ids,
                    prop_ids=frame.prop_ids,
                    action_description=frame.action_description,
                    facial_expression=frame.facial_expression,
                    dialogue=frame.dialogue,
                    speaker=frame.speaker,
                    visual_atmosphere=frame.visual_atmosphere,
                    character_acting=frame.character_acting,
                    key_action_physics=frame.key_action_physics,
                    shot_size=frame.shot_size,
                    camera_angle=frame.camera_angle,
                    camera_movement=frame.camera_movement,
                    composition=frame.composition,
                    atmosphere=frame.atmosphere,
                    composition_data=frame.composition_data,
                    image_prompt=frame.image_prompt,
                    image_prompt_cn=frame.image_prompt_cn,
                    image_prompt_en=frame.image_prompt_en,
                    image_url=frame.image_url,
                    image_selected_id=(frame.image_asset.selected_id if frame.image_asset else None),
                    rendered_image_url=frame.rendered_image_url,
                    rendered_image_selected_id=(frame.rendered_image_asset.selected_id if frame.rendered_image_asset else None),
                    video_prompt=frame.video_prompt,
                    video_url=frame.video_url,
                    audio_url=frame.audio_url,
                    audio_error=frame.audio_error,
                    sfx_url=frame.sfx_url,
                    selected_video_id=frame.selected_video_id,
                    locked=frame.locked,
                    status=frame.status,
                    is_deleted=False,
                    deleted_at=None,
                    deleted_by=None,
                    **tenant,
                    **_audit_time_kwargs(frame),
                )
            )
            self.image_variant_repository.sync_exact(
                "storyboard_frame",
                frame.id,
                "image_asset",
                list(frame.image_asset.variants if frame.image_asset else []),
                tenant,
                session=active_session,
            )
            self.image_variant_repository.sync_exact(
                "storyboard_frame",
                frame.id,
                "rendered_image_asset",
                list(frame.rendered_image_asset.variants if frame.rendered_image_asset else []),
                tenant,
                session=active_session,
            )
        return frame

    def patch(self, project_id: str, frame_id: str, patch: dict, session=None) -> StoryboardFrame:
        with self._with_session(session) as active_session:
            record = self._get_active(active_session, StoryboardFrameRecord, frame_id)
            if record is None or record.project_id != project_id:
                raise ValueError(f"Frame {frame_id} not found")
            self._patch_record(record, patch)
            return self.get(project_id, frame_id)

    def reorder(self, project_id: str, ordered_frame_ids: list[str], session=None) -> None:
        with self._with_session(session) as active_session:
            now = utc_now()
            for index, frame_id in enumerate(ordered_frame_ids):
                active_session.query(StoryboardFrameRecord).filter(
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

    def save(self, project_id: str, frame: StoryboardFrame, frame_order: int | None = None, session=None) -> StoryboardFrame:
        return self.create(project_id, frame, frame_order=frame_order, session=session)

    def delete(self, project_id: str, frame_id: str, session=None) -> None:
        self.soft_delete(project_id, frame_id, session=session)
