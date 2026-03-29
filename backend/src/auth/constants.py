"""认证与权限常量。"""

ACCESS_TOKEN_COOKIE = "dramalab_access_token"
LEGACY_ACCESS_TOKEN_COOKIE = "lumenx_access_token"
REFRESH_TOKEN_COOKIE = "dramalab_refresh_token"
LEGACY_REFRESH_TOKEN_COOKIE = "lumenx_refresh_token"

ROLE_PLATFORM_SUPER_ADMIN = "platform_super_admin"
ROLE_INDIVIDUAL_CREATOR = "individual_creator"
ROLE_ORG_ADMIN = "org_admin"
ROLE_PRODUCER = "producer"

CAP_PLATFORM_MANAGE = "platform.manage"
CAP_ORG_MANAGE = "org.manage"
CAP_WORKSPACE_MANAGE_MEMBERS = "workspace.manage_members"
CAP_WORKSPACE_MANAGE_BILLING = "workspace.manage_billing"
CAP_WORKSPACE_VIEW = "workspace.view"
CAP_PROJECT_CREATE = "project.create"
CAP_PROJECT_EDIT = "project.edit"
CAP_PROJECT_DELETE = "project.delete"
CAP_ASSET_EDIT = "asset.edit"
CAP_TASK_RUN = "task.run"

ROLE_CAPABILITIES = {
    ROLE_PLATFORM_SUPER_ADMIN: {
        CAP_PLATFORM_MANAGE,
        CAP_ORG_MANAGE,
        CAP_WORKSPACE_MANAGE_MEMBERS,
        CAP_WORKSPACE_MANAGE_BILLING,
        CAP_WORKSPACE_VIEW,
        CAP_PROJECT_CREATE,
        CAP_PROJECT_EDIT,
        CAP_PROJECT_DELETE,
        CAP_ASSET_EDIT,
        CAP_TASK_RUN,
    },
    ROLE_INDIVIDUAL_CREATOR: {
        CAP_WORKSPACE_VIEW,
        CAP_PROJECT_CREATE,
        CAP_PROJECT_EDIT,
        CAP_PROJECT_DELETE,
        CAP_ASSET_EDIT,
        CAP_TASK_RUN,
    },
    ROLE_ORG_ADMIN: {
        CAP_ORG_MANAGE,
        CAP_WORKSPACE_MANAGE_MEMBERS,
        CAP_WORKSPACE_MANAGE_BILLING,
        CAP_WORKSPACE_VIEW,
        CAP_PROJECT_CREATE,
        CAP_PROJECT_EDIT,
        CAP_PROJECT_DELETE,
        CAP_ASSET_EDIT,
        CAP_TASK_RUN,
    },
    ROLE_PRODUCER: {
        CAP_WORKSPACE_VIEW,
        CAP_PROJECT_CREATE,
        CAP_PROJECT_EDIT,
        CAP_ASSET_EDIT,
        CAP_TASK_RUN,
    },
}

SYSTEM_ROLES = [
    (ROLE_PLATFORM_SUPER_ADMIN, "系统管理员", "平台级超级管理员，拥有全局管理权限。"),
    (ROLE_INDIVIDUAL_CREATOR, "个人用户", "个人创作者，仅管理自己的个人空间。"),
    (ROLE_ORG_ADMIN, "组织管理员", "MCN 或短剧公司管理员，负责组织和成员管理。"),
    (ROLE_PRODUCER, "制作人员", "普通制作人员，在被授权工作区内参与创作生产。"),
]
