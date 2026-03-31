"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, FolderKanban, Workflow } from "lucide-react";

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

  // 中文注释：工作台总览优先秒开已有摘要数据，再在浏览器空闲时补刷新，避免导航切换被统计接口拖住。
  if ("requestIdleCallback" in window) {
    const idleId = window.requestIdleCallback(() => task(), { timeout: 1000 });
    return () => window.cancelIdleCallback(idleId);
  }

  const timeoutId = window.setTimeout(task, 160);
  return () => window.clearTimeout(timeoutId);
};

const opsBoard = [
  { label: "项目治理", body: "汇总项目、系列、资产与分镜沉淀情况，便于判断工作区内容产能。" },
  { label: "任务调度", body: "把异步生成、排队、失败重试统一进任务中心，不再依赖页面猜状态。" },
  { label: "后台协同", body: "团队、计费、模型配置与治理入口统一收口到后台壳层。" },
];

export default function StudioDashboardPage() {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [runningTasks, setRunningTasks] = useState(0);
  const [hasWarmData, setHasWarmData] = useState(false);

  useEffect(() => {
    const cachedProjects = readStudioCache<ProjectSummary[]>(STUDIO_PROJECT_SUMMARIES_CACHE_KEY);
    const cachedSeries = readStudioCache<SeriesSummary[]>(STUDIO_SERIES_SUMMARIES_CACHE_KEY);
    const cachedTasks = readStudioCache<{ status: string }[]>(STUDIO_TASK_LIST_CACHE_KEY);

    if (cachedProjects?.data) {
      setProjects(cachedProjects.data);
      setHasWarmData(true);
    }
    if (cachedSeries?.data) {
      setSeriesList(cachedSeries.data);
      setHasWarmData(true);
    }
    if (cachedTasks?.data) {
      setRunningTasks(cachedTasks.data.length);
      setHasWarmData(true);
    }
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
        if (cancelled) {
          return;
        }
        setProjects(projectEnvelope.data);
        setSeriesList(seriesEnvelope.data);
        setHasWarmData(true);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to refresh studio dashboard summaries:", error);
        }
      }
    };

    const refreshTaskCount = async () => {
      try {
        const taskList = await api.listTasks(undefined, ["queued", "claimed", "running", "retry_waiting"], { limit: 100 });
        if (cancelled) {
          return;
        }
        writeStudioCache(STUDIO_TASK_LIST_CACHE_KEY, taskList);
        setRunningTasks(taskList.length);
        setHasWarmData(true);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to refresh studio dashboard task count:", error);
        }
      }
    };

    const cancelSummaryRefresh =
      isStudioCacheFresh(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, DASHBOARD_CACHE_MAX_AGE) &&
      isStudioCacheFresh(STUDIO_SERIES_SUMMARIES_CACHE_KEY, DASHBOARD_CACHE_MAX_AGE)
        ? () => undefined
        : scheduleDeferredRefresh(() => {
            if (!cancelled) {
              void refreshSummaries();
            }
          });

    const cancelTaskRefresh = isStudioCacheFresh(STUDIO_TASK_LIST_CACHE_KEY, 15_000)
      ? () => undefined
      : scheduleDeferredRefresh(() => {
          if (!cancelled) {
            void refreshTaskCount();
          }
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
  const recentSeries = useMemo(
    () => [...seriesList].sort((a, b) => getTimestamp(b.updated_at) - getTimestamp(a.updated_at)).slice(0, 4),
    [seriesList],
  );

  const stats = useMemo(
    () => [
      { label: "项目总数", value: projects.length, note: "工作区内全部项目与独立创作任务", icon: FolderKanban },
      { label: "系列总数", value: seriesList.length, note: "可复用世界观与共享资产容器", icon: Boxes },
      { label: "进行中任务", value: runningTasks, note: "统一追踪异步生成与排队状态", icon: Workflow },
      { label: "已进分镜项目", value: projects.filter((item) => (item.frame_count || 0) > 0).length, note: "已经进入分镜生产链路的项目", icon: ArrowRight },
    ],
    [projects, runningTasks, seriesList.length],
  );

  const queueSummary = useMemo(
    () => [
      { label: "待处理事项", value: runningTasks, note: runningTasks > 0 ? "建议优先查看任务中心中的运行队列。" : "当前没有阻塞中的异步任务。" },
      { label: "最近更新时间", value: recentProjects[0] ? formatDate(recentProjects[0].updated_at) : "-", note: "来自项目摘要缓存与后台静默刷新。" },
    ],
    [recentProjects, runningTasks],
  );

  return (
    <div className="space-y-6">
      <section className="studio-panel overflow-hidden">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.25fr)_340px] lg:px-8">
          <div>
            <div className="studio-eyebrow">Workspace Snapshot</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] studio-strong">工作区经营面板</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 studio-muted">
              把项目、系列、任务与资产沉淀为可管理的生产资产。这里优先呈现运营判断所需的信息，而不是创作型大卡片。
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/studio/projects" className="studio-button studio-button-primary">进入项目中心</Link>
              <Link href="/studio/tasks" className="studio-button studio-button-secondary">查看任务中心</Link>
            </div>
            <div className="mt-6 grid gap-3 xl:grid-cols-3">
              {opsBoard.map((item) => (
                <div key={item.label} className="rounded-[1.35rem] border border-slate-200/80 bg-white/75 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">{item.label}</div>
                  <p className="mt-3 text-sm leading-6 studio-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            {queueSummary.map((item) => (
              <div key={item.label} className="studio-kpi">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</div>
                <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] studio-strong">{item.value}</div>
                <p className="mt-2 text-sm leading-6 studio-muted">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="studio-kpi">
              <div className="flex items-center justify-between">
                <div className="studio-badge studio-badge-soft">{item.label}</div>
                <span className="studio-stat-icon">
                  <Icon size={16} />
                </span>
              </div>
              <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] studio-strong">{item.value}</p>
              <p className="mt-2 text-sm leading-6 studio-muted">{item.note}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.95fr)]">
        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="studio-eyebrow">Recent Projects</div>
              <h3 className="mt-2 text-xl font-semibold studio-strong">最近项目</h3>
            </div>
            <Link href="/studio/projects" className="studio-button studio-button-ghost">查看全部</Link>
          </div>
          <div className="space-y-3">
            {!hasWarmData && recentProjects.length === 0 ? (
              [1, 2, 3].map((item) => <div key={item} className="h-[78px] rounded-[1.25rem] bg-slate-100 animate-pulse" />)
            ) : recentProjects.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                暂无项目，先从创建系列或导入剧本开始。
              </div>
            ) : (
              recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/studio/projects/${project.id}`}
                  className="studio-list-row"
                >
                  <div>
                    <p className="text-sm font-semibold studio-strong">{project.title}</p>
                    <p className="mt-1 text-xs studio-muted">
                      更新于 {formatDate(project.updated_at)} · 角色 {project.character_count || 0} · 分镜 {project.frame_count || 0}
                    </p>
                  </div>
                  <ArrowRight size={16} className="studio-faint" />
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="studio-panel p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="studio-eyebrow">Series Registry</div>
              <h3 className="mt-2 text-xl font-semibold studio-strong">最近系列</h3>
            </div>
            <Link href="/studio/projects" className="studio-button studio-button-ghost">进入管理</Link>
          </div>
          <div className="space-y-3">
            {!hasWarmData && recentSeries.length === 0 ? (
              [1, 2, 3].map((item) => <div key={item} className="h-[78px] rounded-[1.25rem] bg-slate-100 animate-pulse" />)
            ) : recentSeries.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                暂无系列，适合多集内容的项目会显示在这里。
              </div>
            ) : (
              recentSeries.map((series) => (
                <Link
                  key={series.id}
                  href={`/studio/series/${series.id}`}
                  className="studio-list-row"
                >
                  <div>
                    <p className="text-sm font-semibold studio-strong">{series.title}</p>
                    <p className="mt-1 text-xs studio-muted">
                      集数 {series.episode_count || 0} · 角色 {series.character_count || 0} · 更新于 {formatDate(series.updated_at)}
                    </p>
                  </div>
                  <ArrowRight size={16} className="studio-faint" />
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
