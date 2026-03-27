"""成员关系仓储。"""

from typing import List

from ..db.models import MembershipRecord
from ..utils.datetime import utc_now
from .base import BaseRepository
from ..schemas.models import Membership


def _to_membership(record: MembershipRecord) -> Membership:
    """把 ORM 记录转换为领域模型。"""
    return Membership(
        id=record.id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        user_id=record.user_id,
        role_id=record.role_id,
        status=record.status,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class MembershipRepository(BaseRepository[Membership]):
    """成员关系表的基础 CRUD。"""

    def list(
        self,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        user_id: str | None = None,
        role_id: str | None = None,
    ) -> List[Membership]:
        with self._with_session() as session:
            query = session.query(MembershipRecord)
            if organization_id is not None:
                query = query.filter(MembershipRecord.organization_id == organization_id)
            if workspace_id is not None:
                query = query.filter(MembershipRecord.workspace_id == workspace_id)
            if user_id is not None:
                query = query.filter(MembershipRecord.user_id == user_id)
            if role_id is not None:
                query = query.filter(MembershipRecord.role_id == role_id)
            records = query.order_by(MembershipRecord.created_at.desc()).all()
            return [_to_membership(record) for record in records]

    def get(self, membership_id: str) -> Membership | None:
        with self._with_session() as session:
            record = session.get(MembershipRecord, membership_id)
            return _to_membership(record) if record else None

    def create(self, membership: Membership) -> Membership:
        with self._with_session() as session:
            session.add(
                MembershipRecord(
                    id=membership.id,
                    organization_id=membership.organization_id,
                    workspace_id=membership.workspace_id,
                    user_id=membership.user_id,
                    role_id=membership.role_id,
                    status=membership.status,
                    created_at=membership.created_at,
                    updated_at=membership.updated_at,
                )
            )
        return membership

    def update(self, membership_id: str, patch: dict) -> Membership:
        with self._with_session() as session:
            record = session.get(MembershipRecord, membership_id)
            if record is None:
                raise ValueError(f"Membership {membership_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_membership(record)

    def delete(self, membership_id: str) -> None:
        with self._with_session() as session:
            record = session.get(MembershipRecord, membership_id)
            if record is None:
                raise ValueError(f"Membership {membership_id} not found")
            session.delete(record)

    def exists_conflict(
        self,
        membership_id: str | None,
        organization_id: str | None,
        workspace_id: str | None,
        user_id: str,
        role_id: str | None,
    ) -> bool:
        """避免同一用户在同一作用域下重复绑定相同角色。"""
        with self._with_session() as session:
            query = session.query(MembershipRecord).filter(
                MembershipRecord.organization_id == organization_id,
                MembershipRecord.workspace_id == workspace_id,
                MembershipRecord.user_id == user_id,
                MembershipRecord.role_id == role_id,
            )
            if membership_id is not None:
                query = query.filter(MembershipRecord.id != membership_id)
            return query.first() is not None

    def list_map(self):
        return {membership.id: membership for membership in self.list()}

    def sync(self, items):
        raise NotImplementedError("MembershipRepository does not support bulk sync")
