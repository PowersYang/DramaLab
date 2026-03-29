"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Boxes, CreditCard, FolderKanban, LayoutDashboard, Library, Settings2, Users2, Workflow } from "lucide-react";

import DramaLabBranding from "@/components/layout/DramaLabBranding";
import { useAuthStore } from "@/store/authStore";

interface StudioShellProps {
  children: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}

interface StudioNavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability: string;
  requiresPlatformSuperAdmin?: boolean;
}

const NAV_ITEMS: StudioNavItem[] = [
  { href: "/studio", label: "总览", icon: LayoutDashboard, capability: "workspace.view" },
  { href: "/studio/projects", label: "项目中心", icon: FolderKanban, capability: "workspace.view" },
  { href: "/studio/library", label: "资产库", icon: Library, capability: "workspace.view" },
  { href: "/studio/tasks", label: "任务中心", icon: Workflow, capability: "task.run" },
  { href: "/studio/team", label: "团队", icon: Users2, capability: "workspace.manage_members" },
  { href: "/studio/billing", label: "计费", icon: CreditCard, capability: "workspace.manage_billing" },
  { href: "/studio/model-config", label: "模型配置", icon: Boxes, capability: "workspace.view", requiresPlatformSuperAdmin: true },
  { href: "/studio/settings", label: "设置", icon: Settings2, capability: "workspace.view" },
];

export default function StudioShell({ children, title, description, actions }: StudioShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useAuthStore((state) => state.me);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const signOut = useAuthStore((state) => state.signOut);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!hasCapability(item.capability)) {
      return false;
    }
    if (item.requiresPlatformSuperAdmin && !me?.is_platform_super_admin) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    // 中文注释：用户进入 Studio 后，后台预取可见导航页，避免第一次点击左侧导航时再临时加载路由资源。
    visibleNavItems.forEach((item) => {
      if (item.href !== pathname) {
        router.prefetch(item.href);
      }
    });
  }, [pathname, router, visibleNavItems]);

  return (
    <div className="flex min-h-screen bg-[#f4f5f7] text-slate-900">
      <aside className="hidden w-[208px] flex-col border-r border-slate-200 bg-[#f8f6f2] px-3 py-6 lg:flex">
        <Link href="/studio" className="block">
          <DramaLabBranding size="sm" showSlogan={false} />
        </Link>

        <nav className="mt-4 space-y-2">
          {visibleNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/studio" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-600 hover:bg-white hover:text-slate-950"
                }`}
              >
                <Icon size={18} className={isActive ? "text-white" : "text-primary"} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-10">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
              <p className="mt-2 text-sm text-slate-500">{description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start lg:self-center">
              {me?.workspaces?.length ? (
                <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                  <span>工作区</span>
                  <select
                    value={me.current_workspace_id || ""}
                    disabled={isSwitchingWorkspace}
                    onChange={async (event) => {
                      if (!event.target.value || event.target.value === me.current_workspace_id) return;
                      setIsSwitchingWorkspace(true);
                      try {
                        await switchWorkspace(event.target.value);
                        router.refresh();
                      } finally {
                        setIsSwitchingWorkspace(false);
                      }
                    }}
                    className="bg-transparent font-semibold text-slate-900 outline-none"
                  >
                    {me.workspaces.map((workspace) => (
                      <option key={workspace.workspace_id} value={workspace.workspace_id}>
                        {workspace.organization_name || "组织"} / {workspace.workspace_name || "工作区"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {me ? (
                <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">{me.user.display_name || me.user.email || "DramaLab 用户"}</span>
                  <span className="ml-2 text-slate-400">{me.current_role_name || "成员"}</span>
                </div>
              ) : null}
              {actions}
              <button
                onClick={() => {
                  void signOut().then(() => router.replace("/signin"));
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                退出登录
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
