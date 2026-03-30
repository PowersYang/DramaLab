"""任务计费规则仓储。"""

from __future__ import annotations

from ..db.models import BillingPricingRuleRecord
from ..schemas.models import BillingPricingRule
from ..utils.datetime import utc_now
from .base import BaseRepository


def _to_domain(record: BillingPricingRuleRecord) -> BillingPricingRule:
    return BillingPricingRule(
        id=record.id,
        scope_type=record.scope_type,
        organization_id=record.organization_id,
        task_type=record.task_type,
        charge_mode=record.charge_mode,
        price_credits=record.price_credits,
        status=record.status,
        effective_from=record.effective_from,
        effective_to=record.effective_to,
        description=record.description,
        created_by=record.created_by,
        updated_by=record.updated_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


class BillingPricingRuleRepository(BaseRepository[BillingPricingRule]):
    """按任务类型读取当前生效计费规则。"""

    def list(self) -> list[BillingPricingRule]:
        with self._with_session() as session:
            rows = (
                session.query(BillingPricingRuleRecord)
                .order_by(BillingPricingRuleRecord.task_type.asc(), BillingPricingRuleRecord.effective_from.desc())
                .all()
            )
            return [_to_domain(row) for row in rows]

    def get_active_rule(self, task_type: str, organization_id: str | None = None, when=None) -> BillingPricingRule | None:
        current_time = when or utc_now()
        with self._with_session() as session:
            query = session.query(BillingPricingRuleRecord).filter(
                BillingPricingRuleRecord.task_type == task_type,
                BillingPricingRuleRecord.status == "active",
                BillingPricingRuleRecord.effective_from <= current_time,
            )
            query = query.filter(
                (BillingPricingRuleRecord.effective_to.is_(None)) | (BillingPricingRuleRecord.effective_to > current_time)
            )
            if organization_id:
                row = (
                    query.filter(
                        BillingPricingRuleRecord.scope_type == "organization",
                        BillingPricingRuleRecord.organization_id == organization_id,
                    )
                    .order_by(BillingPricingRuleRecord.effective_from.desc(), BillingPricingRuleRecord.created_at.desc())
                    .first()
                )
                if row:
                    return _to_domain(row)
            row = (
                query.filter(
                    BillingPricingRuleRecord.scope_type == "platform",
                    BillingPricingRuleRecord.organization_id.is_(None),
                )
                .order_by(BillingPricingRuleRecord.effective_from.desc(), BillingPricingRuleRecord.created_at.desc())
                .first()
            )
            return _to_domain(row) if row else None

    def upsert(
        self,
        *,
        task_type: str,
        price_credits: int,
        organization_id: str | None = None,
        actor_id: str | None = None,
        status: str = "active",
        description: str | None = None,
    ) -> BillingPricingRule:
        scope_type = "organization" if organization_id else "platform"
        with self._with_session() as session:
            record = (
                session.query(BillingPricingRuleRecord)
                .filter(
                    BillingPricingRuleRecord.scope_type == scope_type,
                    BillingPricingRuleRecord.organization_id == organization_id,
                    BillingPricingRuleRecord.task_type == task_type,
                    BillingPricingRuleRecord.effective_to.is_(None),
                )
                .order_by(BillingPricingRuleRecord.effective_from.desc())
                .first()
            )
            now = utc_now()
            if record is None:
                record = BillingPricingRuleRecord(
                    id=f"bpr_{scope_type}_{(organization_id or 'platform')}_{task_type}".replace(".", "_"),
                    scope_type=scope_type,
                    organization_id=organization_id,
                    task_type=task_type,
                    charge_mode="fixed",
                    price_credits=price_credits,
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
                record.price_credits = price_credits
                record.status = status
                record.description = description
                record.updated_by = actor_id
                record.updated_at = now
            return _to_domain(record)

    def list_map(self):
        return {item.id: item for item in self.list()}

    def sync(self, items):
        raise NotImplementedError("BillingPricingRuleRepository does not support bulk sync")
