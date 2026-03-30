"""组织账务与平台计费配置路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..application.services import BillingError, BillingService, TenantAdminService
from ..auth.dependencies import RequestContext, get_request_context, require_platform_role
from ..common import signed_response
from ..common.log import get_logger
from ..schemas.requests import (
    CreateManualRechargeRequest,
    UpsertBillingPricingRuleRequest,
    UpsertBillingRechargeBonusRuleRequest,
)


router = APIRouter()
logger = get_logger(__name__)
billing_service = BillingService()
tenant_admin_service = TenantAdminService()


def _raise_billing_http_error(exc: Exception) -> None:
    message = str(exc)
    lowered = message.lower()
    if "insufficient" in lowered:
        raise HTTPException(status_code=402, detail=message)
    if "not found" in lowered:
        raise HTTPException(status_code=404, detail=message)
    raise HTTPException(status_code=400, detail=message)


@router.get("/billing/account")
async def get_current_billing_account(context: RequestContext = Depends(get_request_context)):
    """读取当前组织账本摘要。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    return signed_response(billing_service.get_account(context.current_organization_id))


@router.get("/billing/transactions")
async def list_current_billing_transactions(
    transaction_type: str | None = Query(default=None),
    direction: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    context: RequestContext = Depends(get_request_context),
):
    """分页读取当前组织账务流水。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    return signed_response(
        billing_service.list_transactions(
            context.current_organization_id,
            transaction_type=transaction_type,
            direction=direction,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/admin/billing/accounts", dependencies=[Depends(require_platform_role)])
async def list_billing_accounts():
    """列出全部组织账本。"""
    return signed_response(tenant_admin_service.list_billing_accounts())


@router.get("/admin/billing/pricing-rules", dependencies=[Depends(require_platform_role)])
async def list_billing_pricing_rules():
    """列出全部任务计费规则。"""
    return signed_response(tenant_admin_service.list_billing_pricing_rules())


@router.post("/admin/billing/pricing-rules", dependencies=[Depends(require_platform_role)])
async def upsert_billing_pricing_rule(
    request: UpsertBillingPricingRuleRequest,
    context: RequestContext = Depends(get_request_context),
):
    """创建或更新任务计费规则。"""
    try:
        return signed_response(
            tenant_admin_service.upsert_billing_pricing_rule(
                request.model_dump(),
                actor_id=context.user.id,
            )
        )
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/admin/billing/recharge-bonus-rules", dependencies=[Depends(require_platform_role)])
async def list_billing_recharge_bonus_rules():
    """列出全部充值赠送规则。"""
    return signed_response(tenant_admin_service.list_billing_recharge_bonus_rules())


@router.post("/admin/billing/recharge-bonus-rules", dependencies=[Depends(require_platform_role)])
async def upsert_billing_recharge_bonus_rule(
    request: UpsertBillingRechargeBonusRuleRequest,
    context: RequestContext = Depends(get_request_context),
):
    """创建或更新充值赠送规则。"""
    try:
        return signed_response(
            tenant_admin_service.upsert_billing_recharge_bonus_rule(
                request.model_dump(),
                actor_id=context.user.id,
            )
        )
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.post("/admin/billing/recharges/manual", dependencies=[Depends(require_platform_role)])
async def create_manual_recharge(
    request: CreateManualRechargeRequest,
    context: RequestContext = Depends(get_request_context),
):
    """给指定组织手工充值并自动套用赠送规则。"""
    try:
        return signed_response(
            tenant_admin_service.manual_recharge_billing_account(
                request.model_dump(),
                actor_id=context.user.id,
            )
        )
    except (ValueError, BillingError) as exc:
        _raise_billing_http_error(exc)
