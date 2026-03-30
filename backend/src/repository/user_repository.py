"""用户仓储。"""

from typing import List

from ..db.models import MembershipRecord, UserRecord
from ..utils.datetime import utc_now
from .base import BaseRepository
from ..schemas.models import User


def _to_user(record: UserRecord) -> User:
    """把 ORM 记录转换为领域模型。"""
    return User(
        id=record.id,
        email=record.email,
        phone=record.phone,
        display_name=record.display_name,
        auth_provider=record.auth_provider,
        password_hash=record.password_hash,
        user_art_styles=record.user_art_styles or [],
        platform_role=record.platform_role,
        status=record.status,
        last_login_at=record.last_login_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class UserRepository(BaseRepository[User]):
    """用户表的基础 CRUD 与关联检查。"""

    def list(self) -> List[User]:
        with self._with_session() as session:
            records = session.query(UserRecord).order_by(UserRecord.created_at.desc()).all()
            return [_to_user(record) for record in records]

    def list_by_ids(self, user_ids: List[str]) -> List[User]:
        if not user_ids:
            return []
        with self._with_session() as session:
            records = (
                session.query(UserRecord)
                .filter(UserRecord.id.in_(user_ids))
                .all()
            )
            return [_to_user(record) for record in records]

    def get(self, user_id: str) -> User | None:
        with self._with_session() as session:
            record = session.get(UserRecord, user_id)
            return _to_user(record) if record else None

    def get_by_email(self, email: str) -> User | None:
        with self._with_session() as session:
            record = session.query(UserRecord).filter(UserRecord.email == email).one_or_none()
            return _to_user(record) if record else None

    def create(self, user: User) -> User:
        with self._with_session() as session:
            session.add(
                UserRecord(
                    id=user.id,
                    email=user.email,
                    phone=user.phone,
                    display_name=user.display_name,
                    auth_provider=user.auth_provider,
                    password_hash=user.password_hash,
                    user_art_styles=user.user_art_styles,
                    platform_role=user.platform_role,
                    status=user.status,
                    last_login_at=user.last_login_at,
                    created_at=user.created_at,
                    updated_at=user.updated_at,
                )
            )
        return user

    def get_by_phone(self, phone: str) -> User | None:
        with self._with_session() as session:
            record = session.query(UserRecord).filter(UserRecord.phone == phone).one_or_none()
            return _to_user(record) if record else None

    def update(self, user_id: str, patch: dict) -> User:
        with self._with_session() as session:
            record = session.get(UserRecord, user_id)
            if record is None:
                raise ValueError(f"User {user_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_user(record)

    def delete(self, user_id: str) -> None:
        with self._with_session() as session:
            record = session.get(UserRecord, user_id)
            if record is None:
                raise ValueError(f"User {user_id} not found")
            session.delete(record)

    def has_memberships(self, user_id: str) -> bool:
        with self._with_session() as session:
            return session.query(MembershipRecord.id).filter(MembershipRecord.user_id == user_id).first() is not None

    def list_map(self):
        return {user.id: user for user in self.list()}

    def sync(self, items):
        raise NotImplementedError("UserRepository does not support bulk sync")
