"""认证限流事件仓储。"""

from datetime import datetime

from ..db.models import AuthRateLimitRecord
from ..schemas.models import AuthRateLimitEntry
from .base import BaseRepository


def _to_auth_rate_limit_entry(record: AuthRateLimitRecord) -> AuthRateLimitEntry:
    return AuthRateLimitEntry(
        id=record.id,
        action=record.action,
        scope_type=record.scope_type,
        scope_key=record.scope_key,
        created_at=record.created_at,
    )


class AuthRateLimitRepository(BaseRepository[AuthRateLimitEntry]):
    def create(self, entry: AuthRateLimitEntry) -> AuthRateLimitEntry:
        with self._with_session() as session:
            session.add(
                AuthRateLimitRecord(
                    id=entry.id,
                    action=entry.action,
                    scope_type=entry.scope_type,
                    scope_key=entry.scope_key,
                    created_at=entry.created_at,
                )
            )
        return entry

    def count_since(self, *, action: str, scope_type: str, scope_key: str, since: datetime) -> int:
        with self._with_session() as session:
            return (
                session.query(AuthRateLimitRecord)
                .filter(
                    AuthRateLimitRecord.action == action,
                    AuthRateLimitRecord.scope_type == scope_type,
                    AuthRateLimitRecord.scope_key == scope_key,
                    AuthRateLimitRecord.created_at >= since,
                )
                .count()
            )

    def get_latest(self, *, action: str, scope_type: str, scope_key: str) -> AuthRateLimitEntry | None:
        with self._with_session() as session:
            record = (
                session.query(AuthRateLimitRecord)
                .filter(
                    AuthRateLimitRecord.action == action,
                    AuthRateLimitRecord.scope_type == scope_type,
                    AuthRateLimitRecord.scope_key == scope_key,
                )
                .order_by(AuthRateLimitRecord.created_at.desc())
                .first()
            )
            return _to_auth_rate_limit_entry(record) if record else None

    def list_map(self):
        return {}

    def sync(self, items):
        raise NotImplementedError("AuthRateLimitRepository does not support bulk sync")
