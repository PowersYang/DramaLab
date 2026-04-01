"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CheckCheck, Clapperboard, FolderKanban, ScanLine, Workflow, Plus, Settings2, Clock3, Loader2 } from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
import AnnouncementBoard from "@/components/studio/announcement/AnnouncementBoard";
import AnnouncementManagerDialog from "@/components/studio/announcement/AnnouncementManagerDialog";
import { api, type ProjectSummary, type SeriesSummary } from "@/lib/api";
import {
  isStudioCacheFresh,
  loadStudioCacheResource,
  readStudioCache,
  writeStudioCache,
  STUDIO_PROJECT_SUMMARIES_CACHE_KEY,
  STUDIO_SERIES_SUMMARIES_CACHE_KEY,
  STUDIO_TASK_LIST_CACHE_KEY,
} from "@/lib/studioCache";
import { useAuthStore } from "@/store/authStore";

const DASHBOARD_CACHE_MAX_AGE = 30_000;

const formatDate = (value?: string | number | null) => {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN");
};

const getTimestamp = (value?: string | number | null) => {
  if (!value) return 0;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const scheduleDeferredRefresh = (task: () => void) => {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  // 中文注释：总览页优先秒开缓存摘要，等浏览器空闲时再补刷新，避免后台切页被统计请求拖慢。
  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(() => task(), { timeout: 1000 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = globalThis.setTimeout(task, 160);
  return () => globalThis.clearTimeout(timeoutId);
};

const getProjectStatusLabel = (status?: string) => {
  switch (status) {
    case "pending":
      return { label: "待开始", tone: "neutral" };
    case "processing":
      return { label: "进行中", tone: "warning" };
    case "completed":
      return { label: "已完成", tone: "accent" };
    case "failed":
      return { label: "失败", tone: "danger" };
    default:
      return { label: status || "待开始", tone: "neutral" };
  }
};

export default function StudioDashboardPage() {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const isAdmin = hasCapability("platform.manage");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [runningTasks, setRunningTasks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAnnouncementManager, setShowAnnouncementManager] = useState(false);

  useEffect(() => {
    const cachedProjects = readStudioCache<ProjectSummary[]>(STUDIO_PROJECT_SUMMARIES_CACHE_KEY);
    const cachedSeries = readStudioCache<SeriesSummary[]>(STUDIO_SERIES_SUMMARIES_CACHE_KEY);
    const cachedTasks = readStudioCache<{ status: string }[]>(STUDIO_TASK_LIST_CACHE_KEY);

    if (cachedProjects?.data) {
      setProjects(cachedProjects.data);
    }
    if (cachedSeries?.data) {
      setSeriesList(cachedSeries.data);
    }
    if (cachedTasks?.data) {
      setRunningTasks(cachedTasks.data.length);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || isBootstrapping) {
      return;
    }

    let cancelled = false;

    const refreshSummaries = async () => {
      try {
        const [projectEnvelope, seriesEnvelope] = await Promise.all([
          loadStudioCacheResource(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, () => api.getProjectSummaries()),
          loadStudioCacheResource(STUDIO_SERIES_SUMMARIES_CACHE_KEY, () => api.listSeriesSummaries()),
        ]);
        if (cancelled) return;
        setProjects(projectEnvelope.data);
        setSeriesList(seriesEnvelope.data);
      } catch (error) {
        if (!cancelled) console.error("Failed to refresh dashboard:", error);
      }
    };

    const refreshTaskCount = async () => {
      try {
        const taskList = await api.listTasks(undefined, ["queued", "claimed", "running", "retry_waiting"], { limit: 100 });
        if (cancelled) return;
        writeStudioCache(STUDIO_TASK_LIST_CACHE_KEY, taskList);
        setRunningTasks(taskList.length);
      } catch (error) {
        if (!cancelled) console.error("Failed to refresh task count:", error);
      }
    };

    const cancelSummaryRefresh = scheduleDeferredRefresh(() => {
      if (!cancelled) void refreshSummaries();
    });

    const cancelTaskRefresh = scheduleDeferredRefresh(() => {
      if (!cancelled) void refreshTaskCount();
    });

    return () => {
      cancelled = true;
      cancelSummaryRefresh();
      cancelTaskRefresh();
    };
  }, [authStatus, isBootstrapping]);

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => getTimestamp(b.updated_at) - getTimestamp(a.updated_at)).slice(0, 5),
    [projects],
  );

  const stats = useMemo(
    () => [
      { label: "项目总数", value: projects.length, icon: FolderKanban },
      { label: "活跃系列", value: seriesList.length, icon: Boxes },
      { label: "进行中任务", value: runningTasks, icon: Workflow },
      { label: "已完结项目", value: projects.filter((item) => item.status === "completed").length, icon: CheckCheck },
    ],
    [projects, runningTasks, seriesList.length],
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminSummaryStrip items={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Projects Ledger */}
        <section className="studio-panel overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50/50 px-5 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">最近活跃项目</h3>
          </div>
          <div className="overflow-x-auto">
            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <FolderKanban size={32} className="mb-2 opacity-10" />
                <p className="text-xs">暂无活跃项目</p>
              </div>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50/50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-5 py-2.5">项目名称</th>
                    <th className="px-5 py-2.5">状态</th>
                    <th className="px-5 py-2.5">最后更新</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentProjects.map((project) => {
                    const statusInfo = getProjectStatusLabel(project.status);
                    return (
                      <tr key={project.id} className="hover:bg-slate-50/30">
                        <td className="px-5 py-3 font-medium text-slate-700">{project.title}</td>
                        <td className="px-5 py-3">
                          <span className={`admin-status-badge admin-status-badge-${statusInfo.tone}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatDate(project.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Quick Access */}
        <div className="grid gap-6">
          <section className="studio-panel p-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">快捷操作</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link href="/studio/projects" className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-blue-200 hover:bg-white hover:shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-500">
                  <Plus size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">新建项目</h4>
                  <p className="text-[10px] text-slate-500">立项新的短剧内容</p>
                </div>
              </Link>
              <Link href="/studio/tasks" className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-amber-200 hover:bg-white hover:shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
                  <Workflow size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">任务监控</h4>
                  <p className="text-[10px] text-slate-500">追踪 AI 生成任务</p>
                </div>
              </Link>
              <Link href="/studio/library" className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-indigo-200 hover:bg-white hover:shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                  <Boxes size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">资产资源</h4>
                  <p className="text-[10px] text-slate-500">管理复用资产库</p>
                </div>
              </Link>
              <Link href="/studio/settings" className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-slate-300 hover:bg-white hover:shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Settings2 size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">系统配置</h4>
                  <p className="text-[10px] text-slate-500">调整模型与全局设置</p>
                </div>
              </Link>
            </div>
          </section>

          <section className="studio-panel p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">系统公告</h3>
              {isAdmin && (
                <button 
                  onClick={() => setShowAnnouncementManager(true)}
                  className="text-[10px] font-bold text-blue-500 hover:text-blue-600 hover:underline"
                >
                  管理公告
                </button>
              )}
            </div>
            <AnnouncementBoard />
          </section>
        </div>
      </div>

      <AnnouncementManagerDialog 
        isOpen={showAnnouncementManager} 
        onClose={() => setShowAnnouncementManager(false)} 
      />
    </div>
  );
}
