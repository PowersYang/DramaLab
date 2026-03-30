"""图形验证码挑战仓储。"""

from ..db.models import CaptchaChallengeRecord
from ..schemas.models import CaptchaChallenge
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_captcha_challenge(record: CaptchaChallengeRecord) -> CaptchaChallenge:
    return CaptchaChallenge(
        id=record.id,
        code_hash=record.code_hash,
        expires_at=record.expires_at,
        consumed_at=record.consumed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class CaptchaChallengeRepository(BaseRepository[CaptchaChallenge]):
    def create(self, challenge: CaptchaChallenge) -> CaptchaChallenge:
        with self._with_session() as session:
            session.add(
                CaptchaChallengeRecord(
                    id=challenge.id,
                    code_hash=challenge.code_hash,
                    expires_at=challenge.expires_at,
                    consumed_at=challenge.consumed_at,
                    created_at=challenge.created_at,
                    updated_at=challenge.updated_at,
                )
            )
        return challenge

    def get(self, challenge_id: str) -> CaptchaChallenge | None:
        with self._with_session() as session:
            record = session.get(CaptchaChallengeRecord, challenge_id)
            return _to_captcha_challenge(record) if record else None

    def consume(self, challenge_id: str) -> CaptchaChallenge:
        with self._with_session() as session:
            record = session.get(CaptchaChallengeRecord, challenge_id)
            if record is None:
                raise ValueError(f"Captcha challenge {challenge_id} not found")
            record.consumed_at = utc_now()
            record.updated_at = record.consumed_at
            return _to_captcha_challenge(record)

    def list_map(self):
        return {}

    def sync(self, items):
        raise NotImplementedError("CaptchaChallengeRepository does not support bulk sync")
