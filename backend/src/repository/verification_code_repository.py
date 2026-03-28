"""验证码仓储。"""

from ..db.models import VerificationCodeRecord
from ..schemas.models import VerificationCode
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_verification_code(record: VerificationCodeRecord) -> VerificationCode:
    return VerificationCode(
        id=record.id,
        target_type=record.target_type,
        target_value=record.target_value,
        purpose=record.purpose,
        code_hash=record.code_hash,
        expires_at=record.expires_at,
        attempt_count=record.attempt_count,
        max_attempts=record.max_attempts,
        consumed_at=record.consumed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class VerificationCodeRepository(BaseRepository[VerificationCode]):
    def create(self, code: VerificationCode) -> VerificationCode:
        with self._with_session() as session:
            session.add(
                VerificationCodeRecord(
                    id=code.id,
                    target_type=code.target_type,
                    target_value=code.target_value,
                    purpose=code.purpose,
                    code_hash=code.code_hash,
                    expires_at=code.expires_at,
                    attempt_count=code.attempt_count,
                    max_attempts=code.max_attempts,
                    consumed_at=code.consumed_at,
                    created_at=code.created_at,
                    updated_at=code.updated_at,
                )
            )
        return code

    def get_latest_active(self, target_type: str, target_value: str, purpose: str) -> VerificationCode | None:
        with self._with_session() as session:
            record = (
                session.query(VerificationCodeRecord)
                .filter(
                    VerificationCodeRecord.target_type == target_type,
                    VerificationCodeRecord.target_value == target_value,
                    VerificationCodeRecord.purpose == purpose,
                )
                .order_by(VerificationCodeRecord.created_at.desc())
                .first()
            )
            return _to_verification_code(record) if record else None

    def get(self, code_id: str) -> VerificationCode | None:
        with self._with_session() as session:
            record = session.get(VerificationCodeRecord, code_id)
            return _to_verification_code(record) if record else None

    def mark_attempt(self, code_id: str) -> VerificationCode:
        with self._with_session() as session:
            record = session.get(VerificationCodeRecord, code_id)
            if record is None:
                raise ValueError(f"Verification code {code_id} not found")
            record.attempt_count += 1
            record.updated_at = utc_now()
            return _to_verification_code(record)

    def consume(self, code_id: str) -> VerificationCode:
        with self._with_session() as session:
            record = session.get(VerificationCodeRecord, code_id)
            if record is None:
                raise ValueError(f"Verification code {code_id} not found")
            record.consumed_at = utc_now()
            record.updated_at = record.consumed_at
            return _to_verification_code(record)

    def list_map(self):
        return {}

    def sync(self, items):
        raise NotImplementedError("VerificationCodeRepository does not support bulk sync")
