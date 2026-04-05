"""组织级算力豆计费服务。"""

from __future__ import annotations

import math
import hashlib
import json
import uuid

from sqlalchemy.exc import IntegrityError

from ...common.log import get_logger
from ...db.session import session_scope
from ...repository import (
    BillingAccountRepository,
    BillingChargeRepository,
    BillingPricingRuleRepository,
    BillingRechargeBonusRuleRepository,
    BillingTransactionRepository,
    OrganizationRepository,
)
from ...schemas.models import BillingAccount, BillingCharge, BillingPricingRule, BillingRechargeBonusRule, BillingTransaction
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
        self.charge_repository = BillingChargeRepository()
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

    def list_charges(
        self,
        organization_id: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        status: str | None = None,
        task_type: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BillingCharge]:
        return self.charge_repository.list_by_organization(
            organization_id,
            project_id=project_id,
            job_id=job_id,
            status=status,
            task_type=task_type,
            limit=limit,
            offset=offset,
        )

    def get_charge(self, charge_id: str) -> BillingCharge | None:
        return self.charge_repository.get(charge_id)

    def adjust_charge(
        self,
        *,
        charge_id: str,
        direction: str,
        amount_credits: int,
        reason: str,
        remark: str | None = None,
        actor_id: str | None = None,
        idempotency_key: str | None = None,
        session=None,
    ) -> BillingCharge:
        if amount_credits <= 0:
            raise ValueError("Adjustment amount must be positive")
        if direction not in {"credit", "debit"}:
            raise ValueError("Adjustment direction must be credit or debit")
        if session is None:
            with session_scope() as owned_session:
                return self.adjust_charge(
                    charge_id=charge_id,
                    direction=direction,
                    amount_credits=amount_credits,
                    reason=reason,
                    remark=remark,
                    actor_id=actor_id,
                    idempotency_key=idempotency_key,
                    session=owned_session,
                )

        charge = self.charge_repository.get(charge_id, session=session)
        if charge is None:
            raise ValueError(f"Billing charge {charge_id} not found")
        if not charge.organization_id:
            raise BillingAccountUnavailableError("Billing charge organization is missing")
        if idempotency_key:
            existing = self.transaction_repository.get_by_idempotency_key(idempotency_key, session=session)
            if existing is not None:
                current_charge = self.charge_repository.get(charge_id, session=session)
                if current_charge is None:
                    raise ValueError(f"Billing charge {charge_id} not found")
                return current_charge

        account_record = self._lock_account(
            organization_id=charge.organization_id,
            workspace_id=charge.workspace_id,
            actor_id=actor_id,
            billing_email=None,
            session=session,
        )
        now = utc_now()
        balance_before = account_record.balance_credits
        delta = amount_credits if direction == "credit" else -amount_credits
        balance_after = balance_before + delta
        if balance_after < 0:
            raise BillingInsufficientBalanceError("Current organization has insufficient credits for manual debit adjustment")
        account_record.balance_credits = balance_after
        if direction == "credit":
            account_record.total_consumed_credits = max(0, account_record.total_consumed_credits - amount_credits)
        else:
            account_record.total_consumed_credits += amount_credits
        account_record.updated_by = actor_id
        account_record.updated_at = now

        transaction_type = "manual_adjust_credit" if direction == "credit" else "manual_adjust_debit"
        transaction = BillingTransaction(
            id=f"btx_{uuid.uuid4().hex[:16]}",
            billing_account_id=account_record.id,
            organization_id=charge.organization_id,
            workspace_id=charge.workspace_id,
            transaction_type=transaction_type,
            direction=direction,
            amount_credits=amount_credits,
            balance_before=balance_before,
            balance_after=balance_after,
            related_type="billing_charge",
            related_id=charge.id,
            task_type=charge.task_type,
            rule_snapshot_json={"reason": reason},
            remark=remark,
            operator_user_id=actor_id,
            operator_source="admin",
            charge_id=charge.id,
            source_event="manual_adjust",
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        self.transaction_repository.create(transaction, session=session)

        updated_adjusted_credits = charge.adjusted_credits + (amount_credits if direction == "credit" else -amount_credits)
        return self.charge_repository.patch(
            charge.id,
            {
                "adjusted_credits": updated_adjusted_credits,
                "status": "adjusted",
                "settlement_reason": f"manual_adjust:{reason}",
                "updated_by": actor_id,
            },
            session=session,
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
        reserve_credits: int | None = None,
        minimum_credits: int = 0,
        charge_mode: str = "fixed",
        pricing_config_json: dict | None = None,
        usage_metric_key: str | None = None,
        organization_id: str | None = None,
        actor_id: str | None = None,
        status: str = "active",
        description: str | None = None,
    ) -> BillingPricingRule:
        return self.pricing_repository.upsert(
            task_type=task_type,
            price_credits=price_credits,
            reserve_credits=reserve_credits,
            minimum_credits=minimum_credits,
            charge_mode=charge_mode,
            pricing_config_json=pricing_config_json,
            usage_metric_key=usage_metric_key,
            organization_id=organization_id,
            actor_id=actor_id,
            status=status,
            description=description,
        )

    def list_recharge_bonus_rules(self) -> list[BillingRechargeBonusRule]:
        return self.recharge_bonus_repository.list()

    def preview_recharge(self, *, organization_id: str | None, amount_cents: int) -> dict:
        """预览指定金额的充值到账结果。"""
        if amount_cents <= 0:
            raise ValueError("Recharge amount must be positive")
        base_credits = self._base_credits_from_cents(amount_cents)
        bonus_rule = self.recharge_bonus_repository.get_applicable_rule(amount_cents, organization_id=organization_id)
        bonus_credits = bonus_rule.bonus_credits if bonus_rule else 0
        return {
            "amount_cents": amount_cents,
            "base_credits": base_credits,
            "bonus_credits": bonus_credits,
            "total_credits": base_credits + bonus_credits,
            "exchange_snapshot_json": {
                "currency": "CNY",
                "amount_cents": amount_cents,
                "exchange_rate": "1_cny=10_credits",
            },
            "bonus_rule_snapshot_json": bonus_rule.model_dump(mode="json") if bonus_rule else {},
        }

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
            return self._apply_recharge_credit(
                organization_id=organization_id,
                amount_cents=amount_cents,
                workspace_id=workspace_id,
                actor_id=actor_id,
                remark=remark,
                billing_email=billing_email,
                idempotency_prefix="recharge",
                related_type="manual_recharge",
                related_id=organization_id,
                operator_source="admin",
                idempotency_key=idempotency_key,
                session=session,
            )

    def apply_payment_recharge(
        self,
        *,
        payment_order_id: str,
        organization_id: str,
        amount_cents: int,
        workspace_id: str | None = None,
        actor_id: str | None = None,
        remark: str | None = None,
        billing_email: str | None = None,
        session=None,
    ) -> dict:
        """把已支付订单幂等入账到组织账本。"""
        if session is None:
            with session_scope() as owned_session:
                return self.apply_payment_recharge(
                    payment_order_id=payment_order_id,
                    organization_id=organization_id,
                    amount_cents=amount_cents,
                    workspace_id=workspace_id,
                    actor_id=actor_id,
                    remark=remark,
                    billing_email=billing_email,
                    session=owned_session,
                )
        return self._apply_recharge_credit(
            organization_id=organization_id,
            amount_cents=amount_cents,
            workspace_id=workspace_id,
            actor_id=actor_id,
            remark=remark,
            billing_email=billing_email,
            idempotency_prefix="payment",
            related_type="payment_order",
            related_id=payment_order_id,
            operator_source="payment_gateway",
            idempotency_key=payment_order_id,
            session=session,
        )

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
        if idempotency_key:
            existing = self.transaction_repository.get_by_idempotency_key(idempotency_key, session=session)
            if existing is not None:
                self._ensure_task_charge_from_existing_transaction(
                    job=job,
                    transaction=existing,
                    actor_id=actor_id,
                    idempotency_key=idempotency_key,
                    session=session,
                )
                return existing
        if not job.organization_id:
            logger.info("BILLING_SERVICE: skip charge for job_id=%s because organization_id is missing", job.id)
            return None
        pricing_rule = self.pricing_repository.get_active_rule(job.task_type, organization_id=job.organization_id)
        if pricing_rule is None:
            raise BillingPricingNotConfiguredError(f"Billing pricing is not configured for task_type={job.task_type}")
        if pricing_rule.charge_mode in {"usage", "hybrid"}:
            charge_amount = pricing_rule.reserve_credits
        else:
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
        try:
            self.transaction_repository.create(transaction, session=session)
        except IntegrityError:
            if idempotency_key:
                existing = self.transaction_repository.get_by_idempotency_key(idempotency_key, session=session)
                if existing is not None:
                    self._ensure_task_charge_from_existing_transaction(
                        job=job,
                        transaction=existing,
                        actor_id=actor_id,
                        idempotency_key=idempotency_key,
                        session=session,
                    )
                    return existing
            raise
        # 中文注释：计费单会通过 hold_transaction_id 外键关联这条预扣流水，
        # 所以要先把 billing_transactions flush 到数据库，再创建 billing_charges。
        session.flush()
        self._ensure_task_charge(
            job=job,
            billing_account_id=account_record.id,
            transaction=transaction,
            pricing_rule_snapshot=pricing_rule.model_dump(mode="json"),
            charge_amount=charge_amount,
            actor_id=actor_id,
            idempotency_key=idempotency_key,
            session=session,
        )
        logger.info(
            "BILLING_SERVICE: charge_task_submission organization_id=%s job_id=%s task_type=%s amount=%s balance_after=%s",
            job.organization_id,
            job.id,
            job.task_type,
            charge_amount,
            balance_after,
        )
        return transaction

    def settle_task_charge_for_completion(
        self,
        *,
        job: TaskJob,
        outcome_status: str,
        actor_id: str | None = None,
        session=None,
    ) -> BillingCharge | None:
        if session is None:
            with session_scope() as owned_session:
                return self.settle_task_charge_for_completion(
                    job=job,
                    outcome_status=outcome_status,
                    actor_id=actor_id,
                    session=owned_session,
                )
        charge = self.charge_repository.get_by_job_id(job.id, session=session)
        if charge is None:
            return None
        if charge.status in {"confirmed", "compensated", "adjusted"}:
            return charge

        if outcome_status == "succeeded":
            final_credits = charge.estimated_credits
            pricing_snapshot = charge.pricing_snapshot_json or {}
            aggregated_metrics = (charge.cost_snapshot_json or {}).get("aggregated") or {}
            usage_snapshot = aggregated_metrics.get("usage_totals") or {}
            cost_totals = aggregated_metrics.get("cost_totals") or {}
            if pricing_snapshot.get("charge_mode") in {"usage", "hybrid"}:
                cost_snapshot = {}
                if isinstance(cost_totals, dict) and len(cost_totals) == 1:
                    currency, amount = next(iter(cost_totals.items()))
                    cost_snapshot = {"currency": currency, "amount": amount}
                final_credits = self.calculate_usage_credits(
                    pricing_rule_snapshot=pricing_snapshot,
                    usage_snapshot=usage_snapshot,
                    cost_snapshot=cost_snapshot,
                )

            patch = {
                "status": "confirmed",
                "final_credits": final_credits,
                "settled_credits": final_credits,
                "usage_snapshot_json": usage_snapshot,
                "settlement_reason": "job_succeeded",
                "settled_at": utc_now(),
                "updated_by": actor_id,
            }

            refund_amount = max(charge.estimated_credits - final_credits, 0)
            if refund_amount > 0 and job.organization_id:
                account_record = self._lock_account(
                    organization_id=job.organization_id,
                    workspace_id=job.workspace_id,
                    actor_id=actor_id,
                    billing_email=None,
                    session=session,
                )
                now = utc_now()
                balance_before = account_record.balance_credits
                balance_after = balance_before + refund_amount
                account_record.balance_credits = balance_after
                account_record.total_consumed_credits = max(0, account_record.total_consumed_credits - refund_amount)
                account_record.updated_by = actor_id
                account_record.updated_at = now
                refund_txn = BillingTransaction(
                    id=f"btx_{uuid.uuid4().hex[:16]}",
                    billing_account_id=account_record.id,
                    organization_id=job.organization_id,
                    workspace_id=job.workspace_id,
                    transaction_type="refund",
                    direction="credit",
                    amount_credits=refund_amount,
                    balance_before=balance_before,
                    balance_after=balance_after,
                    related_type="task_job",
                    related_id=job.id,
                    task_type=job.task_type,
                    rule_snapshot_json=pricing_snapshot,
                    remark="Refund difference after usage settlement",
                    operator_user_id=actor_id,
                    operator_source="system",
                    idempotency_key=f"task_refund_success_delta:{job.id}",
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                try:
                    self.transaction_repository.create(refund_txn, session=session)
                except IntegrityError:
                    existing = self.transaction_repository.get_by_idempotency_key(
                        f"task_refund_success_delta:{job.id}",
                        session=session,
                    )
                    if existing is not None:
                        refund_txn = existing
                    else:
                        raise
                # 中文注释：结算成功后会把 refund_txn.id 回填到 charge.settle_transaction_id，
                # 这里先 flush 流水，避免同事务 update charge 时触发外键不可见。
                session.flush()
                patch["settle_transaction_id"] = refund_txn.id
                patch["refunded_credits"] = refund_amount

            return self.charge_repository.patch(charge.id, patch, session=session)

        if outcome_status in {"failed", "cancelled", "timed_out"}:
            if not job.organization_id:
                return self.charge_repository.patch(
                    charge.id,
                    {"status": "compensated", "final_credits": 0, "updated_by": actor_id},
                    session=session,
                )
            refund_amount = max(charge.estimated_credits, 0)
            if refund_amount == 0:
                return self.charge_repository.patch(
                    charge.id,
                    {"status": "compensated", "final_credits": 0, "updated_by": actor_id},
                    session=session,
                )

            account_record = self._lock_account(
                organization_id=job.organization_id,
                workspace_id=job.workspace_id,
                actor_id=actor_id,
                billing_email=None,
                session=session,
            )
            now = utc_now()
            balance_before = account_record.balance_credits
            balance_after = balance_before + refund_amount
            account_record.balance_credits = balance_after
            account_record.total_consumed_credits = max(0, account_record.total_consumed_credits - refund_amount)
            account_record.updated_by = actor_id
            account_record.updated_at = now
            refund_txn = BillingTransaction(
                id=f"btx_{uuid.uuid4().hex[:16]}",
                billing_account_id=account_record.id,
                organization_id=job.organization_id,
                workspace_id=job.workspace_id,
                transaction_type="refund",
                direction="credit",
                amount_credits=refund_amount,
                balance_before=balance_before,
                balance_after=balance_after,
                related_type="task_job",
                related_id=job.id,
                task_type=job.task_type,
                rule_snapshot_json=charge.pricing_snapshot_json,
                remark=f"Refund for task outcome {outcome_status}",
                operator_user_id=actor_id,
                operator_source="system",
                idempotency_key=f"task_refund:{job.id}",
                created_by=actor_id,
                updated_by=actor_id,
                created_at=now,
                updated_at=now,
            )
            try:
                self.transaction_repository.create(refund_txn, session=session)
            except IntegrityError:
                existing = self.transaction_repository.get_by_idempotency_key(f"task_refund:{job.id}", session=session)
                if existing is not None:
                    refund_txn = existing
                else:
                    raise
            # 中文注释：失败退款也会把 settle_transaction_id 指向新流水，
            # 先 flush refund_txn，确保随后更新 charge 时外键可见。
            session.flush()
            return self.charge_repository.patch(
                charge.id,
                {
                    "status": "compensated",
                    "final_credits": 0,
                    "settle_transaction_id": refund_txn.id,
                    "updated_by": actor_id,
                },
                session=session,
            )

        return charge

    def record_task_attempt_metrics(
        self,
        *,
        job_id: str,
        attempt_no: int,
        metrics_json: dict,
        actor_id: str | None = None,
        session=None,
    ) -> BillingCharge | None:
        if session is None:
            with session_scope() as owned_session:
                return self.record_task_attempt_metrics(
                    job_id=job_id,
                    attempt_no=attempt_no,
                    metrics_json=metrics_json,
                    actor_id=actor_id,
                    session=owned_session,
                )
        charge = self.charge_repository.get_by_job_id(job_id, session=session)
        if charge is None:
            return None
        existing = charge.cost_snapshot_json or {}
        attempts = list(existing.get("attempts") or [])
        attempts = [item for item in attempts if item.get("attempt_no") != attempt_no]
        attempts.append({"attempt_no": attempt_no, "metrics": metrics_json})
        attempts.sort(key=lambda item: int(item.get("attempt_no") or 0))
        aggregated = self._aggregate_attempt_metrics(attempts)
        return self.charge_repository.patch(
            charge.id,
            {
                "cost_snapshot_json": {
                    **existing,
                    "attempts": attempts,
                    "aggregated": aggregated,
                },
                "updated_by": actor_id,
            },
            session=session,
        )

    def calculate_usage_credits(
        self,
        *,
        pricing_rule_snapshot: dict,
        usage_snapshot: dict,
        cost_snapshot: dict,
    ) -> int:
        charge_mode = str(pricing_rule_snapshot.get("charge_mode") or "fixed")
        minimum_credits = max(0, int(pricing_rule_snapshot.get("minimum_credits") or 0))
        fixed_price = max(0, int(pricing_rule_snapshot.get("price_credits") or 0))
        pricing_config = pricing_rule_snapshot.get("pricing_config_json") or {}

        if charge_mode == "fixed":
            return max(fixed_price, minimum_credits)

        if charge_mode == "usage":
            usage_metric_key = str(pricing_rule_snapshot.get("usage_metric_key") or "").strip()
            metric_value = usage_snapshot.get(usage_metric_key) if usage_metric_key else 0
            if not isinstance(metric_value, (int, float)):
                metric_value = 0
            if usage_metric_key == "seconds":
                per_second_credits = float(pricing_config.get("per_second_credits") or 0)
                calculated = math.ceil(float(metric_value) * per_second_credits)
                return max(calculated, minimum_credits)

        # 中文注释：在完整 hybrid/按供应商成本倍率结算落地前，未知模式先保守回退到 fixed，避免出现负数或空结算。
        return max(fixed_price, minimum_credits)

    def reopen_task_charge_for_retry(self, *, job: TaskJob, actor_id: str | None = None, session=None) -> BillingCharge | None:
        if session is None:
            with session_scope() as owned_session:
                return self.reopen_task_charge_for_retry(job=job, actor_id=actor_id, session=owned_session)
        charge = self.charge_repository.get_by_job_id(job.id, session=session)
        if charge is None:
            return None
        if charge.status != "compensated":
            return charge
        if not job.organization_id:
            return charge
        hold_amount = max(charge.estimated_credits, 0)
        if hold_amount == 0:
            return self.charge_repository.patch(
                charge.id,
                {
                    "status": "held",
                    "final_credits": None,
                    "settle_transaction_id": None,
                    "updated_by": actor_id,
                },
                session=session,
            )

        account_record = self._lock_account(
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            actor_id=actor_id,
            billing_email=None,
            session=session,
        )
        if account_record.status != "active":
            raise BillingAccountUnavailableError("Billing account is not active")
        if account_record.balance_credits < hold_amount:
            raise BillingInsufficientBalanceError("Current organization has insufficient credits for this task")
        now = utc_now()
        balance_before = account_record.balance_credits
        balance_after = balance_before - hold_amount
        account_record.balance_credits = balance_after
        account_record.total_consumed_credits += hold_amount
        account_record.updated_by = actor_id
        account_record.updated_at = now
        txn_idempotency = f"task_retry_hold:{job.id}:{job.attempt_count + 1}"
        hold_txn = BillingTransaction(
            id=f"btx_{uuid.uuid4().hex[:16]}",
            billing_account_id=account_record.id,
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            transaction_type="task_debit",
            direction="debit",
            amount_credits=hold_amount,
            balance_before=balance_before,
            balance_after=balance_after,
            related_type="task_job",
            related_id=job.id,
            task_type=job.task_type,
            rule_snapshot_json=charge.pricing_snapshot_json,
            remark="Charge for task retry submission",
            operator_user_id=actor_id,
            operator_source="system",
            idempotency_key=txn_idempotency,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        try:
            self.transaction_repository.create(hold_txn, session=session)
        except IntegrityError:
            existing = self.transaction_repository.get_by_idempotency_key(txn_idempotency, session=session)
            if existing is not None:
                hold_txn = existing
            else:
                raise
        # 中文注释：重试重扣会把新预扣流水重新挂回 hold_transaction_id，
        # 先 flush 这条流水，再更新计费单，避免 PostgreSQL 外键校验失败。
        session.flush()
        return self.charge_repository.patch(
            charge.id,
            {
                "status": "held",
                "final_credits": None,
                "hold_transaction_id": hold_txn.id,
                "settle_transaction_id": None,
                "updated_by": actor_id,
            },
            session=session,
        )

    @staticmethod
    def _aggregate_attempt_metrics(attempt_entries: list[dict]) -> dict:
        totals: dict[str, int | float] = {}
        currency_totals: dict[str, float] = {}
        provider_names: set[str] = set()
        model_names: set[str] = set()
        metric_versions: set[str] = set()
        supplier_task_ids: set[str] = set()
        supplier_request_ids: set[str] = set()

        for entry in attempt_entries:
            metrics = entry.get("metrics") or {}
            metrics_version = metrics.get("version")
            if isinstance(metrics_version, str) and metrics_version:
                metric_versions.add(metrics_version)
            provider = metrics.get("provider") or {}
            provider_name = provider.get("name")
            if isinstance(provider_name, str) and provider_name:
                provider_names.add(provider_name)
            model = provider.get("model")
            if isinstance(model, str) and model:
                model_names.add(model)

            supplier_reference = metrics.get("supplier_reference") or {}
            if isinstance(supplier_reference, dict):
                task_id = supplier_reference.get("task_id")
                request_id = supplier_reference.get("request_id")
                if isinstance(task_id, str) and task_id:
                    supplier_task_ids.add(task_id)
                if isinstance(request_id, str) and request_id:
                    supplier_request_ids.add(request_id)

            usage = metrics.get("usage") or {}
            if isinstance(usage, dict):
                for key, value in usage.items():
                    if isinstance(value, (int, float)):
                        totals[key] = (totals.get(key, 0) or 0) + value

            cost = metrics.get("cost") or {}
            if isinstance(cost, dict):
                currency = cost.get("currency") or "UNKNOWN"
                amount = cost.get("amount")
                if isinstance(amount, (int, float)):
                    currency_totals[str(currency)] = currency_totals.get(str(currency), 0.0) + float(amount)

        return {
            "providers": sorted(provider_names),
            "models": sorted(model_names),
            "metric_versions": sorted(metric_versions),
            "supplier_task_ids": sorted(supplier_task_ids),
            "supplier_request_ids": sorted(supplier_request_ids),
            "usage_totals": totals,
            "cost_totals": currency_totals,
        }

    def _ensure_task_charge(
        self,
        *,
        job: TaskJob,
        billing_account_id: str,
        transaction: BillingTransaction,
        pricing_rule_snapshot: dict,
        charge_amount: int,
        actor_id: str | None,
        idempotency_key: str | None,
        session,
    ) -> BillingCharge:
        existing = self.charge_repository.get_by_job_id(job.id, session=session)
        if existing is not None:
            return existing
        now = utc_now()
        pricing_snapshot_serialized = json.dumps(pricing_rule_snapshot, sort_keys=True, ensure_ascii=True)
        pricing_version = hashlib.sha256(pricing_snapshot_serialized.encode("utf-8")).hexdigest()[:16]
        pricing_mode = str(pricing_rule_snapshot.get("charge_mode") or "fixed")
        charge = BillingCharge(
            id=f"bch_{uuid.uuid4().hex[:16]}",
            billing_account_id=billing_account_id,
            organization_id=job.organization_id,
            workspace_id=job.workspace_id,
            job_id=job.id,
            task_type=job.task_type,
            status="held",
            estimated_credits=charge_amount,
            final_credits=None,
            reserved_credits=charge_amount,
            settled_credits=None,
            refunded_credits=0,
            adjusted_credits=0,
            pricing_mode=pricing_mode,
            pricing_snapshot_json={
                "pricing_rule": pricing_rule_snapshot,
                "pricing_rule_id": pricing_rule_snapshot.get("id"),
                "effective_from": pricing_rule_snapshot.get("effective_from"),
                "charge_mode": pricing_mode,
                "estimated_credits": charge_amount,
                "price_credits": pricing_rule_snapshot.get("price_credits"),
                "reserve_credits": pricing_rule_snapshot.get("reserve_credits", charge_amount),
                "minimum_credits": pricing_rule_snapshot.get("minimum_credits", 0),
                "pricing_config_json": pricing_rule_snapshot.get("pricing_config_json") or {},
                "usage_metric_key": pricing_rule_snapshot.get("usage_metric_key"),
                "pricing_version": pricing_version,
            },
            cost_snapshot_json={},
            usage_snapshot_json={},
            settlement_reason=None,
            settled_at=None,
            reconciled_at=None,
            last_reconcile_error=None,
            version=1,
            hold_transaction_id=transaction.id,
            settle_transaction_id=None,
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        try:
            return self.charge_repository.create(charge, session=session)
        except IntegrityError:
            existing = self.charge_repository.get_by_job_id(job.id, session=session)
            if existing is None:
                raise
            return existing

    def _ensure_task_charge_from_existing_transaction(
        self,
        *,
        job: TaskJob,
        transaction: BillingTransaction,
        actor_id: str | None,
        idempotency_key: str | None,
        session,
    ) -> BillingCharge | None:
        existing = self.charge_repository.get_by_job_id(job.id, session=session)
        if existing is not None:
            return existing
        now = utc_now()
        charge = BillingCharge(
            id=f"bch_{uuid.uuid4().hex[:16]}",
            billing_account_id=transaction.billing_account_id,
            organization_id=transaction.organization_id or job.organization_id,
            workspace_id=transaction.workspace_id or job.workspace_id,
            job_id=job.id,
            task_type=transaction.task_type or job.task_type,
            status="held",
            estimated_credits=transaction.amount_credits,
            final_credits=None,
            reserved_credits=transaction.amount_credits,
            settled_credits=None,
            refunded_credits=0,
            adjusted_credits=0,
            pricing_mode=str((transaction.rule_snapshot_json or {}).get("charge_mode") or "fixed"),
            pricing_snapshot_json={
                "pricing_rule": transaction.rule_snapshot_json or {},
                "charge_mode": (transaction.rule_snapshot_json or {}).get("charge_mode") or "fixed",
                "estimated_credits": transaction.amount_credits,
                "price_credits": (transaction.rule_snapshot_json or {}).get("price_credits"),
                "reserve_credits": (transaction.rule_snapshot_json or {}).get("reserve_credits", transaction.amount_credits),
                "minimum_credits": (transaction.rule_snapshot_json or {}).get("minimum_credits", 0),
                "pricing_config_json": (transaction.rule_snapshot_json or {}).get("pricing_config_json") or {},
                "usage_metric_key": (transaction.rule_snapshot_json or {}).get("usage_metric_key"),
            },
            cost_snapshot_json={},
            usage_snapshot_json={},
            settlement_reason=None,
            settled_at=None,
            reconciled_at=None,
            last_reconcile_error=None,
            version=1,
            hold_transaction_id=transaction.id,
            settle_transaction_id=None,
            idempotency_key=idempotency_key,
            created_by=actor_id,
            updated_by=actor_id,
            created_at=now,
            updated_at=now,
        )
        try:
            return self.charge_repository.create(charge, session=session)
        except IntegrityError:
            existing = self.charge_repository.get_by_job_id(job.id, session=session)
            if existing is None:
                raise
            return existing

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

    def _apply_recharge_credit(
        self,
        *,
        organization_id: str,
        amount_cents: int,
        workspace_id: str | None,
        actor_id: str | None,
        remark: str | None,
        billing_email: str | None,
        idempotency_prefix: str,
        related_type: str,
        related_id: str,
        operator_source: str,
        idempotency_key: str | None,
        session,
    ) -> dict:
        """统一处理充值型入账，供手工充值与支付到账复用。"""
        account_record = self._lock_account(
            organization_id=organization_id,
            workspace_id=workspace_id,
            actor_id=actor_id,
            billing_email=billing_email,
            session=session,
        )
        if account_record.status != "active":
            raise BillingAccountUnavailableError("Billing account is not active")

        preview = self.preview_recharge(organization_id=organization_id, amount_cents=amount_cents)
        now = utc_now()
        balance_before = account_record.balance_credits
        balance_after = balance_before + preview["total_credits"]
        account_record.balance_credits = balance_after
        account_record.total_recharged_cents += amount_cents
        account_record.total_credited += preview["total_credits"]
        account_record.total_bonus_credits += preview["bonus_credits"]
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
                amount_credits=preview["base_credits"],
                balance_before=balance_before,
                balance_after=balance_before + preview["base_credits"],
                cash_amount_cents=amount_cents,
                related_type=related_type,
                related_id=related_id,
                rule_snapshot_json=preview["exchange_snapshot_json"],
                remark=remark,
                operator_user_id=actor_id,
                operator_source=operator_source,
                external_ref=related_id if related_type == "payment_order" else None,
                idempotency_key=f"{idempotency_prefix}:{idempotency_key}:base" if idempotency_key else None,
                created_by=actor_id,
                updated_by=actor_id,
                created_at=now,
                updated_at=now,
            ),
            session=session,
        )
        if preview["bonus_credits"] > 0:
            self.transaction_repository.create(
                BillingTransaction(
                    id=f"btx_{uuid.uuid4().hex[:16]}",
                    billing_account_id=account_record.id,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    transaction_type="bonus",
                    direction="credit",
                    amount_credits=preview["bonus_credits"],
                    balance_before=balance_before + preview["base_credits"],
                    balance_after=balance_after,
                    cash_amount_cents=amount_cents,
                    related_type=related_type,
                    related_id=related_id,
                    rule_snapshot_json=preview["bonus_rule_snapshot_json"],
                    remark=remark,
                    operator_user_id=actor_id,
                    operator_source=operator_source,
                    external_ref=related_id if related_type == "payment_order" else None,
                    idempotency_key=f"{idempotency_prefix}:{idempotency_key}:bonus" if idempotency_key else None,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                ),
                session=session,
            )
        account = self.account_repository.update_record(account_record, {})
        logger.info(
            "BILLING_SERVICE: recharge_credit organization_id=%s related_type=%s related_id=%s amount_cents=%s total_credits=%s balance_after=%s",
            organization_id,
            related_type,
            related_id,
            amount_cents,
            preview["total_credits"],
            account.balance_credits,
        )
        return {
            "organization_id": organization_id,
            "account": account,
            "base_credits": preview["base_credits"],
            "bonus_credits": preview["bonus_credits"],
            "total_credits": preview["total_credits"],
            "exchange_snapshot_json": preview["exchange_snapshot_json"],
            "bonus_rule_snapshot_json": preview["bonus_rule_snapshot_json"],
        }

    @staticmethod
    def _base_credits_from_cents(amount_cents: int) -> int:
        # 中文注释：1 元 = 10 豆，因此 1 分 = 0.1 豆；当前规则要求算力豆取整，所以这里用“分数值”直接对应豆数。
        return amount_cents * BASE_CREDITS_PER_CNY // CENTS_PER_CNY
