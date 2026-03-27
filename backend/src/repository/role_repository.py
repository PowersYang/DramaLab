"""角色仓储。"""

from typing import List

from ..db.models import MembershipRecord, RoleRecord
from ..utils.datetime import utc_now
from .base import BaseRepository
from ..schemas.models import Role


def _to_role(record: RoleRecord) -> Role:
    """把 ORM 记录转换为领域模型。"""
    return Role(
        id=record.id,
        code=record.code,
        name=record.name,
        description=record.description,
        is_system=record.is_system,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class RoleRepository(BaseRepository[Role]):
    """角色表的基础 CRUD 与引用检查。"""

    def list(self) -> List[Role]:
        with self._with_session() as session:
            records = session.query(RoleRecord).order_by(RoleRecord.created_at.desc()).all()
            return [_to_role(record) for record in records]

    def get(self, role_id: str) -> Role | None:
        with self._with_session() as session:
            record = session.get(RoleRecord, role_id)
            return _to_role(record) if record else None

    def get_by_code(self, code: str) -> Role | None:
        with self._with_session() as session:
            record = session.query(RoleRecord).filter(RoleRecord.code == code).one_or_none()
            return _to_role(record) if record else None

    def create(self, role: Role) -> Role:
        with self._with_session() as session:
            session.add(
                RoleRecord(
                    id=role.id,
                    code=role.code,
                    name=role.name,
                    description=role.description,
                    is_system=role.is_system,
                    created_at=role.created_at,
                    updated_at=role.updated_at,
                )
            )
        return role

    def update(self, role_id: str, patch: dict) -> Role:
        with self._with_session() as session:
            record = session.get(RoleRecord, role_id)
            if record is None:
                raise ValueError(f"Role {role_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_role(record)

    def delete(self, role_id: str) -> None:
        with self._with_session() as session:
            record = session.get(RoleRecord, role_id)
            if record is None:
                raise ValueError(f"Role {role_id} not found")
            session.delete(record)

    def has_memberships(self, role_id: str) -> bool:
        with self._with_session() as session:
            return session.query(MembershipRecord.id).filter(MembershipRecord.role_id == role_id).first() is not None

    def list_map(self):
        return {role.id: role for role in self.list()}

    def sync(self, items):
        raise NotImplementedError("RoleRepository does not support bulk sync")
