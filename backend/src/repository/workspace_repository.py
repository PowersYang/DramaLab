"""工作区仓储。"""

from typing import List

from ..db.models import MembershipRecord, OrganizationRecord, ProjectRecord, SeriesRecord, WorkspaceRecord
from ..utils.datetime import utc_now
from .base import BaseRepository
from ..schemas.models import Workspace


def _to_workspace(record: WorkspaceRecord) -> Workspace:
    """把 ORM 记录转换为领域模型。"""
    return Workspace(
        id=record.id,
        organization_id=record.organization_id,
        name=record.name,
        slug=record.slug,
        status=record.status,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class WorkspaceRepository(BaseRepository[Workspace]):
    """工作区表的基础 CRUD 与依赖检查。"""

    def list(self, organization_id: str | None = None) -> List[Workspace]:
        with self._with_session() as session:
            query = session.query(WorkspaceRecord)
            if organization_id is not None:
                query = query.filter(WorkspaceRecord.organization_id == organization_id)
            records = query.order_by(WorkspaceRecord.created_at.desc()).all()
            return [_to_workspace(record) for record in records]

    def get(self, workspace_id: str) -> Workspace | None:
        with self._with_session() as session:
            record = session.get(WorkspaceRecord, workspace_id)
            return _to_workspace(record) if record else None

    def create(self, workspace: Workspace) -> Workspace:
        with self._with_session() as session:
            session.add(
                WorkspaceRecord(
                    id=workspace.id,
                    organization_id=workspace.organization_id,
                    name=workspace.name,
                    slug=workspace.slug,
                    status=workspace.status,
                    created_at=workspace.created_at,
                    updated_at=workspace.updated_at,
                )
            )
        return workspace

    def update(self, workspace_id: str, patch: dict) -> Workspace:
        with self._with_session() as session:
            record = session.get(WorkspaceRecord, workspace_id)
            if record is None:
                raise ValueError(f"Workspace {workspace_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_workspace(record)

    def delete(self, workspace_id: str) -> None:
        with self._with_session() as session:
            record = session.get(WorkspaceRecord, workspace_id)
            if record is None:
                raise ValueError(f"Workspace {workspace_id} not found")
            session.delete(record)

    def organization_exists(self, organization_id: str) -> bool:
        with self._with_session() as session:
            return session.get(OrganizationRecord, organization_id) is not None

    def has_dependents(self, workspace_id: str) -> bool:
        """删除工作区前，先确认没有明显的下游依赖。"""
        with self._with_session() as session:
            checks = [
                session.query(MembershipRecord.id).filter(MembershipRecord.workspace_id == workspace_id).first(),
                session.query(ProjectRecord.id).filter(ProjectRecord.workspace_id == workspace_id, ProjectRecord.is_deleted.is_(False)).first(),
                session.query(SeriesRecord.id).filter(SeriesRecord.workspace_id == workspace_id, SeriesRecord.is_deleted.is_(False)).first(),
            ]
            return any(item is not None for item in checks)

    def list_map(self):
        return {workspace.id: workspace for workspace in self.list()}

    def sync(self, items):
        raise NotImplementedError("WorkspaceRepository does not support bulk sync")
