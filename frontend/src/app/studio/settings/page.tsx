"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronRight, KeyRound, Palette, Settings2, Shield, UserRound, Users2, X } from "lucide-react";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function StudioSettingsRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const changePassword = useAuthStore((state) => state.changePassword);
  const canManageOrganization = hasCapability("org.manage") || me?.current_role_code === "individual_creator";

  const currentWorkspaceId = me?.current_workspace_id;
  const currentWorkspace = useMemo(() => {
    if (!me?.workspaces?.length || !currentWorkspaceId) {
      return undefined;
    }
    return me.workspaces.find((item) => item.workspace_id === currentWorkspaceId);
  }, [currentWorkspaceId, me?.workspaces]);

  const [organizationName, setOrganizationName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const hasOrganizationChanges = organizationName.trim() !== (currentWorkspace?.organization_name || "").trim();
  const hasWorkspaceChanges = workspaceName.trim() !== (currentWorkspace?.workspace_name || "").trim();
  const passwordMismatch = Boolean(newPassword.trim() && confirmNewPassword.trim() && newPassword !== confirmNewPassword);

  useEffect(() => {
    setOrganizationName(currentWorkspace?.organization_name || "");
    setWorkspaceName(currentWorkspace?.workspace_name || "");
  }, [currentWorkspace?.organization_name, currentWorkspace?.workspace_name]);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timeoutId = globalThis.setTimeout(() => setMessage(null), 4500);
    return () => globalThis.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timeoutId = globalThis.setTimeout(() => setError(null), 6500);
    return () => globalThis.clearTimeout(timeoutId);
  }, [error]);

  return (
    <div className="space-y-6 pb-16">
      {(message || error) && (
        <div className="flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm bg-white">
          <div
            className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md ${
              error ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
            }`}
          >
            {error ? <X size={16} /> : <Check size={16} />}
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">{error ? "操作失败" : "已完成"}</div>
            <div className={`mt-0.5 text-sm ${error ? "text-rose-700" : "text-emerald-700"}`}>{error || message}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setError(null);
            }}
            className="mt-0.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭提示"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Settings2 size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{me?.user.display_name || me?.user.email || "账号信息"}</div>
                <div className="truncate text-xs text-slate-500">{me?.user.email || "—"}</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
              <UserRound size={12} />
              {me?.current_role_name || me?.current_role_code || "未分配角色"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
              <KeyRound size={12} />
              {currentWorkspace?.workspace_name || "未选择工作区"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">显示名称</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">{me?.user.display_name || "未设置"}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">组织</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">{currentWorkspace?.organization_name || "未设置"}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">工作区</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">{currentWorkspace?.workspace_name || "未选择"}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">权限</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">
              {me?.is_platform_super_admin ? "平台超级管理员" : canManageOrganization ? "组织管理员" : "成员"}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-3">
          <div className="sticky top-6 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            <a
              href="#account"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              账号资料
              <ChevronRight size={16} className="text-slate-400" />
            </a>
            <a
              href="#security"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              安全
              <ChevronRight size={16} className="text-slate-400" />
            </a>
            <a
              href="#workspace"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              工作区资料
              <ChevronRight size={16} className="text-slate-400" />
            </a>
            <a
              href="#preferences"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              偏好
              <ChevronRight size={16} className="text-slate-400" />
            </a>
            <a
              href="#shortcuts"
              className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              快捷入口
              <ChevronRight size={16} className="text-slate-400" />
            </a>
          </div>
        </aside>

        <div className="space-y-6 lg:col-span-9">
          <section id="account" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-24">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">账号资料</div>
                <div className="mt-0.5 text-xs text-slate-500">显示名称与邮箱用于后台识别与协作邀请。</div>
              </div>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">显示名称</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{me?.user.display_name || "未设置"}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">电子邮箱</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{me?.user.email || "未设置"}</div>
              </div>
            </div>
          </section>

          <section id="security" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-24">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Shield size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">安全</div>
                <div className="mt-0.5 text-xs text-slate-500">建议定期更新密码，避免多人共享同一密码。</div>
              </div>
            </div>

            <form
              className="grid gap-4 p-5 sm:grid-cols-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!currentPassword.trim() || !newPassword.trim() || passwordMismatch || savingPassword) {
                  return;
                }
                try {
                  setError(null);
                  setMessage(null);
                  setSavingPassword(true);
                  await changePassword({ currentPassword, newPassword });
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setMessage("密码已更新");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "密码修改失败");
                } finally {
                  setSavingPassword(false);
                }
              }}
            >
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-600">当前密码</div>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="验证身份"
                  autoComplete="current-password"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#409eff] focus:ring-4 focus:ring-[#409eff]/15"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold text-slate-600">新密码</div>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="至少 6 位字符"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#409eff] focus:ring-4 focus:ring-[#409eff]/15"
                />
              </label>
              <label className="block sm:col-span-2">
                <div className="mb-1 text-xs font-semibold text-slate-600">确认新密码</div>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  placeholder="再输入一次"
                  autoComplete="new-password"
                  className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-4 ${
                    passwordMismatch
                      ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15"
                      : "border-slate-200 focus:border-[#409eff] focus:ring-[#409eff]/15"
                  }`}
                />
                {passwordMismatch ? <div className="mt-1 text-xs font-semibold text-rose-600">两次输入的新密码不一致</div> : null}
              </label>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:col-span-2">
                <div className="text-xs text-amber-800">
                  初始密码为 <span className="font-mono font-semibold">123456</span>。建议首次登录后立刻修改。
                </div>
                <button
                  type="submit"
                  disabled={!currentPassword.trim() || !newPassword.trim() || passwordMismatch || savingPassword}
                  className="shrink-0 rounded-md bg-[#409eff] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#2f8fe6] active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-[#409eff]"
                >
                  {savingPassword ? "更新中..." : "更新密码"}
                </button>
              </div>
            </form>
          </section>

          <section id="workspace" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-24">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Building2 size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">工作区资料</div>
                <div className="mt-0.5 text-xs text-slate-500">组织与工作区名称会展示在后台与邀请链接中。</div>
              </div>
            </div>

            <div className="grid gap-5 p-5">
              {canManageOrganization ? (
                <>
                  <form
                    className="grid gap-3"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!organizationName.trim() || !hasOrganizationChanges || savingOrg) {
                        return;
                      }
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
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-600">组织名称</div>
                      {hasOrganizationChanges ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                          未保存变更
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={organizationName}
                        onChange={(event) => setOrganizationName(event.target.value)}
                        placeholder="输入组织或团队名称"
                        className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#409eff] focus:ring-4 focus:ring-[#409eff]/15"
                      />
                      <button
                        type="submit"
                        disabled={!organizationName.trim() || !hasOrganizationChanges || savingOrg}
                        className="rounded-md bg-[#409eff] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#2f8fe6] active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-[#409eff]"
                      >
                        {savingOrg ? "保存中..." : "保存"}
                      </button>
                    </div>
                  </form>

                  <form
                    className="grid gap-3"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!workspaceName.trim() || !hasWorkspaceChanges || savingWorkspace) {
                        return;
                      }
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
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-600">工作区名称</div>
                      {hasWorkspaceChanges ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                          未保存变更
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={workspaceName}
                        onChange={(event) => setWorkspaceName(event.target.value)}
                        placeholder="输入工作区名称"
                        className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#409eff] focus:ring-4 focus:ring-[#409eff]/15"
                      />
                      <button
                        type="submit"
                        disabled={!workspaceName.trim() || !hasWorkspaceChanges || savingWorkspace}
                        className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50"
                      >
                        {savingWorkspace ? "保存中..." : "保存"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">当前所属工作区</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{currentWorkspace?.workspace_name || "未选择"}</div>
                </div>
              )}

              {hasCapability("org.manage") ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-600">管理员配置边界</div>
                  <div className="mt-1 text-sm text-slate-700">
                    组织资料、成员角色与协作治理入口集中在团队协同；平台级模型配置仅对平台超级管理员开放。
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/studio/team"
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      前往团队协同
                      <ChevronRight size={16} className="text-slate-400" />
                    </Link>
                    {me?.is_platform_super_admin ? (
                      <Link
                        href="/studio/model-config"
                        className="inline-flex items-center gap-2 rounded-md bg-[#409eff] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#2f8fe6]"
                      >
                        前往模型配置
                        <ChevronRight size={16} className="text-white/80" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section id="preferences" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-24">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Settings2 size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">偏好</div>
                <div className="mt-0.5 text-xs text-slate-500">用于控制后台提醒与个人使用习惯（逐步上线）。</div>
              </div>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-600">通知偏好</div>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500">
                    即将上线
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-700">
                  后续将支持任务进度通知、协作邀请提醒与资源消耗预警。
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold text-slate-600">工作区默认策略</div>
                <div className="mt-2 text-sm text-slate-700">
                  当前以系统默认策略为准；团队管理员可在治理页面统一配置。
                </div>
              </div>
            </div>
          </section>

          <section id="shortcuts" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-24">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <Palette size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">快捷入口</div>
                <div className="mt-0.5 text-xs text-slate-500">把常用的治理与沉淀入口集中在一处。</div>
              </div>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Link
                href="/studio/styles"
                className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-[#409eff]/40 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700 group-hover:bg-[#409eff]/10 group-hover:text-[#409eff]">
                      <Palette size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">美术风格策略</div>
                      <div className="mt-0.5 text-xs text-slate-500">沉淀风格模板，跨项目复用</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-[#409eff]" />
                </div>
              </Link>

              <Link
                href="/studio/team"
                className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-[#409eff]/40 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700 group-hover:bg-[#409eff]/10 group-hover:text-[#409eff]">
                      <Users2 size={18} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">团队协同</div>
                      <div className="mt-0.5 text-xs text-slate-500">成员、角色与协作边界</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-[#409eff]" />
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
