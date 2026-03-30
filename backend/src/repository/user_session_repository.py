"""用户会话仓储。"""

from ..db.models import UserSessionRecord
from ..schemas.models import UserSession
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_user_session(record: UserSessionRecord) -> UserSession:
    return UserSession(
        id=record.id,
        user_id=record.user_id,
        current_workspace_id=record.current_workspace_id,
        session_token_hash=record.session_token_hash,
        expires_at=record.expires_at,
        revoked_at=record.revoked_at,
        ip_address=record.ip_address,
        user_agent=record.user_agent,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class UserSessionRepository(BaseRepository[UserSession]):
    def create(self, session_model: UserSession) -> UserSession:
        with self._with_session() as session:
            session.add(
                UserSessionRecord(
                    id=session_model.id,
                    user_id=session_model.user_id,
                    current_workspace_id=session_model.current_workspace_id,
                    session_token_hash=session_model.session_token_hash,
                    expires_at=session_model.expires_at,
                    revoked_at=session_model.revoked_at,
                    ip_address=session_model.ip_address,
                    user_agent=session_model.user_agent,
                    created_at=session_model.created_at,
                    updated_at=session_model.updated_at,
                )
            )
        return session_model

    def get_by_token_hash(self, token_hash: str) -> UserSession | None:
        with self._with_session() as session:
            record = session.query(UserSessionRecord).filter(UserSessionRecord.session_token_hash == token_hash).one_or_none()
            return _to_user_session(record) if record else None

    def get(self, session_id: str) -> UserSession | None:
        with self._with_session() as session:
            record = session.get(UserSessionRecord, session_id)
            return _to_user_session(record) if record else None

    def update(self, session_id: str, patch: dict) -> UserSession:
        with self._with_session() as session:
            record = session.get(UserSessionRecord, session_id)
            if record is None:
                raise ValueError(f"User session {session_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_user_session(record)

    def revoke_by_token_hash(self, token_hash: str) -> UserSession | None:
        with self._with_session() as session:
            record = session.query(UserSessionRecord).filter(UserSessionRecord.session_token_hash == token_hash).one_or_none()
            if record is None:
                return None
            record.revoked_at = utc_now()
            record.updated_at = record.revoked_at
            return _to_user_session(record)

    def revoke_all_for_user(self, user_id: str, *, except_session_id: str | None = None) -> None:
        with self._with_session() as session:
            query = session.query(UserSessionRecord).filter(UserSessionRecord.user_id == user_id, UserSessionRecord.revoked_at.is_(None))
            if except_session_id:
                query = query.filter(UserSessionRecord.id != except_session_id)
            now = utc_now()
            query.update(
                {
                    UserSessionRecord.revoked_at: now,
                    UserSessionRecord.updated_at: now,
                },
                synchronize_session=False,
            )

    def list_map(self):
        return {}

    def sync(self, items):
        raise NotImplementedError("UserSessionRepository does not support bulk sync")
