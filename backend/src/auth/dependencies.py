"""FastAPI 认证与权限依赖。"""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request

from ..application.services.auth_service import AuthService
from ..auth.constants import (
    ACCESS_TOKEN_COOKIE,
    LEGACY_ACCESS_TOKEN_COOKIE,
    LEGACY_REFRESH_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    ROLE_PLATFORM_SUPER_ADMIN,
)
from ..common.log import get_logger
from ..schemas.models import User


auth_service = AuthService()
logger = get_logger(__name__)


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


def _read_auth_cookie(request: Request, primary_key: str, legacy_key: str) -> str | None:
    """优先读取新 cookie 名，缺失时回退旧品牌 cookie，保证会话迁移平滑。"""
    return request.cookies.get(primary_key) or request.cookies.get(legacy_key)


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> User:
    started_at = time.perf_counter()
    request_id = getattr(request.state, "request_id", None)
    access_token_cookie = _read_auth_cookie(request, ACCESS_TOKEN_COOKIE, LEGACY_ACCESS_TOKEN_COOKIE)
    token = _extract_bearer_token(authorization) or access_token_cookie
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = auth_service.decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = auth_service.user_repository.get(claims.user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="User is unavailable")
    logger.info(
        "AUTH_DEP: get_current_user request_id=%s user_id=%s duration_ms=%.2f",
        request_id,
        user.id,
        (time.perf_counter() - started_at) * 1000,
    )
    return user


def get_request_context(
    request: Request,
    user: User = Depends(get_current_user),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> RequestContext:
    started_at = time.perf_counter()
    request_id = getattr(request.state, "request_id", None)
    access_token_cookie = _read_auth_cookie(request, ACCESS_TOKEN_COOKIE, LEGACY_ACCESS_TOKEN_COOKIE)
    refresh_token = _read_auth_cookie(request, REFRESH_TOKEN_COOKIE, LEGACY_REFRESH_TOKEN_COOKIE)
    token = _extract_bearer_token(authorization) or access_token_cookie
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        decode_started_at = time.perf_counter()
        claims = auth_service.decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    decode_duration_ms = (time.perf_counter() - decode_started_at) * 1000
    build_started_at = time.perf_counter()
    me = auth_service.build_auth_me(user, claims.workspace_id)
    build_duration_ms = (time.perf_counter() - build_started_at) * 1000
    logger.info(
        "AUTH_DEP: get_request_context request_id=%s user_id=%s workspace_id=%s decode_ms=%.2f build_auth_me_ms=%.2f total_ms=%.2f capabilities=%s",
        request_id,
        user.id,
        me.current_workspace_id,
        decode_duration_ms,
        build_duration_ms,
        (time.perf_counter() - started_at) * 1000,
        len(me.capabilities),
    )
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
