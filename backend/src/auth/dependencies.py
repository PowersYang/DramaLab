"""FastAPI 认证与权限依赖。"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, Depends, Header, HTTPException

from ..application.services.auth_service import AuthService
from ..auth.constants import REFRESH_TOKEN_COOKIE, ROLE_PLATFORM_SUPER_ADMIN
from ..schemas.models import User


auth_service = AuthService()


@dataclass
class RequestContext:
    user: User
    current_workspace_id: str | None
    current_organization_id: str | None
    current_role_code: str | None
    capabilities: set[str]
    refresh_token: str | None


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "bearer "
    if authorization.lower().startswith(prefix):
        return authorization[len(prefix):].strip()
    return None


def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> User:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = auth_service.decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = auth_service.user_repository.get(claims.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="User is unavailable")
    return user


def get_request_context(
    user: User = Depends(get_current_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE),
) -> RequestContext:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = auth_service.decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    me = auth_service.build_auth_me(user, claims.workspace_id)
    return RequestContext(
        user=user,
        current_workspace_id=me.current_workspace_id,
        current_organization_id=me.current_organization_id,
        current_role_code=me.current_role_code,
        capabilities=set(me.capabilities),
        refresh_token=refresh_token,
    )


def require_capability(capability: str):
    def _dependency(context: RequestContext = Depends(get_request_context)) -> RequestContext:
        if capability not in context.capabilities:
            raise HTTPException(status_code=403, detail="Permission denied")
        return context

    return _dependency


def require_platform_role(context: RequestContext = Depends(get_request_context)) -> RequestContext:
    if context.user.platform_role != ROLE_PLATFORM_SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Platform admin permission required")
    return context
