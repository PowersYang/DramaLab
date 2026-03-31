"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Boxes, CreditCard, FolderKanban, LayoutDashboard, Library, Palette, Search, Settings2, SlidersHorizontal, Users2, WalletCards, Workflow } from "lucide-react";

import DramaLabBranding from "@/components/layout/DramaLabBranding";
import { api } from "@/lib/api";
import {
  isStudioCacheFresh,
  loadStudioCacheResource,
  STUDIO_PROJECT_SUMMARIES_CACHE_KEY,
  STUDIO_SERIES_SUMMARIES_CACHE_KEY,
} from "@/lib/studioCache";
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
  section: "workspace" | "operations" | "governance";
  requiresPlatformSuperAdmin?: boolean;
}

const NAV_ITEMS: StudioNavItem[] = [
  { href: "/studio", label: "总览", icon: LayoutDashboard, capability: "workspace.view", section: "workspace" },
  { href: "/studio/projects", label: "项目中心", icon: FolderKanban, capability: "workspace.view", section: "workspace" },
  { href: "/studio/library", label: "资产库", icon: Library, capability: "workspace.view", section: "workspace" },
  { href: "/studio/styles", label: "美术风格", icon: Palette, capability: "workspace.view", section: "workspace" },
  { href: "/studio/tasks", label: "任务中心", icon: Workflow, capability: "task.run", section: "operations" },
  { href: "/studio/team", label: "团队", icon: Users2, capability: "workspace.manage_members", section: "operations" },
  { href: "/studio/billing", label: "算力豆账本", icon: CreditCard, capability: "workspace.view", section: "operations" },
  { href: "/studio/settings", label: "设置", icon: Settings2, capability: "workspace.view", section: "operations" },
  { href: "/studio/billing-admin", label: "计费配置", icon: WalletCards, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
  { href: "/studio/model-config", label: "模型配置", icon: Boxes, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
  { href: "/studio/task-concurrency", label: "任务并发", icon: SlidersHorizontal, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
];

const SECTION_LABELS: Record<StudioNavItem["section"], string> = {
  workspace: "工作区业务",
  operations: "运营协同",
  governance: "平台治理",
};

export default function StudioShell({ children, title, description, actions }: StudioShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useAuthStore((state) => state.me);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const signOut = useAuthStore((state) => state.signOut);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!hasCapability(item.capability)) {
          return false;
        }
        if (item.requiresPlatformSuperAdmin && !me?.is_platform_super_admin) {
          return false;
        }
        return true;
      }),
    [hasCapability, me?.is_platform_super_admin],
  );

  const currentWorkspace = me?.workspaces?.find((workspace) => workspace.workspace_id === me.current_workspace_id);
  const activeNavItem = visibleNavItems.find((item) => pathname === item.href || (item.href !== "/studio" && pathname.startsWith(`${item.href}/`)));
  const navSections = useMemo(
    () =>
      (["workspace", "operations", "governance"] as const)
        .map((section) => ({
          section,
          label: SECTION_LABELS[section],
          items: visibleNavItems.filter((item) => item.section === section),
        }))
        .filter((section) => section.items.length > 0),
    [visibleNavItems],
  );

  useEffect(() => {
    // 中文注释：用户进入 Studio 后，后台预取可见导航页，避免第一次点击左侧导航时再临时加载路由资源。
    visibleNavItems.forEach((item) => {
      if (item.href !== pathname) {
        router.prefetch(item.href);
      }
    });
  }, [pathname, router, visibleNavItems]);

  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const scheduleWarmup = () => {
      // 中文注释：项目中心和任务中心都会复用项目/系列摘要，这里在壳层统一预热，减少切页后的空白等待。
      if (!isStudioCacheFresh(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, 30_000)) {
        void loadStudioCacheResource(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, () => api.getProjectSummaries());
      }
      if (!isStudioCacheFresh(STUDIO_SERIES_SUMMARIES_CACHE_KEY, 30_000)) {
        void loadStudioCacheResource(STUDIO_SERIES_SUMMARIES_CACHE_KEY, () => api.listSeriesSummaries());
      }
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(scheduleWarmup, { timeout: 1000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(scheduleWarmup, 160);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div
      data-studio-theme="light"
      className="studio-theme-root studio-shell-root flex min-h-screen text-slate-900"
    >
      <aside className="studio-app-sidebar hidden w-[248px] flex-col px-4 py-5 lg:flex">
        <div className="studio-app-brand-wrap">
          <Link href="/studio" className="block">
            <DramaLabBranding size="sm" showSlogan={false} />
          </Link>
          <p className="mt-3 text-xs uppercase tracking-[0.28em] studio-faint">Operations Console</p>
          <p className="mt-2 text-sm leading-6 studio-muted">围绕项目、资产、任务、团队与平台配置的统一后台。</p>
        </div>

        <div className="mt-6 space-y-5">
          {navSections.map((group) => (
            <div key={group.section}>
              <div className="px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] studio-faint">{group.label}</p>
              </div>
              <nav className="mt-3 space-y-2">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/studio" && pathname.startsWith(`${item.href}/`));
                  const isPending = pendingPath === item.href && !isActive;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setPendingPath(item.href)}
                      className={`studio-nav-item ${
                        isActive ? "studio-nav-item-active" : "studio-nav-item-idle"
                      }`}
                    >
                      <span className={`studio-nav-icon ${isActive ? "studio-nav-icon-active" : ""}`}>
                        <Icon size={16} />
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {isActive ? <span className="studio-nav-pill">当前</span> : null}
                      {isPending ? <span className="studio-nav-pending-dot" aria-hidden="true" /> : null}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        <div className="studio-side-footer mt-auto">
          <div className="studio-side-footer-label">当前工作区</div>
          <div className="mt-2 text-sm font-semibold studio-strong">
            {currentWorkspace?.workspace_name || "未选择工作区"}
          </div>
          <div className="mt-1 text-xs studio-muted">
            {currentWorkspace?.organization_name || "DramaLab"}
          </div>
          <div className="mt-4 grid gap-2">
            <div className="rounded-[1rem] border border-slate-200/80 bg-white/70 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">Console Mode</div>
              <div className="mt-2 text-sm font-semibold studio-strong">Admin Workspace</div>
            </div>
            <div className="rounded-[1rem] border border-slate-200/80 bg-white/70 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">Route Warmup</div>
              <div className="mt-2 text-sm studio-muted">项目与任务摘要已预热，降低切页等待。</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="studio-app-topbar">
          <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start lg:justify-between lg:px-8">
            <div className="max-w-3xl">
              <div className="studio-eyebrow">Studio Admin</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong lg:text-[2.4rem]">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 studio-muted">{description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="studio-mini-chip">{activeNavItem?.label || "工作台"}</span>
                <span className="studio-mini-chip">{currentWorkspace?.organization_name || "默认组织"}</span>
                <span className="studio-mini-chip">浅色控制台</span>
                <span className="studio-mini-chip">后台管理视图</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start lg:justify-end">
              <div className="studio-control-chip hidden xl:flex">
                <Search size={15} className="studio-faint" />
                <span className="text-sm studio-muted">后台管理视图</span>
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
                  void signOut().then(() => router.replace("/?auth=signin"));
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
