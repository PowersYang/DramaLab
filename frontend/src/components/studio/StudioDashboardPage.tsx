"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CheckCheck, Clapperboard, FolderKanban, ScanLine, Workflow } from "lucide-react";

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

const opsBoard = [
  { label: "项目母体管理", body: "统一管理系列母体、独立项目和分集关系，适合内容制作排产。" },
  { label: "AI 生产调度", body: "把资产、分镜、视频与导出任务纳入统一队列和异常追踪。" },
  { label: "运营协同治理", body: "将团队、算力成本、模型与平台规则纳入同一控制台。" },
];

const quickActions = [
  { label: "查看项目台账", href: "/studio/projects", meta: "系列 / 独立项目 / 分集编排" },
  { label: "处理任务异常", href: "/studio/tasks", meta: "执行队列 / 重试 / 失败任务" },
  { label: "进入资产资源库", href: "/studio/library", meta: "角色 / 场景 / 道具资源" },
  { label: "维护风格策略", href: "/studio/styles", meta: "美术风格模板与复用" },
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
      { label: "运行队列", value: runningTasks, note: runningTasks > 0 ? "当前存在进行中或等待执行的生产任务。" : "当前任务队列平稳，没有待处理阻塞。" },
      { label: "最新项目活动", value: recentProjects[0] ? formatDate(recentProjects[0].updated_at) : "-", note: "用于判断工作区最近一次生产或编辑活动。" },
    ],
    [recentProjects, runningTasks],
  );

  const attentionSummary = useMemo(
    () => [
      {
        label: "待推进项目",
        value: Math.max(projects.length - projects.filter((item) => (item.frame_count || 0) > 0).length, 0),
        note: "仍停留在剧本、角色或场景准备阶段的项目。",
      },
      {
        label: "已入分镜",
        value: projects.filter((item) => (item.frame_count || 0) > 0).length,
        note: "已经进入镜头生产链路，可继续推进视频生成。",
      },
      {
        label: "调度风险",
        value: runningTasks > 8 ? "偏高" : runningTasks > 0 ? "可控" : "稳定",
        note: runningTasks > 8 ? "运行任务偏多，建议关注队列积压与执行时长。" : "当前没有明显积压信号。",
      },
    ],
    [projects, runningTasks],
  );

  const pipelineCards = useMemo(
    () => [
      {
        label: "剧本与项目立项",
        value: projects.length,
        note: "项目母体与独立任务池",
        icon: FolderKanban,
      },
      {
        label: "系列世界观沉淀",
        value: seriesList.length,
        note: "系列共享角色、设定与分集基础",
        icon: Boxes,
      },
      {
        label: "分镜生产阶段",
        value: projects.filter((item) => (item.frame_count || 0) > 0).length,
        note: "已进入分镜或镜头组织流程",
        icon: ScanLine,
      },
      {
        label: "AI 执行队列",
        value: runningTasks,
        note: "运行、排队与重试中的生成任务",
        icon: Workflow,
      },
    ],
    [projects, runningTasks, seriesList.length],
  );

  return (
    <div className="space-y-6">
      <section className="studio-panel overflow-hidden">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.18fr)_360px] lg:px-8">
          <div>
            <div className="studio-eyebrow">Operations Hub</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] studio-strong">AI 短剧生产与运营工作台</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 studio-muted">
              把项目、系列、任务与资产沉淀为可治理的生产资产。首页按控制台思路组织核心数据、流程状态、调度信号和异常关注点，而不是展示型卡片堆叠。
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="studio-status-pill"><span className="studio-status-dot" />内容生产控制台</span>
              <span className="studio-status-pill"><CheckCheck size={14} />任务统一跟踪</span>
              <span className="studio-status-pill"><Clapperboard size={14} />短剧业务语境</span>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {attentionSummary.map((item) => (
                <div key={item.label} className="studio-console-strip">
                  <div className="studio-console-label">{item.label}</div>
                  <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] studio-strong">{item.value}</div>
                  <p className="mt-2 text-sm leading-6 studio-muted">{item.note}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 xl:grid-cols-3">
              {opsBoard.map((item) => (
                <div key={item.label} className="rounded-[1rem] border border-slate-200/80 bg-white/75 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">{item.label}</div>
                  <p className="mt-3 text-sm leading-6 studio-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="studio-console-grid">
            <div className="studio-kpi">
              <div className="studio-console-label">控制台摘要</div>
              <div className="mt-4 space-y-3">
                {queueSummary.map((item) => (
                  <div key={item.label} className="rounded-[14px] border border-slate-200/70 bg-white/80 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</div>
                    <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] studio-strong">{item.value}</div>
                    <p className="mt-2 text-sm leading-6 studio-muted">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-kpi">
              <div className="flex items-center justify-between">
                <div className="studio-console-label">快捷动作</div>
                <AlertTriangle size={14} className="studio-faint" />
              </div>
              <div className="mt-4 space-y-2">
                {quickActions.map((item) => (
                  <Link key={item.label} href={item.href} className="studio-list-row !rounded-[14px] !px-4 !py-3">
                    <div>
                      <p className="text-sm font-semibold studio-strong">{item.label}</p>
                      <p className="mt-1 text-xs studio-muted">{item.meta}</p>
                    </div>
                    <ArrowRight size={16} className="studio-faint" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        {pipelineCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="studio-kpi">
              <div className="flex items-center justify-between">
                <div className="studio-console-label">{item.label}</div>
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

      <section className="studio-panel p-6">
        <div className="studio-eyebrow">流程概览</div>
        <h3 className="mt-2 text-xl font-semibold studio-strong">短剧生产流程</h3>
        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          {[
            "剧本解析与项目立项",
            "角色 / 场景 / 道具资产沉淀",
            "分镜生成与镜头组织",
            "视频生成、合成与导出",
          ].map((item, index) => (
            <div key={item} className="studio-console-strip">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="studio-console-label">阶段 {index + 1}</div>
                  <p className="mt-2 text-sm font-semibold studio-strong">{item}</p>
                </div>
                <span className="studio-status-pill">
                  <span className="studio-status-dot" />
                  管理中
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
