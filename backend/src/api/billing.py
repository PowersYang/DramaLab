"""组织账务与平台计费配置路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from ..application.services import BillingError, BillingReconcileService, BillingService, PaymentError, PaymentService, TenantAdminService
from ..auth.constants import ROLE_PLATFORM_SUPER_ADMIN
from ..auth.dependencies import RequestContext, get_request_context, require_platform_role
from ..common import signed_response
from ..common.log import get_logger
from ..repository import UserRepository
from ..schemas.requests import (
    CreateManualRechargeRequest,
    CreatePaymentOrderRequest,
    ManualAdjustBillingChargeRequest,
    RunBillingReconcileRequest,
    SimulatePaymentOrderPaidRequest,
    UpsertBillingPricingRuleRequest,
    UpsertBillingRechargeBonusRuleRequest,
)


router = APIRouter()
logger = get_logger(__name__)
billing_service = BillingService()
billing_reconcile_service = BillingReconcileService()
tenant_admin_service = TenantAdminService()
user_repository = UserRepository()
payment_service = PaymentService()


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
    can_view_all_transactions = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    return signed_response(
        billing_service.list_transactions(
            context.current_organization_id,
            transaction_type=transaction_type if can_view_all_transactions else "task_debit",
            direction=direction if can_view_all_transactions else "debit",
            operator_user_id=None if can_view_all_transactions else context.user.id,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/billing/pricing-rules")
async def list_current_billing_pricing_rules(context: RequestContext = Depends(get_request_context)):
    """读取当前组织可见的生效计费规则。"""
    return signed_response(billing_service.list_active_pricing_rules(context.current_organization_id))


@router.get("/billing/payment-orders")
async def list_current_payment_orders(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: RequestContext = Depends(get_request_context),
):
    """分页读取当前组织下的在线支付订单。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    can_view_all_orders = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    return signed_response(
        payment_service.list_orders(
            context.current_organization_id,
            user_id=None if can_view_all_orders else context.user.id,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/billing/payment-orders/{order_id}")
async def get_current_payment_order(
    order_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """读取当前组织的单个支付订单。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    order = payment_service.get_order(order_id)
    if order is None or order.organization_id != context.current_organization_id:
        raise HTTPException(status_code=404, detail="Payment order not found")
    can_view_all_orders = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    if not can_view_all_orders and order.user_id not in {None, context.user.id}:
        raise HTTPException(status_code=404, detail="Payment order not found")
    return signed_response(order)


@router.get("/billing/payment-orders/{order_id}/events")
async def list_current_payment_order_events(
    order_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """读取当前组织下某个支付订单的状态时间线。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    order = payment_service.get_order(order_id)
    if order is None or order.organization_id != context.current_organization_id:
        raise HTTPException(status_code=404, detail="Payment order not found")
    can_view_all_orders = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    if not can_view_all_orders and order.user_id not in {None, context.user.id}:
        raise HTTPException(status_code=404, detail="Payment order not found")
    return signed_response(payment_service.list_order_events(order_id))


@router.post("/billing/payment-orders")
async def create_current_payment_order(
    request: CreatePaymentOrderRequest,
    context: RequestContext = Depends(get_request_context),
):
    """为当前组织创建一个 PC 扫码支付订单。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    try:
        return signed_response(
            payment_service.create_payment_order(
                organization_id=context.current_organization_id,
                workspace_id=context.current_workspace_id,
                user_id=context.user.id,
                channel=request.channel,
                amount_cents=request.amount_cents,
                subject=request.subject,
                description=request.description,
                actor_id=context.user.id,
                idempotency_key=request.idempotency_key,
            )
        )
    except (ValueError, BillingError, PaymentError) as exc:
        _raise_billing_http_error(exc)


@router.post("/billing/payment-orders/{order_id}/cancel")
async def cancel_current_payment_order(
    order_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """取消当前组织下仍处于待支付态的订单。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    order = payment_service.get_order(order_id)
    if order is None or order.organization_id != context.current_organization_id:
        raise HTTPException(status_code=404, detail="Payment order not found")
    can_view_all_orders = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    if not can_view_all_orders and order.user_id not in {None, context.user.id}:
        raise HTTPException(status_code=404, detail="Payment order not found")
    try:
        return signed_response(payment_service.cancel_order(order_id=order_id, actor_id=context.user.id))
    except (ValueError, BillingError, PaymentError) as exc:
        _raise_billing_http_error(exc)


@router.post("/billing/payment-orders/{order_id}/simulate-paid")
async def simulate_current_payment_order_paid(
    order_id: str,
    request: SimulatePaymentOrderPaidRequest,
    context: RequestContext = Depends(get_request_context),
):
    """开发态模拟支付成功，方便把充值到账主链路直接跑通。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    order = payment_service.get_order(order_id)
    if order is None or order.organization_id != context.current_organization_id:
        raise HTTPException(status_code=404, detail="Payment order not found")
    can_view_all_orders = context.user.platform_role == ROLE_PLATFORM_SUPER_ADMIN or context.current_role_code == "org_admin"
    if not can_view_all_orders and order.user_id not in {None, context.user.id}:
        raise HTTPException(status_code=404, detail="Payment order not found")
    try:
        return signed_response(
            payment_service.simulate_payment_success(
                order_id=order_id,
                provider_trade_no=request.provider_trade_no,
                provider_buyer_id=request.provider_buyer_id,
                actor_id=context.user.id,
            )
        )
    except (ValueError, BillingError, PaymentError) as exc:
        _raise_billing_http_error(exc)


@router.api_route("/billing/payment-providers/{channel}/notify", methods=["GET", "POST"])
async def receive_payment_provider_notify(
    channel: str,
    request: Request,
):
    """接收第三方支付渠道回调，并按渠道协议返回 ACK。"""
    try:
        _, ack = payment_service.handle_provider_notification(
            channel=channel,
            headers=dict(request.headers),
            raw_body=await request.body(),
            query_params=dict(request.query_params),
            actor_id=None,
        )
        return Response(content=ack.body, status_code=ack.status_code, media_type=ack.media_type)
    except (ValueError, BillingError, PaymentError) as exc:
        try:
            ack = payment_service.build_notify_failure_ack(channel=channel, message=str(exc))
        except Exception:
            ack = None
        if ack is None:
            return Response(content="failure", status_code=400, media_type="text/plain")
        return Response(content=ack.body, status_code=ack.status_code, media_type=ack.media_type)


@router.get("/billing/charges")
async def list_current_billing_charges(
    project_id: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    context: RequestContext = Depends(get_request_context),
):
    """分页读取当前组织的计费单。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    return signed_response(
        billing_service.list_charges(
            context.current_organization_id,
            project_id=project_id,
            job_id=job_id,
            status=status,
            task_type=task_type,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/billing/charges/{charge_id}")
async def get_current_billing_charge(
    charge_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """读取当前组织下的单个计费单详情。"""
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is required")
    charge = billing_service.get_charge(charge_id)
    if charge is None or charge.organization_id != context.current_organization_id:
        raise HTTPException(status_code=404, detail="Billing charge not found")
    return signed_response(charge)


@router.get("/admin/billing/accounts", dependencies=[Depends(require_platform_role)])
async def list_billing_accounts():
    """列出全部组织账本。"""
    return signed_response(tenant_admin_service.list_billing_accounts())


@router.get("/admin/billing/transactions", dependencies=[Depends(require_platform_role)])
async def list_admin_billing_transactions(
    organization_id: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    direction: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """平台超级管理员按组织查看账务流水，并补充操作人显示信息。"""
    if organization_id:
        transactions = billing_service.list_transactions(
            organization_id,
            transaction_type=transaction_type,
            direction=direction,
            limit=limit,
            offset=offset,
        )
    else:
        transactions = []

    operator_ids = sorted({item.operator_user_id for item in transactions if item.operator_user_id})
    user_map = {item.id: item for item in user_repository.list_by_ids(operator_ids)}
    enriched = []
    for item in transactions:
        payload = item.model_dump(mode="json")
        operator = user_map.get(item.operator_user_id or "")
        payload["operator_display_name"] = (
            operator.display_name
            or operator.email
            or operator.phone
            or item.operator_user_id
        ) if operator else (item.operator_user_id or "系统")
        enriched.append(payload)
    return signed_response(enriched)


@router.get("/admin/billing/pricing-rules", dependencies=[Depends(require_platform_role)])
async def list_billing_pricing_rules():
    """列出全部任务计费规则。"""
    return signed_response(tenant_admin_service.list_billing_pricing_rules())


@router.get("/admin/billing/charges", dependencies=[Depends(require_platform_role)])
async def list_admin_billing_charges(
    organization_id: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """平台超级管理员按组织查看计费单。"""
    if not organization_id:
        return signed_response([])
    return signed_response(
        billing_service.list_charges(
            organization_id,
            project_id=project_id,
            job_id=job_id,
            status=status,
            task_type=task_type,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/admin/billing/charges/{charge_id}", dependencies=[Depends(require_platform_role)])
async def get_admin_billing_charge(charge_id: str):
    """平台超级管理员读取单个计费单详情。"""
    charge = billing_service.get_charge(charge_id)
    if charge is None:
        raise HTTPException(status_code=404, detail="Billing charge not found")
    return signed_response(charge)


@router.get("/admin/billing/reconcile/runs", dependencies=[Depends(require_platform_role)])
async def list_billing_reconcile_runs(
    limit: int = Query(default=50, ge=1, le=200),
):
    """列出最近的账务对账运行记录，供平台侧排查补偿执行结果。"""
    return signed_response(billing_reconcile_service.list_runs(limit=limit))


@router.post("/admin/billing/reconcile/run", dependencies=[Depends(require_platform_role)])
async def run_billing_reconcile(
    request: RunBillingReconcileRequest,
    context: RequestContext = Depends(get_request_context),
):
    """触发一次对账扫描，可选择 dry-run 仅评估待修复数量。"""
    return signed_response(
        billing_reconcile_service.reconcile_pending_charges(
            dry_run=request.dry_run,
            actor_id=context.user.id,
        )
    )


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


@router.post("/admin/billing/charges/{charge_id}/manual-adjust", dependencies=[Depends(require_platform_role)])
async def manual_adjust_billing_charge(
    charge_id: str,
    request: ManualAdjustBillingChargeRequest,
    context: RequestContext = Depends(get_request_context),
):
    """平台超级管理员对指定计费单执行手工补退或补扣。"""
    try:
        return signed_response(
            billing_service.adjust_charge(
                charge_id=charge_id,
                direction=request.direction,
                amount_credits=request.amount_credits,
                reason=request.reason,
                remark=request.remark,
                actor_id=context.user.id,
                idempotency_key=request.idempotency_key,
            )
        )
    except (ValueError, BillingError) as exc:
        _raise_billing_http_error(exc)
