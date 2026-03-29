"use client";

import StudioShell from "@/components/studio/StudioShell";
import PlatformModelAdmin from "@/components/studio/PlatformModelAdmin";
import { useAuthStore } from "@/store/authStore";

export default function StudioSettingsRoutePage() {
  const me = useAuthStore((state) => state.me);
  const hasCapability = useAuthStore((state) => state.hasCapability);

  return (
    <StudioShell title="工作台设置" description="根据当前角色收敛账号、工作区与管理员配置边界。">
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
          <h2 className="mt-4 text-2xl font-bold text-slate-950">工作区展示与通知</h2>
          <div className="mt-6 space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="font-semibold text-slate-900">当前工作区</div>
              <div className="mt-1">
                {me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id)?.workspace_name || "未选择"}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="font-semibold text-slate-900">通知偏好</div>
              <div className="mt-1">首版先使用系统默认策略，后续会开放任务通知、团队邀请与运营通知配置。</div>
            </div>
          </div>
        </section>

        {hasCapability("org.manage") ? (
          <section className="studio-panel p-6 xl:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Admin</p>
            <h2 className="mt-4 text-2xl font-bold text-slate-950">管理员可见配置边界</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              当前版本已经把普通用户与管理员的设置边界拆开。后续可以在这里承接组织资料、工作区命名、权限策略、供应商配置和审计入口，但不会把系统密钥暴露给普通成员。
            </p>
          </section>
        ) : null}

        {me?.is_platform_super_admin ? <PlatformModelAdmin /> : null}
      </div>
    </StudioShell>
  );
}
