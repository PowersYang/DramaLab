"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { api, type ProjectSummary, type SeriesSummary } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

const DASHBOARD_CACHE_KEY = "dramalab-studio-dashboard-cache-v1";

const formatDate = (value?: string | number | null) => {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN");
};

interface DashboardCachePayload {
  projects: ProjectSummary[];
  seriesList: SeriesSummary[];
  runningTasks: number;
  updatedAt: number;
}

const scheduleDeferredRefresh = (task: () => void) => {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  // 中文注释：总览页任务统计不是首屏阻塞信息，放到空闲时段再拉，优先把导航切换和主内容响应让出来。
  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(() => task(), { timeout: 1200 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = window.setTimeout(task, 180);
  return () => window.clearTimeout(timeoutId);
};

const readDashboardCache = (): DashboardCachePayload | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DashboardCachePayload | null;
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.seriesList)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to read dashboard cache:", error);
    return null;
  }
};

const writeDashboardCache = (payload: DashboardCachePayload) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to write dashboard cache:", error);
  }
};

export default function StudioDashboardPage() {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  // 中文注释：首帧不要直接读 sessionStorage，先用稳定空态完成 hydration，再在挂载后恢复缓存。
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [runningTasks, setRunningTasks] = useState(0);
  const [hasWarmData, setHasWarmData] = useState(false);

  useEffect(() => {
    const cached = readDashboardCache();
    if (!cached) {
      return;
    }
    setProjects(cached.projects);
    setSeriesList(cached.seriesList);
    setRunningTasks(cached.runningTasks);
    setHasWarmData(true);
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || isBootstrapping) {
      return;
    }

    let cancelled = false;
    let latestProjects: ProjectSummary[] = [];
    let latestSeries: SeriesSummary[] = [];

    const loadPrimary = async () => {
      try {
        // 总览页先拉项目和系列卡片，保证页面和左侧导航切换优先稳定下来。
        const [projectsData, seriesData] = await Promise.all([
          api.getProjectSummaries(),
          api.listSeriesSummaries(),
        ]);
        if (cancelled) {
          return;
        }

        latestProjects = projectsData;
        latestSeries = seriesData;
        setProjects(projectsData);
        setSeriesList(seriesData);
        setHasWarmData(true);
        writeDashboardCache({
          projects: projectsData,
          seriesList: seriesData,
          runningTasks,
          updatedAt: Date.now(),
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load studio dashboard:", error);
        }
      }
    };

    const loadTaskCount = async () => {
      try {
        const taskList = await api.listTasks(undefined, ["queued", "claimed", "running", "retry_waiting"], { limit: 100 });
        if (cancelled) {
          return;
        }
        setRunningTasks(taskList.length);
        writeDashboardCache({
          projects: latestProjects,
          seriesList: latestSeries,
          runningTasks: taskList.length,
          updatedAt: Date.now(),
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load dashboard task count:", error);
        }
      }
    };

    const cancelDeferredPrimaryLoad = scheduleDeferredRefresh(() => {
      if (!cancelled) {
        void loadPrimary();
      }
    });
    const cancelDeferredTaskLoad = scheduleDeferredRefresh(() => {
      if (!cancelled) {
        void loadTaskCount();
      }
    });

    return () => {
      cancelled = true;
      cancelDeferredPrimaryLoad();
      cancelDeferredTaskLoad();
    };
  // 中文注释：这里只在首次进入总览页时做渐进加载，避免因为任务计数变化反复占用首屏请求通道。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, isBootstrapping]);

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 4),
    [projects]
  );
  const recentSeries = useMemo(
    () => [...seriesList].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 3),
    [seriesList]
  );

  const stats = [
    { label: "项目总数", value: projects.length, note: "活跃项目与独立创作任务" },
    { label: "系列总数", value: seriesList.length, note: "可复用世界观与资产库" },
    { label: "进行中任务", value: runningTasks, note: "统一追踪异步生成链路" },
    { label: "已建分镜项目", value: projects.filter((item) => (item.frame_count || 0) > 0).length, note: "已进入分镜生产的项目" },
  ];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="studio-panel p-6">
            <p className="text-sm font-medium text-slate-500">{item.label}</p>
            <p className="mt-4 text-4xl font-bold text-slate-950">{item.value}</p>
            <p className="mt-2 text-sm text-slate-500">{item.note}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-950">最近项目</h3>
            <Link href="/studio/projects" className="text-sm font-semibold text-primary">查看全部</Link>
          </div>
          <div className="space-y-3">
            {!hasWarmData && recentProjects.length === 0 ? (
              [1, 2, 3].map((item) => (
                <div key={item} className="h-[74px] rounded-[1.5rem] border border-slate-200 bg-slate-50 animate-pulse" />
              ))
            ) : recentProjects.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                暂无项目，先从创建系列或导入剧本开始。
              </div>
            ) : (
              recentProjects.map((project) => (
                <Link key={project.id} href={`/studio/projects/${project.id}`} className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-white">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{project.title}</p>
                    <p className="mt-1 text-xs text-slate-500">更新于 {formatDate(project.updated_at)} · 分镜 {project.frame_count || 0}</p>
                  </div>
                  <ArrowRight size={16} className="text-slate-400" />
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-950">最近系列</h3>
            <Link href="/studio/projects" className="text-sm font-semibold text-primary">进入系列管理</Link>
          </div>
          <div className="space-y-3">
            {!hasWarmData && recentSeries.length === 0 ? (
              [1, 2].map((item) => (
                <div key={item} className="h-[74px] rounded-[1.5rem] border border-slate-200 bg-slate-50 animate-pulse" />
              ))
            ) : recentSeries.length === 0 ? (
              <p className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">暂无系列，适合多集内容的项目会显示在这里。</p>
            ) : (
              recentSeries.map((series) => (
                <Link key={series.id} href={`/studio/series/${series.id}`} className="block rounded-[1.5rem] border border-slate-200 bg-slate-50 px-5 py-4 transition-colors hover:border-primary/40 hover:bg-white">
                  <p className="text-sm font-semibold text-slate-950">{series.title}</p>
                  <p className="mt-1 text-xs text-slate-500">集数 {series.episode_count || 0} · 更新于 {formatDate(series.updated_at)}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
