"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AlertCircle, Boxes, ChevronDown, Clapperboard, CreditCard, FolderKanban, LayoutDashboard, Library, Palette, Settings2, SlidersHorizontal, Users2, WalletCards, Workflow, Menu } from "lucide-react";

import AdminBreadcrumbs from "@/components/studio/admin/AdminBreadcrumbs";
import TagsView from "@/components/studio/TagsView";
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
  breadcrumbs: Array<{ label: string; href?: string }>;
  sectionLabel?: string;
  sectionHint?: string;
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
  { href: "/studio/model-config", label: "模型配置", shortLabel: "模型", hint: "模型目录、供应商与可见范围", icon: Boxes, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
  { href: "/studio/task-concurrency", label: "并发与执行位", shortLabel: "并发", hint: "组织级执行配额与任务上限", icon: SlidersHorizontal, capability: "workspace.view", section: "governance", requiresPlatformSuperAdmin: true },
];

const SECTION_LABELS: Record<StudioNavItem["section"], string> = {
  overview: "控制台总览",
  planning: "内容策划",
  execution: "生产执行",
  operations: "运营协同",
  governance: "平台治理",
};

export default function StudioShell({
  children,
  title,
  description,
  breadcrumbs,
  sectionLabel,
  sectionHint,
  actions,
}: StudioShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useAuthStore((state) => state.me);
  const switchWorkspace = useAuthStore((state) => state.switchWorkspace);
  const signOut = useAuthStore((state) => state.signOut);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
    <div className="flex h-screen w-full overflow-hidden bg-[#f0f2f5] text-slate-900">
      {/* Sidebar - Dark theme like vue-element-admin */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[210px] flex-col bg-[#304156] shadow-xl transition-all duration-300 lg:static lg:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[50px] items-center px-4">
          <Link href="/studio" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
              <Clapperboard size={20} />
            </div>
            <span className="text-sm font-bold tracking-tight text-white">DramaLab Console</span>
          </Link>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto py-2">
          {navSections.map((group) => (
            <div key={group.section} className="mb-4">
              <div className="px-5 py-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{group.label}</p>
              </div>
              <nav className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== "/studio" && pathname.startsWith(`${item.href}/`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        setPendingPath(item.href);
                        setIsSidebarOpen(false);
                      }}
                      className={`group flex items-center gap-3 px-5 py-3 text-[13px] transition-all ${
                        isActive
                          ? "bg-[#263445] text-[#409eff]"
                          : "text-[#bfcbd9] hover:bg-[#263445] hover:text-white"
                      }`}
                    >
                      <Icon size={16} className={isActive ? "text-[#409eff]" : "group-hover:text-white"} />
                      <span className="font-medium">{item.label}</span>
                      {isActive && <div className="ml-auto h-1 w-1 rounded-full bg-[#409eff]" />}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        <div className="border-t border-white/5 bg-[#263445] p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Workspace</div>
          <div className="truncate text-xs font-semibold text-slate-300">
            {currentWorkspace?.workspace_name || "DramaLab"}
          </div>
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Topbar - Fixed height, clean, professional */}
        <header className="z-20 flex h-[50px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <AdminBreadcrumbs items={breadcrumbs} />
          </div>

          <div className="flex items-center gap-4">
            {me?.workspaces?.length ? (
              <div className="relative flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 pr-1">
                <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">WS</span>
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
                  className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
                >
                  {me.workspaces.map((workspace) => (
                    <option key={workspace.workspace_id} value={workspace.workspace_id}>
                      {workspace.workspace_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {me ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen((value) => !value)}
                  className="flex items-center gap-2 rounded-md hover:bg-slate-50 p-1 px-2 transition-colors"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">
                    {me.user.display_name?.[0] || me.user.email?.[0] || "U"}
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{me.user.display_name || "User"}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
                {isUserMenuOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 min-w-[160px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                    <div className="border-b border-slate-100 bg-slate-50/50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Account</p>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-700">{me.user.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        void signOut().then(() => router.replace("/?auth=signin"));
                      }}
                      className="flex w-full items-center px-4 py-2.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </header>

        {/* Tags View - vue-element-admin style */}
        <TagsView currentMeta={{ title, path: pathname }} />

        {/* Main Content Area - Scrollable */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-[1600px]">
            {/* Minimalist page header if needed, or just children */}
            <div className="mb-6 flex flex-col gap-1">
              <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500">{description}</p>
            </div>
            {children}
          </div>
        </main>
      </div>

      <style jsx>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
