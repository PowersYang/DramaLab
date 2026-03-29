"""认证与工作区成员接口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..application.services import AuthService
from ..auth.constants import (
    ACCESS_TOKEN_COOKIE,
    CAP_WORKSPACE_MANAGE_MEMBERS,
    CAP_ORG_MANAGE,
    LEGACY_ACCESS_TOKEN_COOKIE,
    LEGACY_REFRESH_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    ROLE_INDIVIDUAL_CREATOR,
)
from ..auth.dependencies import RequestContext, get_request_context
from ..common import signed_response
from ..common.log import get_logger
from ..schemas.requests import (
    InviteWorkspaceMemberRequest,
    SendEmailCodeRequest,
    SwitchWorkspaceRequest,
    UpdateCurrentOrganizationRequest,
    UpdateCurrentWorkspaceRequest,
    UpdateWorkspaceMemberRoleRequest,
    VerifyEmailCodeRequest,
)


router = APIRouter()
logger = get_logger(__name__)
auth_service = AuthService()


def _set_refresh_cookie(response, refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=30 * 24 * 60 * 60,
        path="/",
    )


def _set_access_cookie(response, access_token: str, expires_in: int) -> None:
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=access_token,
        httponly=False,
        samesite="lax",
        secure=False,
        max_age=expires_in,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_TOKEN_COOKIE, path="/")
    response.delete_cookie(ACCESS_TOKEN_COOKIE, path="/")
    response.delete_cookie(LEGACY_REFRESH_TOKEN_COOKIE, path="/")
    response.delete_cookie(LEGACY_ACCESS_TOKEN_COOKIE, path="/")


@router.post("/auth/email-code/send")
async def send_email_code(request: SendEmailCodeRequest):
    try:
        payload = auth_service.send_email_code(request.email, request.purpose)
        return signed_response(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/auth/email-code/verify")
async def verify_email_code(request: VerifyEmailCodeRequest, response: Response, http_request: Request):
    try:
        auth_payload, me, refresh_token = auth_service.verify_email_code(
            email=request.email,
            code=request.code,
            purpose=request.purpose,
            display_name=request.display_name,
            signup_kind=request.signup_kind,
            organization_name=request.organization_name,
            invitation_id=request.invitation_id,
            ip_address=http_request.client.host if http_request.client else None,
            user_agent=http_request.headers.get("user-agent"),
        )
        payload = {
            "session": auth_payload.model_dump(),
            "me": me.model_dump(),
        }
        http_response = signed_response(payload)
        _set_refresh_cookie(http_response, refresh_token)
        _set_access_cookie(http_response, auth_payload.access_token, auth_payload.expires_in)
        return http_response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/auth/refresh")
async def refresh_auth_session(
    request: Request,
):
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE) or request.cookies.get(LEGACY_REFRESH_TOKEN_COOKIE)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token is missing")
    try:
        auth_payload, me = auth_service.refresh_session(refresh_token)
        http_response = signed_response({"session": auth_payload.model_dump(), "me": me.model_dump()})
        _set_access_cookie(http_response, auth_payload.access_token, auth_payload.expires_in)
        return http_response
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))


@router.post("/auth/logout")
async def logout(response: Response, request: Request):
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE) or request.cookies.get(LEGACY_REFRESH_TOKEN_COOKIE)
    if refresh_token:
        auth_service.logout(refresh_token)
    http_response = signed_response({"status": "logged_out"})
    _clear_auth_cookies(http_response)
    return http_response


@router.get("/auth/me")
async def get_me(context: RequestContext = Depends(get_request_context)):
    return signed_response(auth_service.build_auth_me(context.user, context.current_workspace_id))


@router.post("/auth/workspace/switch")
async def switch_workspace(
    request: SwitchWorkspaceRequest,
    context: RequestContext = Depends(get_request_context),
):
    if not context.refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token is missing")
    try:
        auth_payload, me = auth_service.switch_workspace(context.user, context.refresh_token, request.workspace_id)
        http_response = signed_response({"session": auth_payload.model_dump(), "me": me.model_dump()})
        _set_access_cookie(http_response, auth_payload.access_token, auth_payload.expires_in)
        return http_response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/auth/invitations/{invitation_id}")
async def get_invitation_preview(invitation_id: str):
    try:
        return signed_response(auth_service.get_invitation_preview(invitation_id).model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/workspace/members")
async def list_workspace_members(context: RequestContext = Depends(get_request_context)):
    if not context.current_workspace_id:
        raise HTTPException(status_code=400, detail="Current workspace is missing")
    if CAP_WORKSPACE_MANAGE_MEMBERS not in context.capabilities and context.current_role_code != "producer":
        raise HTTPException(status_code=403, detail="Permission denied")
    return signed_response(auth_service.list_workspace_members(context.current_workspace_id))


@router.post("/workspace/invitations")
async def invite_workspace_member(
    request: InviteWorkspaceMemberRequest,
    context: RequestContext = Depends(get_request_context),
):
    if CAP_WORKSPACE_MANAGE_MEMBERS not in context.capabilities:
        raise HTTPException(status_code=403, detail="Permission denied")
    if not context.current_workspace_id or not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current workspace is missing")
    try:
        invitation = auth_service.invite_workspace_member(
            organization_id=context.current_organization_id,
            workspace_id=context.current_workspace_id,
            email=request.email,
            role_code=request.role_code,
            invited_by=context.user.id,
        )
        payload = invitation.model_dump()
        payload["invite_url"] = auth_service.build_invitation_url_for_client(invitation.id)
        return signed_response(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/workspace/current")
async def update_current_workspace(
    request: UpdateCurrentWorkspaceRequest,
    context: RequestContext = Depends(get_request_context),
):
    if not context.current_workspace_id:
        raise HTTPException(status_code=400, detail="Current workspace is missing")
    if CAP_ORG_MANAGE not in context.capabilities and context.current_role_code != ROLE_INDIVIDUAL_CREATOR:
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        workspace = auth_service.update_current_workspace(context.current_workspace_id, request.name)
        return signed_response(workspace.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/organization/current")
async def update_current_organization(
    request: UpdateCurrentOrganizationRequest,
    context: RequestContext = Depends(get_request_context),
):
    if not context.current_organization_id:
        raise HTTPException(status_code=400, detail="Current organization is missing")
    if CAP_ORG_MANAGE not in context.capabilities and context.current_role_code != ROLE_INDIVIDUAL_CREATOR:
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        organization = auth_service.update_current_organization(context.current_organization_id, request.name)
        return signed_response(organization.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/workspace/members/{membership_id}/role")
async def update_workspace_member_role(
    membership_id: str,
    request: UpdateWorkspaceMemberRoleRequest,
    context: RequestContext = Depends(get_request_context),
):
    if CAP_WORKSPACE_MANAGE_MEMBERS not in context.capabilities:
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        membership = auth_service.membership_repository.get(membership_id)
        if membership is None or membership.workspace_id != context.current_workspace_id:
            raise ValueError("Membership not found")
        membership = auth_service.update_workspace_member_role(membership_id, request.role_code)
        return signed_response(membership)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/workspace/members/{membership_id}")
async def delete_workspace_member(
    membership_id: str,
    context: RequestContext = Depends(get_request_context),
):
    if CAP_WORKSPACE_MANAGE_MEMBERS not in context.capabilities:
        raise HTTPException(status_code=403, detail="Permission denied")
    try:
        membership = auth_service.membership_repository.get(membership_id)
        if membership is None or membership.workspace_id != context.current_workspace_id:
            raise ValueError("Membership not found")
        auth_service.remove_workspace_member(membership_id)
        return signed_response({"status": "deleted"})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
