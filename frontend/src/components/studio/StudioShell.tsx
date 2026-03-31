"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Boxes, ChevronDown, Clapperboard, CreditCard, FolderKanban, LayoutDashboard, Library, Palette, Settings2, SlidersHorizontal, Users2, WalletCards, Workflow } from "lucide-react";

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
  shortLabel: string;
  hint: string;
  icon: typeof LayoutDashboard;
  capability: string;
  section: "overview" | "planning" | "execution" | "operations" | "governance";
  requiresPlatformSuperAdmin?: boolean;
}

const NAV_ITEMS: StudioNavItem[] = [
  { href: "/studio", label: "工作台总览", shortLabel: "总览", hint: "经营态势、告警与生产信号", icon: LayoutDashboard, capability: "workspace.view", section: "overview" },
  { href: "/studio/projects", label: "项目与系列", shortLabel: "项目", hint: "剧本母体、系列编排与单集台账", icon: FolderKanban, capability: "workspace.view", section: "planning" },
  { href: "/studio/library", label: "角色场景资产", shortLabel: "资产", hint: "角色、场景、道具与复用资源", icon: Library, capability: "workspace.view", section: "planning" },
  { href: "/studio/styles", label: "美术风格策略", shortLabel: "风格", hint: "视觉风格沉淀与项目复用", icon: Palette, capability: "workspace.view", section: "planning" },
  { href: "/studio/tasks", label: "生产调度中心", shortLabel: "任务", hint: "分镜、视频与异步任务队列", icon: Workflow, capability: "task.run", section: "execution" },
  { href: "/studio/team", label: "团队协同", shortLabel: "团队", hint: "成员、角色与协作边界", icon: Users2, capability: "workspace.manage_members", section: "operations" },
  { href: "/studio/billing", label: "算力与成本", shortLabel: "成本", hint: "算力消耗、扣费和预算感知", icon: CreditCard, capability: "workspace.view", section: "operations" },
  { href: "/studio/settings", label: "工作台设置", shortLabel: "设置", hint: "账号、工作区与系统偏好", icon: Settings2, capability: "workspace.view", section: "operations" },
  { href: "/studio/billing-admin", label: "平台计费规则", shortLabel: "计费", hint: "扣费规则、赠送策略与手工充值", icon: WalletCards, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
  { href: "/studio/model-config", label: "模型资源编排", shortLabel: "模型", hint: "模型目录、供应商与可见范围", icon: Boxes, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
  { href: "/studio/task-concurrency", label: "并发与执行位", shortLabel: "并发", hint: "组织级执行配额与任务上限", icon: SlidersHorizontal, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
];

const SECTION_LABELS: Record<StudioNavItem["section"], string> = {
  overview: "控制台总览",
  planning: "内容策划",
  execution: "生产执行",
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

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
      (["overview", "planning", "execution", "operations", "governance"] as const)
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
    setIsUserMenuOpen(false);
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

    const timeoutId = globalThis.setTimeout(scheduleWarmup, 160);
    return () => globalThis.clearTimeout(timeoutId);
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
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {isActive ? <span className="studio-nav-pill">{item.shortLabel}</span> : null}
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
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold studio-strong">
                <Clapperboard size={14} />
                Production Console
              </div>
            </div>
            <div className="rounded-[1rem] border border-slate-200/80 bg-white/70 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">Focus</div>
              <div className="mt-2 text-sm studio-muted">让项目编排、任务执行与异常处理在同一套后台节奏里完成。</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="studio-app-topbar">
          <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.04em] studio-strong lg:text-[2.2rem]">{title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start lg:justify-end">
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
                    className="studio-select min-w-[320px] border-none bg-transparent px-0 py-0 font-semibold shadow-none"
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
                <div className="relative">
                  <button type="button" onClick={() => setIsUserMenuOpen((value) => !value)} className="studio-control-chip">
                    <span className="font-semibold studio-strong">{me.user.display_name || me.user.email || "DramaLab 用户"}</span>
                    <span className="studio-faint">{me.current_role_name || "成员"}</span>
                    <ChevronDown size={14} className="studio-faint" />
                  </button>
                  {isUserMenuOpen ? (
                    <div
                      className="absolute right-0 top-full z-20 mt-2 min-w-[180px] rounded-[14px] border p-2 shadow-xl"
                      style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-strong)" }}
                    >
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          void signOut().then(() => router.replace("/?auth=signin"));
                        }}
                        className="flex w-full items-center rounded-[10px] px-3 py-2 text-sm font-semibold studio-muted hover:bg-slate-50"
                      >
                        退出登录
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {actions}
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
