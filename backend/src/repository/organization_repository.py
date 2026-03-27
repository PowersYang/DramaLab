"""组织仓储。"""

from typing import List

from ..db.models import BillingAccountRecord, MembershipRecord, OrganizationRecord, SeriesRecord, ProjectRecord, WorkspaceRecord
from ..utils.datetime import utc_now
from .base import BaseRepository
from ..schemas.models import Organization


def _to_organization(record: OrganizationRecord) -> Organization:
    """把 ORM 记录转换为领域模型。"""
    return Organization(
        id=record.id,
        name=record.name,
        slug=record.slug,
        status=record.status,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class OrganizationRepository(BaseRepository[Organization]):
    """组织表的基础 CRUD 与依赖检查。"""

    def list(self) -> List[Organization]:
        with self._with_session() as session:
            records = session.query(OrganizationRecord).order_by(OrganizationRecord.created_at.desc()).all()
            return [_to_organization(record) for record in records]

    def get(self, organization_id: str) -> Organization | None:
        with self._with_session() as session:
            record = session.get(OrganizationRecord, organization_id)
            return _to_organization(record) if record else None

    def get_by_slug(self, slug: str) -> Organization | None:
        with self._with_session() as session:
            record = session.query(OrganizationRecord).filter(OrganizationRecord.slug == slug).one_or_none()
            return _to_organization(record) if record else None

    def create(self, organization: Organization) -> Organization:
        with self._with_session() as session:
            session.add(
                OrganizationRecord(
                    id=organization.id,
                    name=organization.name,
                    slug=organization.slug,
                    status=organization.status,
                    created_at=organization.created_at,
                    updated_at=organization.updated_at,
                )
            )
        return organization

    def update(self, organization_id: str, patch: dict) -> Organization:
        with self._with_session() as session:
            record = session.get(OrganizationRecord, organization_id)
            if record is None:
                raise ValueError(f"Organization {organization_id} not found")
            for key, value in patch.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = utc_now()
            return _to_organization(record)

    def delete(self, organization_id: str) -> None:
        with self._with_session() as session:
            record = session.get(OrganizationRecord, organization_id)
            if record is None:
                raise ValueError(f"Organization {organization_id} not found")
            session.delete(record)

    def has_dependents(self, organization_id: str) -> bool:
        """删除组织前，先确认没有明显的下游依赖。"""
        with self._with_session() as session:
            checks = [
                session.query(WorkspaceRecord.id).filter(WorkspaceRecord.organization_id == organization_id).first(),
                session.query(MembershipRecord.id).filter(MembershipRecord.organization_id == organization_id).first(),
                session.query(BillingAccountRecord.id).filter(BillingAccountRecord.organization_id == organization_id).first(),
                session.query(ProjectRecord.id).filter(ProjectRecord.organization_id == organization_id, ProjectRecord.is_deleted.is_(False)).first(),
                session.query(SeriesRecord.id).filter(SeriesRecord.organization_id == organization_id, SeriesRecord.is_deleted.is_(False)).first(),
            ]
            return any(item is not None for item in checks)

    def list_map(self):
        return {organization.id: organization for organization in self.list()}

    def sync(self, items):
        raise NotImplementedError("OrganizationRepository does not support bulk sync")
