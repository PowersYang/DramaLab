"""组织级账本仓储。"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

from ..db.models import BillingAccountRecord
from ..schemas.models import BillingAccount
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: BillingAccountRecord) -> BillingAccount:
    return BillingAccount(
        id=record.id,
        organization_id=record.organization_id,
        workspace_id=record.workspace_id,
        owner_type=record.owner_type,
        owner_id=record.owner_id,
        status=record.status,
        currency=record.currency,
        balance_credits=record.balance_credits,
        total_recharged_cents=record.total_recharged_cents,
        total_credited=record.total_credited,
        total_bonus_credits=record.total_bonus_credits,
        total_consumed_credits=record.total_consumed_credits,
        pricing_version=record.pricing_version,
        billing_email=record.billing_email,
        billing_metadata=record.billing_metadata or {},
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingAccountRepository(BaseRepository[BillingAccount]):
    """账本主表；扣费和充值都必须先锁这张表。"""

    def get_by_organization(self, organization_id: str) -> BillingAccount | None:
        with self._with_session() as session:
            record = (
                session.query(BillingAccountRecord)
                .filter(BillingAccountRecord.organization_id == organization_id)
                .one_or_none()
            )
            return _to_domain(record) if record else None

    def get_by_organization_for_update(self, organization_id: str, session) -> BillingAccountRecord | None:
        query = session.query(BillingAccountRecord).filter(BillingAccountRecord.organization_id == organization_id)
        if session.bind and session.bind.dialect.name == "postgresql":
            query = query.with_for_update()
        return query.one_or_none()

    def create(self, account: BillingAccount, session=None) -> BillingAccount:
        with self._with_session(session) as current_session:
            record = BillingAccountRecord(
                id=account.id,
                organization_id=account.organization_id,
                workspace_id=account.workspace_id,
                owner_type=account.owner_type,
                owner_id=account.owner_id,
                status=account.status,
                currency=account.currency,
                balance_credits=account.balance_credits,
                total_recharged_cents=account.total_recharged_cents,
                total_credited=account.total_credited,
                total_bonus_credits=account.total_bonus_credits,
                total_consumed_credits=account.total_consumed_credits,
                pricing_version=account.pricing_version,
                billing_email=account.billing_email,
                billing_metadata=account.billing_metadata,
                created_at=account.created_at,
                updated_at=account.updated_at,
            )
            current_session.add(record)
            try:
                current_session.flush()
            except IntegrityError:
                raise
        return account

    def save(self, account: BillingAccount, session=None) -> BillingAccount:
        return self.create(account, session=session)

    def list(self) -> list[BillingAccount]:
        with self._with_session() as session:
            records = (
                session.query(BillingAccountRecord)
                .order_by(BillingAccountRecord.updated_at.desc(), BillingAccountRecord.created_at.desc())
                .all()
            )
            return [_to_domain(record) for record in records]

    def update_record(self, record: BillingAccountRecord, patch: dict) -> BillingAccount:
        for key, value in patch.items():
            if hasattr(record, key):
                setattr(record, key, value)
        record.updated_at = utc_now()
        return _to_domain(record)

    def list_map(self):
        return {item.id: item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("BillingAccountRepository does not support bulk sync")
