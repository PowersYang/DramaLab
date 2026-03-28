"""工作区邀请仓储。"""

from ..db.models import InvitationRecord
from ..schemas.models import Invitation
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_invitation(record: InvitationRecord) -> Invitation:
    return Invitation(
        id=record.id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        email=record.email,
        role_code=record.role_code,
        invited_by=record.invited_by,
        expires_at=record.expires_at,
        accepted_at=record.accepted_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class InvitationRepository(BaseRepository[Invitation]):
    def create(self, invitation: Invitation) -> Invitation:
        with self._with_session() as session:
            session.add(
                InvitationRecord(
                    id=invitation.id,
                    organization_id=invitation.organization_id,
                    workspace_id=invitation.workspace_id,
                    email=invitation.email,
                    role_code=invitation.role_code,
                    invited_by=invitation.invited_by,
                    expires_at=invitation.expires_at,
                    accepted_at=invitation.accepted_at,
                    created_at=invitation.created_at,
                    updated_at=invitation.updated_at,
                )
            )
        return invitation

    def list_pending_by_email(self, email: str) -> list[Invitation]:
        with self._with_session() as session:
            records = (
                session.query(InvitationRecord)
                .filter(InvitationRecord.email == email, InvitationRecord.accepted_at.is_(None))
                .order_by(InvitationRecord.created_at.desc())
                .all()
            )
            return [_to_invitation(record) for record in records]

    def get(self, invitation_id: str) -> Invitation | None:
        with self._with_session() as session:
            record = session.get(InvitationRecord, invitation_id)
            return _to_invitation(record) if record else None

    def mark_accepted(self, invitation_id: str) -> Invitation:
        with self._with_session() as session:
            record = session.get(InvitationRecord, invitation_id)
            if record is None:
                raise ValueError(f"Invitation {invitation_id} not found")
            record.accepted_at = utc_now()
            record.updated_at = record.accepted_at
            return _to_invitation(record)

    def list_map(self):
        return {}

    def sync(self, items):
        raise NotImplementedError("InvitationRepository does not support bulk sync")
