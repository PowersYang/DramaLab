from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from ..db.models import CharacterRecord, ProjectRecord, SeriesRecord


@dataclass
class OwnerContext:
    owner_type: str
    owner_id: str
    organization_id: str | None
    workspace_id: str | None
    created_by: str | None
    updated_by: str | None
    created_at: datetime
    updated_at: datetime


def load_owner_context(session: Session, owner_type: str, owner_id: str) -> OwnerContext:
    if owner_type == "project":
        record = session.get(ProjectRecord, owner_id)
    elif owner_type == "series":
        record = session.get(SeriesRecord, owner_id)
    elif owner_type == "character":
        record = session.get(CharacterRecord, owner_id)
    else:
        raise ValueError(f"Unsupported owner_type: {owner_type}")

    if record is None or getattr(record, "is_deleted", False):
        raise ValueError(f"{owner_type} {owner_id} not found")

    return OwnerContext(
        owner_type=owner_type,
        owner_id=owner_id,
        organization_id=getattr(record, "organization_id", None),
        workspace_id=getattr(record, "workspace_id", None),
        created_by=getattr(record, "created_by", None),
        updated_by=getattr(record, "updated_by", None),
        created_at=getattr(record, "created_at"),
        updated_at=getattr(record, "updated_at"),
    )


def owner_tenant_kwargs(ctx: OwnerContext) -> dict:
    return {
        "organization_id": ctx.organization_id,
        "workspace_id": ctx.workspace_id,
        "created_by": ctx.created_by,
        "updated_by": ctx.updated_by,
    }
