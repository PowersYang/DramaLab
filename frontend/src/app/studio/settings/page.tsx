"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function StudioSettingsRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const canManageOrganization = hasCapability("org.manage") || me?.current_role_code === "individual_creator";

  const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
  const [organizationName, setOrganizationName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasOrganizationChanges = organizationName.trim() !== (currentWorkspace?.organization_name || "").trim();
  const hasWorkspaceChanges = workspaceName.trim() !== (currentWorkspace?.workspace_name || "").trim();

  useEffect(() => {
    setOrganizationName(currentWorkspace?.organization_name || "");
    setWorkspaceName(currentWorkspace?.workspace_name || "");
  }, [currentWorkspace?.organization_name, currentWorkspace?.workspace_name]);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="studio-panel p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Account</p>
        <h2 className="mt-4 text-2xl font-bold text-slate-950">账号资料</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-600">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="font-semibold text-slate-900">显示名称</div>
            <div className="mt-1">{me?.user.display_name || "未设置"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="font-semibold text-slate-900">邮箱</div>
            <div className="mt-1">{me?.user.email || "未设置"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="font-semibold text-slate-900">当前角色</div>
            <div className="mt-1">{me?.current_role_name || me?.current_role_code || "未分配"}</div>
          </div>
        </div>
      </section>

      <section className="studio-panel p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Workspace</p>
        <h2 className="mt-4 text-2xl font-bold text-slate-950">工作区展示与资料</h2>
        <div className="mt-6 space-y-3 text-sm text-slate-600">
          {canManageOrganization ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="font-semibold text-slate-900">组织名称</div>
                <p className="mt-1 text-xs leading-6 text-slate-500">用于团队展示、邀请邮件和工作区切换器中的组织名称。</p>
                <input
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                />
                {hasOrganizationChanges ? <div className="mt-2 text-xs text-amber-700">你有未保存的组织名称变更。</div> : null}
                <button
                  disabled={!organizationName.trim() || !hasOrganizationChanges || savingOrg}
                  onClick={async () => {
                    try {
                      setError(null);
                      setMessage(null);
                      setSavingOrg(true);
                      await api.updateCurrentOrganization(organizationName.trim());
                      await bootstrapAuth();
                      setMessage("组织名称已更新");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "组织名称更新失败");
                    } finally {
                      setSavingOrg(false);
                    }
                  }}
                  className="mt-3 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {savingOrg ? "保存中..." : "保存组织名称"}
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="font-semibold text-slate-900">当前工作区</div>
                <p className="mt-1 text-xs leading-6 text-slate-500">用于顶部工作区切换、团队邀请归属和成员协作识别。</p>
                <input
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                />
                {hasWorkspaceChanges ? <div className="mt-2 text-xs text-amber-700">你有未保存的工作区名称变更。</div> : null}
                <button
                  disabled={!workspaceName.trim() || !hasWorkspaceChanges || savingWorkspace}
                  onClick={async () => {
                    try {
                      setError(null);
                      setMessage(null);
                      setSavingWorkspace(true);
                      await api.updateCurrentWorkspace(workspaceName.trim());
                      await bootstrapAuth();
                      setMessage("工作区名称已更新");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "工作区名称更新失败");
                    } finally {
                      setSavingWorkspace(false);
                    }
                  }}
                  className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  {savingWorkspace ? "保存中..." : "保存工作区名称"}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="font-semibold text-slate-900">当前工作区</div>
              <div className="mt-1">{currentWorkspace?.workspace_name || "未选择"}</div>
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="font-semibold text-slate-900">通知偏好</div>
            <div className="mt-1">首版先使用系统默认策略，后续会开放任务通知、团队邀请与运营通知配置。</div>
          </div>
          {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message} 头部工作区信息已同步刷新。</div> : null}
          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </div>
      </section>

      {hasCapability("org.manage") ? (
        <section className="studio-panel p-6 xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Admin</p>
          <h2 className="mt-4 text-2xl font-bold text-slate-950">管理员可见配置边界</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
            当前版本已经把普通用户与管理员的设置边界拆开。组织资料、工作区命名、权限策略与审计入口可以继续在这里扩展，系统级模型配置则已经迁移到单独的模型配置导航页。
          </p>
          {me?.is_platform_super_admin ? (
            <div className="mt-5">
              <Link
                href="/studio/model-config"
                className="inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                前往模型配置
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
