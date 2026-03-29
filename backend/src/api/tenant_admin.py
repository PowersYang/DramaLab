"""多租户基础对象 CRUD 路由。"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..application.services import TenantAdminService
from ..auth.dependencies import require_platform_role
from ..common import signed_response
from ..common.log import get_logger
from ..schemas.requests import (
    CreateModelCatalogEntryRequest,
    CreateMembershipRequest,
    CreateOrganizationRequest,
    CreateRoleRequest,
    CreateUserRequest,
    CreateWorkspaceRequest,
    UpdateModelCatalogEntryRequest,
    UpdateModelProviderRequest,
    UpdateMembershipRequest,
    UpdateOrganizationRequest,
    UpdateRoleRequest,
    UpdateUserRequest,
    UpdateWorkspaceRequest,
)


router = APIRouter(dependencies=[Depends(require_platform_role)])
logger = get_logger(__name__)
tenant_admin_service = TenantAdminService()


def _raise_http_error(exc: ValueError) -> None:
    """把应用层校验错误映射到合适的 HTTP 状态码。"""
    message = str(exc)
    if "not found" in message.lower():
        raise HTTPException(status_code=404, detail=message)
    if "already exists" in message.lower() or "conflict" in message.lower():
        raise HTTPException(status_code=409, detail=message)
    raise HTTPException(status_code=400, detail=message)


@router.post("/organizations")
async def create_organization(request: CreateOrganizationRequest):
    """创建组织。"""
    try:
        logger.info("TENANT_ADMIN_API: create_organization name=%s slug=%s", request.name, request.slug)
        return signed_response(
            tenant_admin_service.create_organization(
                name=request.name,
                slug=request.slug,
                status=request.status,
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/organizations")
async def list_organizations():
    """列出组织。"""
    organizations = tenant_admin_service.list_organizations()
    logger.info("TENANT_ADMIN_API: list_organizations count=%s", len(organizations))
    return signed_response(organizations)


@router.get("/organizations/{organization_id}")
async def get_organization(organization_id: str):
    """读取单个组织。"""
    organization = tenant_admin_service.get_organization(organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return signed_response(organization)


@router.put("/organizations/{organization_id}")
async def update_organization(organization_id: str, request: UpdateOrganizationRequest):
    """更新组织。"""
    try:
        updates = request.model_dump(exclude_unset=True)
        logger.info("TENANT_ADMIN_API: update_organization organization_id=%s fields=%s", organization_id, sorted(updates.keys()))
        return signed_response(tenant_admin_service.update_organization(organization_id, updates))
    except ValueError as exc:
        _raise_http_error(exc)


@router.delete("/organizations/{organization_id}")
async def delete_organization(organization_id: str):
    """删除组织。"""
    try:
        logger.info("TENANT_ADMIN_API: delete_organization organization_id=%s", organization_id)
        return signed_response(tenant_admin_service.delete_organization(organization_id))
    except ValueError as exc:
        _raise_http_error(exc)


@router.post("/workspaces")
async def create_workspace(request: CreateWorkspaceRequest):
    """创建工作区。"""
    try:
        logger.info("TENANT_ADMIN_API: create_workspace name=%s organization_id=%s", request.name, request.organization_id)
        return signed_response(
            tenant_admin_service.create_workspace(
                name=request.name,
                organization_id=request.organization_id,
                slug=request.slug,
                status=request.status,
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/workspaces")
async def list_workspaces(organization_id: str | None = Query(default=None)):
    """列出工作区，可按组织过滤。"""
    workspaces = tenant_admin_service.list_workspaces(organization_id=organization_id)
    logger.info("TENANT_ADMIN_API: list_workspaces organization_id=%s count=%s", organization_id, len(workspaces))
    return signed_response(workspaces)


@router.get("/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str):
    """读取单个工作区。"""
    workspace = tenant_admin_service.get_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return signed_response(workspace)


@router.put("/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, request: UpdateWorkspaceRequest):
    """更新工作区。"""
    try:
        updates = request.model_dump(exclude_unset=True)
        logger.info("TENANT_ADMIN_API: update_workspace workspace_id=%s fields=%s", workspace_id, sorted(updates.keys()))
        return signed_response(tenant_admin_service.update_workspace(workspace_id, updates))
    except ValueError as exc:
        _raise_http_error(exc)


@router.delete("/workspaces/{workspace_id}")
async def delete_workspace(workspace_id: str):
    """删除工作区。"""
    try:
        logger.info("TENANT_ADMIN_API: delete_workspace workspace_id=%s", workspace_id)
        return signed_response(tenant_admin_service.delete_workspace(workspace_id))
    except ValueError as exc:
        _raise_http_error(exc)


@router.post("/users")
async def create_user(request: CreateUserRequest):
    """创建用户。"""
    try:
        logger.info("TENANT_ADMIN_API: create_user email=%s", request.email)
        return signed_response(
            tenant_admin_service.create_user(
                email=request.email,
                display_name=request.display_name,
                status=request.status,
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/users")
async def list_users():
    """列出用户。"""
    users = tenant_admin_service.list_users()
    logger.info("TENANT_ADMIN_API: list_users count=%s", len(users))
    return signed_response(users)


@router.get("/users/{user_id}")
async def get_user(user_id: str):
    """读取单个用户。"""
    user = tenant_admin_service.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return signed_response(user)


@router.put("/users/{user_id}")
async def update_user(user_id: str, request: UpdateUserRequest):
    """更新用户。"""
    try:
        updates = request.model_dump(exclude_unset=True)
        logger.info("TENANT_ADMIN_API: update_user user_id=%s fields=%s", user_id, sorted(updates.keys()))
        return signed_response(tenant_admin_service.update_user(user_id, updates))
    except ValueError as exc:
        _raise_http_error(exc)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str):
    """删除用户。"""
    try:
        logger.info("TENANT_ADMIN_API: delete_user user_id=%s", user_id)
        return signed_response(tenant_admin_service.delete_user(user_id))
    except ValueError as exc:
        _raise_http_error(exc)


@router.post("/roles")
async def create_role(request: CreateRoleRequest):
    """创建角色。"""
    try:
        logger.info("TENANT_ADMIN_API: create_role code=%s", request.code)
        return signed_response(
            tenant_admin_service.create_role(
                code=request.code,
                name=request.name,
                description=request.description,
                is_system=request.is_system,
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/roles")
async def list_roles():
    """列出角色。"""
    roles = tenant_admin_service.list_roles()
    logger.info("TENANT_ADMIN_API: list_roles count=%s", len(roles))
    return signed_response(roles)


@router.get("/roles/{role_id}")
async def get_role(role_id: str):
    """读取单个角色。"""
    role = tenant_admin_service.get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return signed_response(role)


@router.put("/roles/{role_id}")
async def update_role(role_id: str, request: UpdateRoleRequest):
    """更新角色。"""
    try:
        updates = request.model_dump(exclude_unset=True)
        logger.info("TENANT_ADMIN_API: update_role role_id=%s fields=%s", role_id, sorted(updates.keys()))
        return signed_response(tenant_admin_service.update_role(role_id, updates))
    except ValueError as exc:
        _raise_http_error(exc)


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str):
    """删除角色。"""
    try:
        logger.info("TENANT_ADMIN_API: delete_role role_id=%s", role_id)
        return signed_response(tenant_admin_service.delete_role(role_id))
    except ValueError as exc:
        _raise_http_error(exc)


@router.post("/memberships")
async def create_membership(request: CreateMembershipRequest):
    """创建成员关系。"""
    try:
        logger.info(
            "TENANT_ADMIN_API: create_membership user_id=%s organization_id=%s workspace_id=%s role_id=%s",
            request.user_id,
            request.organization_id,
            request.workspace_id,
            request.role_id,
        )
        return signed_response(
            tenant_admin_service.create_membership(
                user_id=request.user_id,
                organization_id=request.organization_id,
                workspace_id=request.workspace_id,
                role_id=request.role_id,
                status=request.status,
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/memberships")
async def list_memberships(
    organization_id: str | None = Query(default=None),
    workspace_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    role_id: str | None = Query(default=None),
):
    """列出成员关系，可按多维条件过滤。"""
    memberships = tenant_admin_service.list_memberships(
        organization_id=organization_id,
        workspace_id=workspace_id,
        user_id=user_id,
        role_id=role_id,
    )
    logger.info(
        "TENANT_ADMIN_API: list_memberships organization_id=%s workspace_id=%s user_id=%s role_id=%s count=%s",
        organization_id,
        workspace_id,
        user_id,
        role_id,
        len(memberships),
    )
    return signed_response(memberships)


@router.get("/memberships/{membership_id}")
async def get_membership(membership_id: str):
    """读取单个成员关系。"""
    membership = tenant_admin_service.get_membership(membership_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    return signed_response(membership)


@router.put("/memberships/{membership_id}")
async def update_membership(membership_id: str, request: UpdateMembershipRequest):
    """更新成员关系。"""
    try:
        updates = request.model_dump(exclude_unset=True)
        logger.info("TENANT_ADMIN_API: update_membership membership_id=%s fields=%s", membership_id, sorted(updates.keys()))
        return signed_response(tenant_admin_service.update_membership(membership_id, updates))
    except ValueError as exc:
        _raise_http_error(exc)


@router.delete("/memberships/{membership_id}")
async def delete_membership(membership_id: str):
    """删除成员关系。"""
    try:
        logger.info("TENANT_ADMIN_API: delete_membership membership_id=%s", membership_id)
        return signed_response(tenant_admin_service.delete_membership(membership_id))
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/model-providers")
async def list_model_providers():
    """列出平台级模型供应商配置摘要。"""
    providers = tenant_admin_service.list_model_providers()
    logger.info("TENANT_ADMIN_API: list_model_providers count=%s", len(providers))
    return signed_response(providers)


@router.put("/model-providers/{provider_key}")
async def update_model_provider(provider_key: str, request: UpdateModelProviderRequest):
    """更新模型供应商配置。"""
    try:
        logger.info("TENANT_ADMIN_API: update_model_provider provider_key=%s", provider_key)
        return signed_response(
            tenant_admin_service.update_model_provider(
                provider_key=provider_key,
                payload=request.model_dump(exclude_unset=True),
            )
        )
    except ValueError as exc:
        _raise_http_error(exc)


@router.get("/model-catalog")
async def list_model_catalog(task_type: str | None = Query(default=None)):
    """列出平台模型目录。"""
    catalog = tenant_admin_service.list_model_catalog(task_type=task_type)
    logger.info("TENANT_ADMIN_API: list_model_catalog task_type=%s count=%s", task_type, len(catalog))
    return signed_response(catalog)


@router.post("/model-catalog")
async def create_model_catalog_entry(request: CreateModelCatalogEntryRequest):
    """新增模型目录项。"""
    try:
        logger.info("TENANT_ADMIN_API: create_model_catalog_entry model_id=%s", request.model_id)
        return signed_response(tenant_admin_service.create_model_catalog_entry(request.model_dump()))
    except ValueError as exc:
        _raise_http_error(exc)


@router.put("/model-catalog/{model_id}")
async def update_model_catalog_entry(model_id: str, request: UpdateModelCatalogEntryRequest):
    """更新模型目录项。"""
    try:
        logger.info("TENANT_ADMIN_API: update_model_catalog_entry model_id=%s", model_id)
        return signed_response(tenant_admin_service.update_model_catalog_entry(model_id, request.model_dump(exclude_unset=True)))
    except ValueError as exc:
        _raise_http_error(exc)
