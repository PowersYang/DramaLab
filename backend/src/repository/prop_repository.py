from typing import List

from .base import BaseRepository
from .mappers import _insert_prop, _video_task_record, hydrate_project_map, hydrate_series_map
from .owner_context import load_owner_context, owner_tenant_kwargs
from ..db.models import ImageVariantRecord, PropRecord, VideoTaskRecord
from ..schemas.models import Prop


class PropRepository(BaseRepository[Prop]):
    def list_by_owner(self, owner_type: str, owner_id: str) -> List[Prop]:
        with self._with_session() as session:
            if owner_type == "project":
                project = hydrate_project_map(session, {owner_id}).get(owner_id)
                return project.props if project else []
            if owner_type == "series":
                series = hydrate_series_map(session, {owner_id}).get(owner_id)
                return series.props if series else []
            raise ValueError(f"Unsupported owner_type: {owner_type}")

    def get(self, owner_type: str, owner_id: str, prop_id: str) -> Prop | None:
        for prop in self.list_by_owner(owner_type, owner_id):
            if prop.id == prop_id:
                return prop
        return None

    def save(self, owner_type: str, owner_id: str, prop: Prop) -> Prop:
        with self._with_session() as session:
            ctx = load_owner_context(session, owner_type, owner_id)
            self.delete(owner_type, owner_id, prop.id, session=session)
            _insert_prop(session, prop, owner_type, owner_id, owner_tenant_kwargs(ctx))
            if owner_type == "project":
                session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == prop.id).delete(synchronize_session=False)
                for task in prop.video_assets:
                    session.add(_video_task_record(task, owner_tenant_kwargs(ctx)))
        return prop

    def delete(self, owner_type: str, owner_id: str, prop_id: str, session=None) -> None:
        with self._with_session(session) as active_session:
            active_session.query(ImageVariantRecord).filter(ImageVariantRecord.owner_type == "prop", ImageVariantRecord.owner_id == prop_id).delete(synchronize_session=False)
            active_session.query(PropRecord).filter(PropRecord.id == prop_id, PropRecord.owner_type == owner_type, PropRecord.owner_id == owner_id).delete(synchronize_session=False)
            if owner_type == "project":
                active_session.query(VideoTaskRecord).filter(VideoTaskRecord.project_id == owner_id, VideoTaskRecord.asset_id == prop_id).delete(synchronize_session=False)
