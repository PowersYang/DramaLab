"""充值赠送规则仓储。"""

from __future__ import annotations

from ..db.models import BillingRechargeBonusRuleRecord
from ..schemas.models import BillingRechargeBonusRule
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: BillingRechargeBonusRuleRecord) -> BillingRechargeBonusRule:
    return BillingRechargeBonusRule(
        id=record.id,
        scope_type=record.scope_type,
        organization_id=record.organization_id,
        min_recharge_cents=record.min_recharge_cents,
        max_recharge_cents=record.max_recharge_cents,
        bonus_credits=record.bonus_credits,
        status=record.status,
        effective_from=record.effective_from,
        effective_to=record.effective_to,
        description=record.description,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingRechargeBonusRuleRepository(BaseRepository[BillingRechargeBonusRule]):
    """按充值金额匹配赠送豆规则。"""

    def list(self) -> list[BillingRechargeBonusRule]:
        with self._with_session() as session:
            rows = (
                session.query(BillingRechargeBonusRuleRecord)
                .order_by(BillingRechargeBonusRuleRecord.min_recharge_cents.asc(), BillingRechargeBonusRuleRecord.effective_from.desc())
                .all()
            )
            return [_to_domain(row) for row in rows]

    def get_applicable_rule(self, amount_cents: int, organization_id: str | None = None, when=None) -> BillingRechargeBonusRule | None:
        current_time = when or utc_now()
        with self._with_session() as session:
            query = session.query(BillingRechargeBonusRuleRecord).filter(
                BillingRechargeBonusRuleRecord.status == "active",
                BillingRechargeBonusRuleRecord.effective_from <= current_time,
                BillingRechargeBonusRuleRecord.min_recharge_cents <= amount_cents,
            )
            query = query.filter(
                ((BillingRechargeBonusRuleRecord.max_recharge_cents.is_(None)) | (BillingRechargeBonusRuleRecord.max_recharge_cents >= amount_cents)),
                ((BillingRechargeBonusRuleRecord.effective_to.is_(None)) | (BillingRechargeBonusRuleRecord.effective_to > current_time)),
            )
            if organization_id:
                row = (
                    query.filter(
                        BillingRechargeBonusRuleRecord.scope_type == "organization",
                        BillingRechargeBonusRuleRecord.organization_id == organization_id,
                    )
                    .order_by(BillingRechargeBonusRuleRecord.min_recharge_cents.desc(), BillingRechargeBonusRuleRecord.created_at.desc())
                    .first()
                )
                if row:
                    return _to_domain(row)
            row = (
                query.filter(
                    BillingRechargeBonusRuleRecord.scope_type == "platform",
                    BillingRechargeBonusRuleRecord.organization_id.is_(None),
                )
                .order_by(BillingRechargeBonusRuleRecord.min_recharge_cents.desc(), BillingRechargeBonusRuleRecord.created_at.desc())
                .first()
            )
            return _to_domain(row) if row else None

    def upsert(
        self,
        *,
        min_recharge_cents: int,
        max_recharge_cents: int | None,
        bonus_credits: int,
        organization_id: str | None = None,
        actor_id: str | None = None,
        status: str = "active",
        description: str | None = None,
    ) -> BillingRechargeBonusRule:
        scope_type = "organization" if organization_id else "platform"
        with self._with_session() as session:
            record = (
                session.query(BillingRechargeBonusRuleRecord)
                .filter(
                    BillingRechargeBonusRuleRecord.scope_type == scope_type,
                    BillingRechargeBonusRuleRecord.organization_id == organization_id,
                    BillingRechargeBonusRuleRecord.min_recharge_cents == min_recharge_cents,
                    BillingRechargeBonusRuleRecord.effective_to.is_(None),
                )
                .order_by(BillingRechargeBonusRuleRecord.effective_from.desc())
                .first()
            )
            now = utc_now()
            if record is None:
                record = BillingRechargeBonusRuleRecord(
                    id=f"brr_{scope_type}_{(organization_id or 'platform')}_{min_recharge_cents}",
                    scope_type=scope_type,
                    organization_id=organization_id,
                    min_recharge_cents=min_recharge_cents,
                    max_recharge_cents=max_recharge_cents,
                    bonus_credits=bonus_credits,
                    status=status,
                    effective_from=now,
                    effective_to=None,
                    description=description,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(record)
            else:
                record.max_recharge_cents = max_recharge_cents
                record.bonus_credits = bonus_credits
                record.status = status
                record.description = description
                record.updated_by = actor_id
                record.updated_at = now
            return _to_domain(record)

    def list_map(self):
        return {item.id: item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("BillingRechargeBonusRuleRepository does not support bulk sync")
