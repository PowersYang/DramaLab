"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, Palette, Settings2, UserRound } from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function StudioSettingsRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const bootstrapAuth = useAuthStore((state) => state.bootstrapAuth);
  const changePassword = useAuthStore((state) => state.changePassword);
  const canManageOrganization = hasCapability("org.manage") || me?.current_role_code === "individual_creator";

  const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
  const [organizationName, setOrganizationName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const hasOrganizationChanges = organizationName.trim() !== (currentWorkspace?.organization_name || "").trim();
  const hasWorkspaceChanges = workspaceName.trim() !== (currentWorkspace?.workspace_name || "").trim();

  useEffect(() => {
    setOrganizationName(currentWorkspace?.organization_name || "");
    setWorkspaceName(currentWorkspace?.workspace_name || "");
  }, [currentWorkspace?.organization_name, currentWorkspace?.workspace_name]);

  const summaryItems = useMemo(
    () => [
      { label: "显示名称", value: me?.user.display_name || "未设置", note: "当前账号对外展示名称", icon: UserRound },
      { label: "当前角色", value: me?.current_role_name || me?.current_role_code || "未分配", note: "决定设置与治理边界", icon: Settings2 },
      { label: "组织名称", value: currentWorkspace?.organization_name || "未设置", note: "团队、邀请和账本归属所见名称", icon: Building2 },
      { label: "工作区", value: currentWorkspace?.workspace_name || "未选择", note: "顶部切换器和协作识别使用", icon: KeyRound },
    ],
    [currentWorkspace?.organization_name, currentWorkspace?.workspace_name, me?.current_role_code, me?.current_role_name, me?.user.display_name],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
        <AdminSummaryStrip items={summaryItems} />
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        {/* 左侧：账号与安全 */}
        <div className="space-y-8 lg:col-span-7 animate-in fade-in slide-in-from-left-4 duration-700 delay-150">
          <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
            <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <UserRound size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">账号资料与安全</h3>
                  <p className="text-sm text-slate-500">管理个人信息与账号访问安全</p>
                </div>
              </div>
            </div>

            <div className="px-8 py-8">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="group rounded-2xl border border-slate-100 bg-white p-5 transition-all hover:border-indigo-100 hover:shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-indigo-400">显示名称</div>
                  <div className="mt-2 text-base font-bold text-slate-900">{me?.user.display_name || "未设置"}</div>
                </div>
                <div className="group rounded-2xl border border-slate-100 bg-white p-5 transition-all hover:border-indigo-100 hover:shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-indigo-400">电子邮箱</div>
                  <div className="mt-2 text-base font-bold text-slate-900">{me?.user.email || "未设置"}</div>
                </div>
              </div>

              <div className="mt-10">
                <div className="mb-6 flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-indigo-400" />
                  <h4 className="text-sm font-bold uppercase tracking-wider text-slate-900">修改登录密码</h4>
                </div>
                
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500 ml-1">当前密码</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder="验证身份"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3 text-slate-900 transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500 ml-1">新密码</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="至少 6 位字符"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3 text-slate-900 transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none"
                    />
                  </div>
                </div>

                <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl bg-amber-50/50 p-4 border border-amber-100/50">
                  <p className="text-xs leading-relaxed text-amber-700/80">
                    定期更换密码有助于保障资产安全。初始密码为 <code className="font-mono font-bold bg-amber-100 px-1 rounded">123456</code>。
                  </p>
                  <button
                    disabled={!currentPassword.trim() || !newPassword.trim() || savingPassword}
                    onClick={async () => {
                      try {
                        setError(null);
                        setMessage(null);
                        setSavingPassword(true);
                        await changePassword({ currentPassword, newPassword });
                        setCurrentPassword("");
                        setNewPassword("");
                        setMessage("密码已更新");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "密码修改失败");
                      } finally {
                        setSavingPassword(false);
                      }
                    }}
                    className="shrink-0 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:hover:bg-slate-900"
                  >
                    {savingPassword ? "更新中..." : "更新密码"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {hasCapability("org.manage") ? (
            <section className="studio-panel border-none bg-indigo-600 p-8 shadow-xl shadow-indigo-500/20 text-white overflow-hidden relative group">
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl transition-all group-hover:scale-150" />
              <div className="relative z-10">
                <h3 className="text-xl font-bold">管理员配置边界</h3>
                <p className="mt-3 text-indigo-100 leading-relaxed max-w-lg">
                  当前版本已拆分普通用户与管理员设置。组织资料、成员权限策略与审计入口在此管理；系统级模型编排已迁移至独立页面。
                </p>
                {me?.is_platform_super_admin ? (
                  <Link 
                    href="/studio/model-config" 
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-indigo-600 transition-all hover:bg-indigo-50 hover:shadow-lg active:scale-95"
                  >
                    前往模型资源编排
                    <Settings2 size={16} />
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        {/* 右侧：工作区与偏好 */}
        <div className="space-y-8 lg:col-span-5 animate-in fade-in slide-in-from-right-4 duration-700 delay-300">
          <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
            <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">工作区展示与资料</h3>
                  <p className="text-sm text-slate-500">维护组织与工作区对外展示信息</p>
                </div>
              </div>
            </div>

            <div className="px-8 py-8 space-y-8">
              {canManageOrganization ? (
                <>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">组织名称</label>
                      {hasOrganizationChanges && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">未保存变更</span>}
                    </div>
                    <div className="flex gap-2">
                      <input 
                        value={organizationName} 
                        onChange={(event) => setOrganizationName(event.target.value)}
                        placeholder="输入组织或团队名称"
                        className="flex-1 rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3 text-slate-900 transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none"
                      />
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
                        className="rounded-2xl bg-slate-900 px-6 font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30 disabled:hover:bg-slate-900"
                      >
                        {savingOrg ? "..." : "保存"}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">工作区名称</label>
                      {hasWorkspaceChanges && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">未保存变更</span>}
                    </div>
                    <div className="flex gap-2">
                      <input 
                        value={workspaceName} 
                        onChange={(event) => setWorkspaceName(event.target.value)}
                        placeholder="输入工作区名称"
                        className="flex-1 rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-3 text-slate-900 transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none"
                      />
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
                        className="rounded-2xl bg-white border border-slate-200 px-6 font-bold text-slate-900 transition-all hover:border-indigo-200 hover:text-indigo-600 active:scale-95 disabled:opacity-30"
                      >
                        {savingWorkspace ? "..." : "保存"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">当前所属工作区</div>
                  <div className="mt-2 text-base font-bold text-slate-900">{currentWorkspace?.workspace_name || "未选择"}</div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">通知偏好策略</div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">即将上线</span>
                </div>
                <div className="mt-3 text-sm leading-relaxed text-slate-500">
                  当前使用系统默认策略。后续将开放任务进度通知、团队协作邀请与资源消耗预警配置。
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                    <Palette size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">自定义美术风格库</h4>
                    <p className="mt-1 text-xs text-slate-500">统一管理并复用你沉淀的视觉风格</p>
                  </div>
                </div>
                <Link href="/studio/styles" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-white border border-indigo-100 py-3 text-sm font-bold text-indigo-600 shadow-sm transition-all hover:bg-indigo-600 hover:text-white hover:border-indigo-600 active:scale-95">
                  前往风格管理 <Palette size={14} />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 全局消息提示 */}
      <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 space-y-3 pointer-events-none">
        {message && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
              <svg size={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            {message}
          </div>
        )}
        {error && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-rose-600 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-rose-600">
              <X size={12} strokeWidth={3} />
            </div>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
