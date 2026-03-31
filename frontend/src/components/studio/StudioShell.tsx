"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Boxes, CreditCard, FolderKanban, LayoutDashboard, Library, Moon, Palette, Search, Settings2, SlidersHorizontal, Sun, Users2, WalletCards, Workflow } from "lucide-react";

import DramaLabBranding from "@/components/layout/DramaLabBranding";
import { persistStudioTheme, readStoredStudioTheme, type StudioTheme } from "@/components/studio/studioTheme";
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
  { href: "/studio/styles", label: "美术风格", icon: Palette, capability: "workspace.view" },
  { href: "/studio/team", label: "团队", icon: Users2, capability: "workspace.manage_members" },
  { href: "/studio/billing", label: "算力豆账本", icon: CreditCard, capability: "workspace.view" },
  { href: "/studio/billing-admin", label: "计费配置", icon: WalletCards, capability: "workspace.view", requiresPlatformSuperAdmin: true },
  { href: "/studio/model-config", label: "模型配置", icon: Boxes, capability: "workspace.view", requiresPlatformSuperAdmin: true },
  { href: "/studio/task-concurrency", label: "任务并发", icon: SlidersHorizontal, capability: "workspace.view", requiresPlatformSuperAdmin: true },
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
  const [theme, setTheme] = useState<StudioTheme>("dark");

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

  useEffect(() => {
    setTheme(readStoredStudioTheme());
  }, []);

  useEffect(() => {
    persistStudioTheme(theme);
  }, [theme]);

  return (
    <div
      data-studio-theme={theme}
      className="studio-theme-root studio-shell-root flex min-h-screen text-slate-100"
    >
      <aside className="studio-app-sidebar hidden w-[248px] flex-col px-4 py-5 lg:flex">
        <div className="studio-app-brand-wrap">
          <Link href="/studio" className="block">
            <DramaLabBranding size="sm" showSlogan={false} />
          </Link>
          <p className="mt-3 text-xs uppercase tracking-[0.28em] studio-faint">AI Manga Studio</p>
          <p className="mt-2 text-sm leading-6 studio-muted">围绕剧本、资产、分镜、视频与运营控制的创作工作台。</p>
        </div>

        <nav className="mt-6 space-y-2">
          {visibleNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/studio" && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`studio-nav-item ${
                  isActive ? "studio-nav-item-active" : "studio-nav-item-idle"
                }`}
              >
                <span className={`studio-nav-icon ${isActive ? "studio-nav-icon-active" : ""}`}>
                  <Icon size={16} />
                </span>
                <span className="flex-1">{item.label}</span>
                {isActive ? <span className="studio-nav-pill">LIVE</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="studio-side-footer mt-auto">
          <div className="studio-side-footer-label">当前工作区</div>
          <div className="mt-2 text-sm font-semibold studio-strong">
            {me?.workspaces?.find((workspace) => workspace.workspace_id === me.current_workspace_id)?.workspace_name || "未选择工作区"}
          </div>
          <div className="mt-1 text-xs studio-muted">
            {me?.workspaces?.find((workspace) => workspace.workspace_id === me.current_workspace_id)?.organization_name || "DramaLab"}
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="studio-app-topbar">
          <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start lg:justify-between lg:px-8">
            <div className="max-w-3xl">
              <div className="studio-eyebrow">Studio Workspace</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong lg:text-[2.4rem]">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 studio-muted">{description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start lg:justify-end">
              <div className="studio-control-chip hidden xl:flex">
                <Search size={15} className="studio-faint" />
                <span className="text-sm studio-muted">创作工作台</span>
              </div>

              <div className="studio-segmented-control">
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                  className={`studio-segmented-option ${theme === "dark" ? "studio-segmented-option-active" : ""}`}
                >
                  <Moon size={14} />
                  深色
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                  className={`studio-segmented-option ${theme === "light" ? "studio-segmented-option-active" : ""}`}
                >
                  <Sun size={14} />
                  浅色
                </button>
              </div>

              {me?.workspaces?.length ? (
                <label className="studio-control-chip">
                  <span className="studio-faint">工作区</span>
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
                    className="studio-select min-w-[220px] border-none bg-transparent px-0 py-0 font-semibold shadow-none"
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
                <div className="studio-control-chip">
                  <span className="font-semibold studio-strong">{me.user.display_name || me.user.email || "DramaLab 用户"}</span>
                  <span className="studio-faint">{me.current_role_name || "成员"}</span>
                </div>
              ) : null}
              {actions}
              <button
                onClick={() => {
                  void signOut().then(() => router.replace("/signin"));
                }}
                className="studio-button studio-button-ghost"
              >
                退出登录
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
