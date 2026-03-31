"""组织级算力豆计费服务。"""

from __future__ import annotations

import uuid

from sqlalchemy.exc import IntegrityError

from ...common.log import get_logger
from ...db.session import session_scope
from ...repository import (
    BillingAccountRepository,
    BillingPricingRuleRepository,
    BillingRechargeBonusRuleRepository,
    BillingTransactionRepository,
    OrganizationRepository,
)
from ...schemas.models import BillingAccount, BillingPricingRule, BillingRechargeBonusRule, BillingTransaction
from ...schemas.task_models import TaskJob
from ...utils.datetime import utc_now


logger = get_logger(__name__)

BASE_CREDITS_PER_CNY = 10
CENTS_PER_CNY = 100


class BillingError(ValueError):
    """计费域统一异常基类。"""


class BillingInsufficientBalanceError(BillingError):
    """余额不足。"""


class BillingPricingNotConfiguredError(BillingError):
    """未配置任务价格。"""


class BillingAccountUnavailableError(BillingError):
    """账本不可用。"""


class BillingService:
    """统一处理余额、流水、价格和充值赠送规则。"""

    def __init__(self):
        self.organization_repository = OrganizationRepository()
        self.account_repository = BillingAccountRepository()
        self.transaction_repository = BillingTransactionRepository()
        self.pricing_repository = BillingPricingRuleRepository()
        self.recharge_bonus_repository = BillingRechargeBonusRuleRepository()

    def get_account(self, organization_id: str) -> BillingAccount:
        account = self.account_repository.get_by_organization(organization_id)
        if account is None:
            account = self.ensure_account(organization_id=organization_id)
        return account

    def ensure_account(
        self,
        *,
        organization_id: str,
        workspace_id: str | None = None,
        billing_email: str | None = None,
        actor_id: str | None = None,
        session=None,
    ) -> BillingAccount:
        existing = self.account_repository.get_by_organization(organization_id)
        if existing is not None:
            return existing
        organization = self.organization_repository.get(organization_id)
        if organization is None:
            raise ValueError("Organization not found")
        now = utc_now()
        account = BillingAccount(
            id=f"ba_{uuid.uuid4().hex[:16]}",
            organization_id=organization_id,
            workspace_id=workspace_id,
            owner_type="organization",
            owner_id=organization_id,
            status="active",
            currency="CNY",
            billing_email=billing_email,
            billing_metadata={},
            created_at=now,
            updated_at=now,
        )
        try:
            return self.account_repository.create(account, session=session)
        except IntegrityError:
            # 中文注释：多实例下两个请求可能同时给同一组织补首个账本，唯一约束兜底后直接回读即可。
            logger.info("BILLING_SERVICE: ensure_account raced on organization_id=%s, reading existing account", organization_id)
            existing = self.account_repository.get_by_organization(organization_id)
            if existing is None:
                raise
            return existing

    def list_transactions(
        self,
        organization_id: str,
        *,
        transaction_type: str | None = None,
        direction: str | None = None,
        operator_user_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BillingTransaction]:
        return self.transaction_repository.list_by_organization(
            organization_id,
            transaction_type=transaction_type,
            direction=direction,
            operator_user_id=operator_user_id,
            limit=limit,
            offset=offset,
        )

    def list_pricing_rules(self) -> list[BillingPricingRule]:
        return self.pricing_repository.list()

    def list_active_pricing_rules(self, organization_id: str | None = None) -> list[BillingPricingRule]:
        return self.pricing_repository.list_active_rules(organization_id=organization_id)

    def upsert_pricing_rule(
        self,
        *,
        task_type: str,
        price_credits: int,
        organization_id: str | None = None,
        actor_id: str | None = None,
        status: str = "active",
        description: str | None = None,
    ) -> BillingPricingRule:
        return self.pricing_repository.upsert(
            task_type=task_type,
            price_credits=price_credits,
            organization_id=organization_id,
            actor_id=actor_id,
            status=status,
            description=description,
        )

    def list_recharge_bonus_rules(self) -> list[BillingRechargeBonusRule]:
        return self.recharge_bonus_repository.list()

    def upsert_recharge_bonus_rule(
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
        return self.recharge_bonus_repository.upsert(
            min_recharge_cents=min_recharge_cents,
            max_recharge_cents=max_recharge_cents,
            bonus_credits=bonus_credits,
            organization_id=organization_id,
            actor_id=actor_id,
            status=status,
            description=description,
        )

    def manual_recharge(
        self,
        *,
        organization_id: str,
        amount_cents: int,
        workspace_id: str | None = None,
        actor_id: str | None = None,
        remark: str | None = None,
        billing_email: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        if amount_cents <= 0:
            raise ValueError("Recharge amount must be positive")
        if idempotency_key:
            existing = self.transaction_repository.get_by_idempotency_key(f"recharge:{idempotency_key}:base")
            if existing is not None:
                account = self.get_account(organization_id)
                bonus_rule = self.recharge_bonus_repository.get_applicable_rule(amount_cents, organization_id=organization_id)
                return {
                    "organization_id": organization_id,
                    "account": account,
                    "base_credits": self._base_credits_from_cents(amount_cents),
                    "bonus_credits": bonus_rule.bonus_credits if bonus_rule else 0,
                }
        with session_scope() as session:
            account_record = self._lock_account(
                organization_id=organization_id,
                workspace_id=workspace_id,
                actor_id=actor_id,
                billing_email=billing_email,
                session=session,
            )
            if account_record.status != "active":
                raise BillingAccountUnavailableError("Billing account is not active")
            now = utc_now()
            base_credits = self._base_credits_from_cents(amount_cents)
            bonus_rule = self.recharge_bonus_repository.get_applicable_rule(amount_cents, organization_id=organization_id)
            bonus_credits = bonus_rule.bonus_credits if bonus_rule else 0
            balance_before = account_record.balance_credits
            balance_after = balance_before + base_credits + bonus_credits
            account_record.balance_credits = balance_after
            account_record.total_recharged_cents += amount_cents
            account_record.total_credited += base_credits + bonus_credits
            account_record.total_bonus_credits += bonus_credits
            if billing_email and not account_record.billing_email:
                account_record.billing_email = billing_email
            account_record.updated_by = actor_id
            account_record.updated_at = now

            self.transaction_repository.create(
                BillingTransaction(
                    id=f"btx_{uuid.uuid4().hex[:16]}",
                    billing_account_id=account_record.id,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    transaction_type="recharge",
                    direction="credit",
                    amount_credits=base_credits,
                    balance_before=balance_before,
                    balance_after=balance_before + base_credits,
                    cash_amount_cents=amount_cents,
                    related_type="manual_recharge",
                    related_id=organization_id,
                    rule_snapshot_json={"exchange_rate": "1_cny=10_credits"},
                    remark=remark,
                    operator_user_id=actor_id,
                    operator_source="admin",
                    idempotency_key=f"recharge:{idempotency_key}:base" if idempotency_key else None,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
            if bonus_credits > 0:
                self.transaction_repository.create(
                    BillingTransaction(
                        id=f"btx_{uuid.uuid4().hex[:16]}",
                        billing_account_id=account_record.id,
                        organization_id=organization_id,
                        workspace_id=workspace_id,
                        transaction_type="bonus",
                        direction="credit",
                        amount_credits=bonus_credits,
                        balance_before=balance_before + base_credits,
                        balance_after=balance_after,
                        cash_amount_cents=amount_cents,
                        related_type="manual_recharge",
                        related_id=organization_id,
                        rule_snapshot_json=bonus_rule.model_dump(mode="json") if bonus_rule else {},
                        remark=remark,
                        operator_user_id=actor_id,
                        operator_source="admin",
                        idempotency_key=f"recharge:{idempotency_key}:bonus" if idempotency_key else None,
                        created_by=actor_id,
                        updated_by=actor_id,
                        created_at=now,
                        updated_at=now,
                    ),
                    session=session,
                )
            account = self.account_repository.update_record(account_record, {})
        logger.info(
            "BILLING_SERVICE: manual_recharge organization_id=%s amount_cents=%s base_credits=%s bonus_credits=%s balance_after=%s",
            organization_id,
            amount_cents,
            base_credits,
            bonus_credits,
            account.balance_credits,
        )
        return {
            "organization_id": organization_id,
            "account": account,
            "base_credits": base_credits,
            "bonus_credits": bonus_credits,
        }

    def charge_task_submission(
        self,
        *,
        job: TaskJob,
        actor_id: str | None = None,
        idempotency_key: str | None = None,
        session=None,
    ) -> BillingTransaction | None:
        if session is None:
            with session_scope() as owned_session:
                return self.charge_task_submission(
                    job=job,
                    actor_id=actor_id,
                    idempotency_key=idempotency_key,
                    session=owned_session,
                )
        if not job.organization_id:
            logger.info("BILLING_SERVICE: skip charge for job_id=%s because organization_id is missing", job.id)
            return None
        pricing_rule = self.pricing_repository.get_active_rule(job.task_type, organization_id=job.organization_id)
        if pricing_rule is None:
            raise BillingPricingNotConfiguredError(f"Billing pricing is not configured for task_type={job.task_type}")
        charge_amount = pricing_rule.price_credits
        if charge_amount < 0:
            raise ValueError(f"Billing pricing must be non-negative for task_type={job.task_type}")
        account_record = self._lock_account(
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            actor_id=actor_id,
            billing_email=None,
            session=session,
        )
        if account_record.status != "active":
            raise BillingAccountUnavailableError("Billing account is not active")
        # 中文注释：0 豆也是合法计费配置，只要价格不是负数，就应该允许 0 余额账户正常入队并写流水。
        if account_record.balance_credits < charge_amount:
            raise BillingInsufficientBalanceError("Current organization has insufficient credits for this task")
        if idempotency_key:
            existing = self.transaction_repository.get_by_idempotency_key(idempotency_key)
            if existing is not None:
                return existing
        now = utc_now()
        balance_before = account_record.balance_credits
        balance_after = balance_before - charge_amount
        account_record.balance_credits = balance_after
        account_record.total_consumed_credits += charge_amount
        account_record.updated_by = actor_id
        account_record.updated_at = now
        transaction = BillingTransaction(
            id=f"btx_{uuid.uuid4().hex[:16]}",
            billing_account_id=account_record.id,
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            transaction_type="task_debit",
            direction="debit",
            amount_credits=charge_amount,
            balance_before=balance_before,
            balance_after=balance_after,
            related_type="task_job",
            related_id=job.id,
            task_type=job.task_type,
            rule_snapshot_json=pricing_rule.model_dump(mode="json"),
            remark=f"Charge for task submission {job.task_type}",
            operator_user_id=actor_id,
            operator_source="system",
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        self.transaction_repository.create(transaction, session=session)
        logger.info(
            "BILLING_SERVICE: charge_task_submission organization_id=%s job_id=%s task_type=%s amount=%s balance_after=%s",
            job.organization_id,
            job.id,
            job.task_type,
            charge_amount,
            balance_after,
        )
        return transaction

    def _lock_account(
        self,
        *,
        organization_id: str,
        workspace_id: str | None,
        actor_id: str | None,
        billing_email: str | None,
        session,
    ):
        record = self.account_repository.get_by_organization_for_update(organization_id, session=session)
        if record is not None:
            return record
        account = self.ensure_account(
            organization_id=organization_id,
            workspace_id=workspace_id,
            billing_email=billing_email,
            actor_id=actor_id,
            session=session,
        )
        record = self.account_repository.get_by_organization_for_update(organization_id, session=session)
        if record is None:
            raise BillingAccountUnavailableError("Billing account is unavailable")
        return record

    @staticmethod
    def _base_credits_from_cents(amount_cents: int) -> int:
        # 中文注释：1 元 = 10 豆，因此 1 分 = 0.1 豆；当前规则要求算力豆取整，所以这里用“分数值”直接对应豆数。
        return amount_cents * BASE_CREDITS_PER_CNY // CENTS_PER_CNY
