"""多租户基础对象应用服务。"""

import uuid

from ...common.log import get_logger
from ...repository import (
    MembershipRepository,
    ModelCatalogEntryRepository,
    ModelProviderConfigRepository,
    OrganizationRepository,
    RoleRepository,
    UserRepository,
    WorkspaceRepository,
)
from ...schemas.models import Membership, Organization, Role, User, Workspace
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class TenantAdminService:
    """统一管理组织、工作区、用户、角色和成员关系。"""

    def __init__(self):
        self.organization_repository = OrganizationRepository()
        self.workspace_repository = WorkspaceRepository()
        self.user_repository = UserRepository()
        self.role_repository = RoleRepository()
        self.membership_repository = MembershipRepository()
        self.model_provider_repository = ModelProviderConfigRepository()
        self.model_catalog_repository = ModelCatalogEntryRepository()

    def list_organizations(self):
        """列出全部组织。"""
        return self.organization_repository.list()

    def get_organization(self, organization_id: str):
        """读取单个组织。"""
        return self.organization_repository.get(organization_id)

    def create_organization(self, name: str, slug: str | None = None, status: str = "active"):
        """创建组织，并提前校验 slug 唯一性。"""
        if slug and self.organization_repository.get_by_slug(slug):
            raise ValueError(f"Organization slug already exists: {slug}")
        now = utc_now()
        organization = Organization(
            id=str(uuid.uuid4()),
            name=name,
            slug=slug,
            status=status,
            created_at=now,
            updated_at=now,
        )
        logger.info("TENANT_ADMIN_SERVICE: create_organization organization_id=%s slug=%s", organization.id, slug)
        return self.organization_repository.create(organization)

    def update_organization(self, organization_id: str, updates: dict):
        """更新组织基础字段。"""
        organization = self.organization_repository.get(organization_id)
        if organization is None:
            raise ValueError("Organization not found")
        slug = updates.get("slug")
        if slug and slug != organization.slug:
            existing = self.organization_repository.get_by_slug(slug)
            if existing and existing.id != organization_id:
                raise ValueError(f"Organization slug already exists: {slug}")
        logger.info(
            "TENANT_ADMIN_SERVICE: update_organization organization_id=%s fields=%s",
            organization_id,
            sorted(updates.keys()),
        )
        return self.organization_repository.update(organization_id, updates)

    def delete_organization(self, organization_id: str):
        """仅在没有下游依赖时删除组织。"""
        organization = self.organization_repository.get(organization_id)
        if organization is None:
            raise ValueError("Organization not found")
        if self.organization_repository.has_dependents(organization_id):
            raise ValueError("Organization still has dependent workspaces, memberships, billing accounts, projects, or series")
        self.organization_repository.delete(organization_id)
        logger.info("TENANT_ADMIN_SERVICE: delete_organization organization_id=%s", organization_id)
        return {"status": "deleted", "id": organization_id, "name": organization.name}

    def list_workspaces(self, organization_id: str | None = None):
        """按组织过滤列出工作区。"""
        return self.workspace_repository.list(organization_id=organization_id)

    def get_workspace(self, workspace_id: str):
        """读取单个工作区。"""
        return self.workspace_repository.get(workspace_id)

    def create_workspace(
        self,
        name: str,
        organization_id: str | None = None,
        slug: str | None = None,
        status: str = "active",
    ):
        """创建工作区，并校验其上游组织存在。"""
        if organization_id and not self.workspace_repository.organization_exists(organization_id):
            raise ValueError("Organization not found")
        now = utc_now()
        workspace = Workspace(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            name=name,
            slug=slug,
            status=status,
            created_at=now,
            updated_at=now,
        )
        logger.info(
            "TENANT_ADMIN_SERVICE: create_workspace workspace_id=%s organization_id=%s",
            workspace.id,
            organization_id,
        )
        return self.workspace_repository.create(workspace)

    def update_workspace(self, workspace_id: str, updates: dict):
        """更新工作区基础字段。"""
        workspace = self.workspace_repository.get(workspace_id)
        if workspace is None:
            raise ValueError("Workspace not found")
        organization_id = updates.get("organization_id")
        if organization_id and not self.workspace_repository.organization_exists(organization_id):
            raise ValueError("Organization not found")
        if "organization_id" in updates and organization_id != workspace.organization_id and self.workspace_repository.has_dependents(workspace_id):
            raise ValueError("Workspace organization cannot be changed while dependent memberships, projects, or series still exist")
        logger.info(
            "TENANT_ADMIN_SERVICE: update_workspace workspace_id=%s fields=%s",
            workspace_id,
            sorted(updates.keys()),
        )
        return self.workspace_repository.update(workspace_id, updates)

    def delete_workspace(self, workspace_id: str):
        """仅在没有下游依赖时删除工作区。"""
        workspace = self.workspace_repository.get(workspace_id)
        if workspace is None:
            raise ValueError("Workspace not found")
        if self.workspace_repository.has_dependents(workspace_id):
            raise ValueError("Workspace still has dependent memberships, projects, or series")
        self.workspace_repository.delete(workspace_id)
        logger.info("TENANT_ADMIN_SERVICE: delete_workspace workspace_id=%s", workspace_id)
        return {"status": "deleted", "id": workspace_id, "name": workspace.name}

    def list_users(self):
        """列出全部用户。"""
        return self.user_repository.list()

    def get_user(self, user_id: str):
        """读取单个用户。"""
        return self.user_repository.get(user_id)

    def create_user(self, email: str | None = None, display_name: str | None = None, status: str = "active"):
        """创建用户，并提前校验邮箱唯一性。"""
        if email and self.user_repository.get_by_email(email):
            raise ValueError(f"User email already exists: {email}")
        now = utc_now()
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            display_name=display_name,
            status=status,
            created_at=now,
            updated_at=now,
        )
        logger.info("TENANT_ADMIN_SERVICE: create_user user_id=%s email=%s", user.id, email)
        return self.user_repository.create(user)

    def update_user(self, user_id: str, updates: dict):
        """更新用户基础字段。"""
        user = self.user_repository.get(user_id)
        if user is None:
            raise ValueError("User not found")
        email = updates.get("email")
        if email and email != user.email:
            existing = self.user_repository.get_by_email(email)
            if existing and existing.id != user_id:
                raise ValueError(f"User email already exists: {email}")
        logger.info("TENANT_ADMIN_SERVICE: update_user user_id=%s fields=%s", user_id, sorted(updates.keys()))
        return self.user_repository.update(user_id, updates)

    def delete_user(self, user_id: str):
        """仅在没有成员关系引用时删除用户。"""
        user = self.user_repository.get(user_id)
        if user is None:
            raise ValueError("User not found")
        if self.user_repository.has_memberships(user_id):
            raise ValueError("User still has dependent memberships")
        self.user_repository.delete(user_id)
        logger.info("TENANT_ADMIN_SERVICE: delete_user user_id=%s", user_id)
        return {"status": "deleted", "id": user_id, "display_name": user.display_name}

    def list_roles(self):
        """列出全部角色。"""
        return self.role_repository.list()

    def get_role(self, role_id: str):
        """读取单个角色。"""
        return self.role_repository.get(role_id)

    def create_role(self, code: str, name: str, description: str | None = None, is_system: bool = False):
        """创建角色，并提前校验 code 唯一性。"""
        if self.role_repository.get_by_code(code):
            raise ValueError(f"Role code already exists: {code}")
        now = utc_now()
        role = Role(
            id=str(uuid.uuid4()),
            code=code,
            name=name,
            description=description,
            is_system=is_system,
            created_at=now,
            updated_at=now,
        )
        logger.info("TENANT_ADMIN_SERVICE: create_role role_id=%s code=%s", role.id, code)
        return self.role_repository.create(role)

    def update_role(self, role_id: str, updates: dict):
        """更新角色定义。"""
        role = self.role_repository.get(role_id)
        if role is None:
            raise ValueError("Role not found")
        code = updates.get("code")
        if code and code != role.code:
            existing = self.role_repository.get_by_code(code)
            if existing and existing.id != role_id:
                raise ValueError(f"Role code already exists: {code}")
        logger.info("TENANT_ADMIN_SERVICE: update_role role_id=%s fields=%s", role_id, sorted(updates.keys()))
        return self.role_repository.update(role_id, updates)

    def delete_role(self, role_id: str):
        """保护系统角色和已被引用角色不被误删。"""
        role = self.role_repository.get(role_id)
        if role is None:
            raise ValueError("Role not found")
        if role.is_system:
            raise ValueError("System role cannot be deleted")
        if self.role_repository.has_memberships(role_id):
            raise ValueError("Role still has dependent memberships")
        self.role_repository.delete(role_id)
        logger.info("TENANT_ADMIN_SERVICE: delete_role role_id=%s", role_id)
        return {"status": "deleted", "id": role_id, "code": role.code}

    def list_model_providers(self):
        """列出平台模型供应商配置摘要。"""
        from .model_provider_service import ModelProviderService

        return ModelProviderService().list_provider_summaries()

    def create_model_provider(self, payload: dict):
        """创建模型供应商配置。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: create_model_provider provider_key=%s", payload.get("provider_key"))
        return ModelProviderService().create_provider(payload)

    def update_model_provider(self, provider_key: str, payload: dict):
        """更新模型供应商配置。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: update_model_provider provider_key=%s fields=%s", provider_key, sorted(payload.keys()))
        return ModelProviderService().update_provider(
            provider_key=provider_key,
            display_name=payload.get("display_name"),
            description=payload.get("description"),
            enabled=payload.get("enabled"),
            base_url=payload.get("base_url"),
            credentials_patch=payload.get("credentials_patch"),
            settings_patch=payload.get("settings_patch"),
        )

    def delete_model_provider(self, provider_key: str):
        """删除模型供应商配置。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: delete_model_provider provider_key=%s", provider_key)
        return ModelProviderService().delete_provider(provider_key)

    def list_model_catalog(self, task_type: str | None = None):
        """列出平台模型目录。"""
        from .model_provider_service import ModelProviderService

        return ModelProviderService().list_model_catalog(task_type=task_type)

    def create_model_catalog_entry(self, payload: dict):
        """创建模型目录项。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: create_model_catalog_entry model_id=%s", payload.get("model_id"))
        return ModelProviderService().create_model_catalog_entry(payload)

    def update_model_catalog_entry(self, model_id: str, payload: dict):
        """更新模型目录项。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: update_model_catalog_entry model_id=%s fields=%s", model_id, sorted(payload.keys()))
        return ModelProviderService().update_model_catalog_entry(model_id, payload)

    def delete_model_catalog_entry(self, model_id: str):
        """删除模型目录项。"""
        from .model_provider_service import ModelProviderService

        logger.info("TENANT_ADMIN_SERVICE: delete_model_catalog_entry model_id=%s", model_id)
        return ModelProviderService().delete_model_catalog_entry(model_id)

    def list_task_concurrency_task_types(self):
        """列出可配置并发限制的任务类型。"""
        from .task_concurrency_service import TaskConcurrencyService

        return TaskConcurrencyService().list_task_type_options()

    def list_task_concurrency_limits(self):
        """列出所有组织级任务并发限制。"""
        from .task_concurrency_service import TaskConcurrencyService

        return TaskConcurrencyService().list_limits()

    def upsert_task_concurrency_limit(self, payload: dict):
        """创建或更新组织级任务并发限制。"""
        from .task_concurrency_service import TaskConcurrencyService

        logger.info(
            "TENANT_ADMIN_SERVICE: upsert_task_concurrency_limit organization_id=%s task_type=%s max_concurrency=%s",
            payload.get("organization_id"),
            payload.get("task_type"),
            payload.get("max_concurrency"),
        )
        return TaskConcurrencyService().upsert_limit(
            organization_id=payload["organization_id"],
            task_type=payload["task_type"],
            max_concurrency=payload["max_concurrency"],
        )

    def delete_task_concurrency_limit(self, organization_id: str, task_type: str):
        """删除组织级任务并发限制。"""
        from .task_concurrency_service import TaskConcurrencyService

        logger.info(
            "TENANT_ADMIN_SERVICE: delete_task_concurrency_limit organization_id=%s task_type=%s",
            organization_id,
            task_type,
        )
        return TaskConcurrencyService().delete_limit(organization_id=organization_id, task_type=task_type)

    def list_billing_accounts(self):
        """列出全部组织账本。"""
        from .billing_service import BillingService

        return BillingService().account_repository.list()

    def list_billing_pricing_rules(self):
        """列出任务计费规则。"""
        from .billing_service import BillingService

        return BillingService().list_pricing_rules()

    def upsert_billing_pricing_rule(self, payload: dict, actor_id: str | None = None):
        """创建或更新任务计费规则。"""
        from .billing_service import BillingService

        logger.info(
            "TENANT_ADMIN_SERVICE: upsert_billing_pricing_rule organization_id=%s task_type=%s price_credits=%s",
            payload.get("organization_id"),
            payload.get("task_type"),
            payload.get("price_credits"),
        )
        return BillingService().upsert_pricing_rule(
            task_type=payload["task_type"],
            price_credits=payload["price_credits"],
            organization_id=payload.get("organization_id"),
            actor_id=actor_id,
            status=payload.get("status", "active"),
            description=payload.get("description"),
        )

    def list_billing_recharge_bonus_rules(self):
        """列出充值赠送规则。"""
        from .billing_service import BillingService

        return BillingService().list_recharge_bonus_rules()

    def upsert_billing_recharge_bonus_rule(self, payload: dict, actor_id: str | None = None):
        """创建或更新充值赠送规则。"""
        from .billing_service import BillingService

        logger.info(
            "TENANT_ADMIN_SERVICE: upsert_billing_recharge_bonus_rule organization_id=%s min_recharge_cents=%s bonus_credits=%s",
            payload.get("organization_id"),
            payload.get("min_recharge_cents"),
            payload.get("bonus_credits"),
        )
        return BillingService().upsert_recharge_bonus_rule(
            min_recharge_cents=payload["min_recharge_cents"],
            max_recharge_cents=payload.get("max_recharge_cents"),
            bonus_credits=payload["bonus_credits"],
            organization_id=payload.get("organization_id"),
            actor_id=actor_id,
            status=payload.get("status", "active"),
            description=payload.get("description"),
        )

    def manual_recharge_billing_account(self, payload: dict, actor_id: str | None = None):
        """给组织手工充值，自动应用赠送规则。"""
        from .billing_service import BillingService

        logger.info(
            "TENANT_ADMIN_SERVICE: manual_recharge_billing_account organization_id=%s amount_cents=%s",
            payload.get("organization_id"),
            payload.get("amount_cents"),
        )
        return BillingService().manual_recharge(
            organization_id=payload["organization_id"],
            amount_cents=payload["amount_cents"],
            workspace_id=payload.get("workspace_id"),
            actor_id=actor_id,
            remark=payload.get("remark"),
            billing_email=payload.get("billing_email"),
            idempotency_key=payload.get("idempotency_key"),
        )

    def list_memberships(
        self,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        user_id: str | None = None,
        role_id: str | None = None,
    ):
        """按不同维度过滤成员关系。"""
        return self.membership_repository.list(
            organization_id=organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            role_id=role_id,
        )

    def get_membership(self, membership_id: str):
        """读取单个成员关系。"""
        return self.membership_repository.get(membership_id)

    def create_membership(
        self,
        user_id: str,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        role_id: str | None = None,
        status: str = "active",
    ):
        """创建成员关系，并校验用户、组织、工作区和角色的关联一致性。"""
        if workspace_id and organization_id is None:
            workspace = self.workspace_repository.get(workspace_id)
            organization_id = workspace.organization_id if workspace else organization_id
        self._validate_membership_dependencies(user_id, organization_id, workspace_id, role_id)
        if self.membership_repository.exists_conflict(None, organization_id, workspace_id, user_id, role_id):
            raise ValueError("Membership already exists for the same user, scope, and role")
        now = utc_now()
        membership = Membership(
            id=str(uuid.uuid4()),
            organization_id=organization_id,
            workspace_id=workspace_id,
            user_id=user_id,
            role_id=role_id,
            status=status,
            created_at=now,
            updated_at=now,
        )
        logger.info(
            "TENANT_ADMIN_SERVICE: create_membership membership_id=%s user_id=%s organization_id=%s workspace_id=%s role_id=%s",
            membership.id,
            user_id,
            organization_id,
            workspace_id,
            role_id,
        )
        return self.membership_repository.create(membership)

    def update_membership(self, membership_id: str, updates: dict):
        """更新成员关系，并保持作用域关系合法。"""
        membership = self.membership_repository.get(membership_id)
        if membership is None:
            raise ValueError("Membership not found")
        next_user_id = updates.get("user_id", membership.user_id)
        next_organization_id = updates.get("organization_id", membership.organization_id)
        next_workspace_id = updates.get("workspace_id", membership.workspace_id)
        next_role_id = updates.get("role_id", membership.role_id)
        if next_workspace_id and next_organization_id is None:
            workspace = self.workspace_repository.get(next_workspace_id)
            next_organization_id = workspace.organization_id if workspace else next_organization_id
            updates = {**updates, "organization_id": next_organization_id}
        self._validate_membership_dependencies(next_user_id, next_organization_id, next_workspace_id, next_role_id)
        if self.membership_repository.exists_conflict(
            membership_id,
            next_organization_id,
            next_workspace_id,
            next_user_id,
            next_role_id,
        ):
            raise ValueError("Membership already exists for the same user, scope, and role")
        logger.info(
            "TENANT_ADMIN_SERVICE: update_membership membership_id=%s fields=%s",
            membership_id,
            sorted(updates.keys()),
        )
        return self.membership_repository.update(membership_id, updates)

    def delete_membership(self, membership_id: str):
        """删除单条成员关系。"""
        membership = self.membership_repository.get(membership_id)
        if membership is None:
            raise ValueError("Membership not found")
        self.membership_repository.delete(membership_id)
        logger.info("TENANT_ADMIN_SERVICE: delete_membership membership_id=%s", membership_id)
        return {"status": "deleted", "id": membership_id}

    def _validate_membership_dependencies(
        self,
        user_id: str,
        organization_id: str | None,
        workspace_id: str | None,
        role_id: str | None,
    ) -> None:
        """确保成员关系指向的对象存在且作用域一致。"""
        if self.user_repository.get(user_id) is None:
            raise ValueError("User not found")
        if organization_id and self.organization_repository.get(organization_id) is None:
            raise ValueError("Organization not found")
        workspace = self.workspace_repository.get(workspace_id) if workspace_id else None
        if workspace_id and workspace is None:
            raise ValueError("Workspace not found")
        if role_id and self.role_repository.get(role_id) is None:
            raise ValueError("Role not found")
        if workspace and organization_id and workspace.organization_id and workspace.organization_id != organization_id:
            raise ValueError("Workspace does not belong to the provided organization")
