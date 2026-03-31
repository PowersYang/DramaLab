"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Filter, Loader2, RefreshCw, Search, Workflow } from "lucide-react";

import { api, type ProjectSummary, type SeriesSummary, type TaskJob } from "@/lib/api";
import {
  isStudioCacheFresh,
  loadStudioCacheResource,
  readStudioCache,
  writeStudioCache,
  STUDIO_PROJECT_SUMMARIES_CACHE_KEY,
  STUDIO_SERIES_SUMMARIES_CACHE_KEY,
  STUDIO_TASK_LIST_CACHE_KEY,
} from "@/lib/studioCache";
import { useTaskStore } from "@/store/taskStore";

const TASK_COPY: Record<string, string> = {
  "art_direction.analyze": "AI 风格分析",
  "asset.generate": "资产生成",
  "asset.generate_batch": "批量资产生成",
  "audio.generate.line": "台词配音生成",
  "audio.generate.project": "项目音频生成",
  "media.merge": "视频合成",
  "mix.generate_bgm": "背景音乐生成",
  "mix.generate.sfx": "音效生成",
  "project.export": "项目导出",
  "project.reparse": "项目重解析",
  "project.sync_descriptions": "描述同步",
  "series.asset.generate": "系列资产生成",
  "series.assets.import": "系列资产导入",
  "series.import.confirm": "系列导入确认",
  "series.import.preview": "系列导入预分析",
  "storyboard.analyze": "分镜分析",
  "storyboard.generate_all": "分镜生成",
  "storyboard.refine_prompt": "分镜提示词润色",
  "storyboard.render": "分镜渲染",
  "video.generate.asset": "资产视频生成",
  "video.generate.frame": "分镜视频生成",
  "video.generate.project": "项目视频生成",
  "video.polish_prompt": "视频提示词润色",
  "video.polish_r2v_prompt": "R2V 提示词润色",
};

const STATUS_META = {
  running: { label: "进行中", tone: { background: "rgba(245, 158, 11, 0.16)", color: "#fbbf24" }, dot: "bg-amber-500", icon: Clock3 },
  queued: { label: "排队中", tone: { background: "rgba(148, 163, 184, 0.14)", color: "var(--studio-shell-text-soft)" }, dot: "bg-slate-400", icon: Clock3 },
  claimed: { label: "已领取", tone: { background: "rgba(148, 163, 184, 0.14)", color: "var(--studio-shell-text-soft)" }, dot: "bg-slate-500", icon: Clock3 },
  succeeded: { label: "已完成", tone: { background: "rgba(34, 197, 94, 0.14)", color: "#4ade80" }, dot: "bg-emerald-500", icon: CheckCircle2 },
  failed: { label: "失败", tone: { background: "rgba(244, 63, 94, 0.14)", color: "#fb7185" }, dot: "bg-rose-500", icon: AlertTriangle },
  cancelled: { label: "已取消", tone: { background: "rgba(148, 163, 184, 0.14)", color: "var(--studio-shell-text-soft)" }, dot: "bg-slate-400", icon: AlertTriangle },
  timed_out: { label: "超时", tone: { background: "rgba(244, 63, 94, 0.14)", color: "#fb7185" }, dot: "bg-rose-500", icon: AlertTriangle },
  retry_waiting: { label: "等待重试", tone: { background: "rgba(249, 115, 22, 0.16)", color: "#fb923c" }, dot: "bg-orange-500", icon: Clock3 },
  cancel_requested: { label: "取消中", tone: { background: "rgba(148, 163, 184, 0.14)", color: "var(--studio-shell-text-soft)" }, dot: "bg-slate-500", icon: Clock3 },
} as const;

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];
const ALL_STATUS_OPTIONS = ["all", ...Object.keys(STATUS_META)] as const;

type StatusFilter = typeof ALL_STATUS_OPTIONS[number];
type OwnerFilter = "all" | "project" | "series" | "system";

interface TaskTableRow extends TaskJob {
  scopeName: string;
  scopeType: "项目" | "系列" | "系统";
  taskLabel: string;
  statusLabel: string;
}

const TASK_DASHBOARD_LOG_PREFIX = "[tasks-dashboard]";
const TASK_CACHE_MAX_AGE = 15_000;

const mergeTaskLists = (...lists: TaskJob[][]): TaskJob[] => {
  const merged = new Map<string, TaskJob>();

  for (const list of lists) {
    for (const task of list) {
      const existing = merged.get(task.id);
      // 中文注释：任务页既吃远端全量列表，也吃 taskStore 里的即时 receipt；相同任务要以后写覆盖前写。
      merged.set(task.id, existing ? { ...existing, ...task } : task);
    }
  }

  return Array.from(merged.values()).sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at));
};

const formatTime = (value?: string | number | null) => {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
};

const getTimestamp = (value?: string | number | null) => {
  if (!value) return 0;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const formatDurationMinutes = (value: number) => {
  if (value <= 0) return "刚刚启动";
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
};

const getScopeMeta = (
  task: TaskJob,
  projectMap: Map<string, ProjectSummary>,
  seriesMap: Map<string, SeriesSummary>
): Pick<TaskTableRow, "scopeName" | "scopeType"> => {
  // 任务中心优先展示业务名称，而不是裸 ID，便于运营和排障快速定位上下文。
  if (task.project_id) {
    return {
      scopeName: projectMap.get(task.project_id)?.title || `项目 ${task.project_id}`,
      scopeType: "项目",
    };
  }
  if (task.series_id) {
    return {
      scopeName: seriesMap.get(task.series_id)?.title || `系列 ${task.series_id}`,
      scopeType: "系列",
    };
  }
  return {
    scopeName: task.resource_id || "系统任务",
    scopeType: "系统",
  };
};

export default function StudioTasksPage() {
  const upsertJobs = useTaskStore((state) => state.upsertJobs);
  const jobsById = useTaskStore((state) => state.jobsById);
  const [tasks, setTasks] = useState<TaskJob[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const previousActiveTaskIdsRef = useRef<string[]>([]);

  const PAGE_SIZE = 12;

  useEffect(() => {
    const cachedTasks = readStudioCache<TaskJob[]>(STUDIO_TASK_LIST_CACHE_KEY);
    const cachedProjects = readStudioCache<ProjectSummary[]>(STUDIO_PROJECT_SUMMARIES_CACHE_KEY);
    const cachedSeries = readStudioCache<SeriesSummary[]>(STUDIO_SERIES_SUMMARIES_CACHE_KEY);
    const hasCachedTasks = Boolean(cachedTasks?.data?.length);

    if (cachedTasks?.data) {
      setTasks([...cachedTasks.data].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at)));
      setLoading(false);
    }
    if (cachedProjects?.data) {
      setProjects(cachedProjects.data);
    }
    if (cachedSeries?.data) {
      setSeriesList(cachedSeries.data);
    }

    let cancelled = false;

    const logRequestDuration = async <T,>(label: string, request: Promise<T>) => {
      const startedAt = performance.now();
      try {
        const result = await request;
        console.info(TASK_DASHBOARD_LOG_PREFIX, "init-request:end", {
          label,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        });
        return result;
      } catch (error) {
        console.error(TASK_DASHBOARD_LOG_PREFIX, "init-request:error", {
          label,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    const load = async (showLoading = false) => {
      const totalStartedAt = performance.now();
      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        setError(null);
        const [taskList, projectEnvelope, seriesEnvelope] = await Promise.all([
          logRequestDuration("tasks", api.listTasks(undefined, undefined, { limit: 200 })),
          loadStudioCacheResource(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, () =>
            logRequestDuration("project-summaries", api.getProjectSummaries())
          ),
          loadStudioCacheResource(STUDIO_SERIES_SUMMARIES_CACHE_KEY, () =>
            logRequestDuration("series-summaries", api.listSeriesSummaries())
          ),
        ]);
        if (cancelled) return;

        const projectsData = projectEnvelope.data;
        const seriesData = seriesEnvelope.data;
        writeStudioCache(STUDIO_TASK_LIST_CACHE_KEY, taskList);
        upsertJobs(taskList);
        setTasks([...taskList].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at)));
        setProjects(projectsData);
        setSeriesList(seriesData);
        console.info(TASK_DASHBOARD_LOG_PREFIX, "init-batch:end", {
          refreshMode: showLoading ? "initial" : "polling",
          durationMs: Math.round((performance.now() - totalStartedAt) * 100) / 100,
          taskCount: taskList.length,
          projectCount: projectsData.length,
          seriesCount: seriesData.length,
        });
      } catch (loadError) {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "任务中心加载失败";
        console.error("Failed to load tasks dashboard:", loadError);
        console.error(TASK_DASHBOARD_LOG_PREFIX, "init-batch:error", {
          refreshMode: showLoading ? "initial" : "polling",
          durationMs: Math.round((performance.now() - totalStartedAt) * 100) / 100,
          detail: message,
        });
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    if (
      !isStudioCacheFresh(STUDIO_TASK_LIST_CACHE_KEY, TASK_CACHE_MAX_AGE) ||
      !isStudioCacheFresh(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, 30_000) ||
      !isStudioCacheFresh(STUDIO_SERIES_SUMMARIES_CACHE_KEY, 30_000)
    ) {
      void load(!hasCachedTasks);
    }

    return () => {
      cancelled = true;
    };
  }, [upsertJobs]);

  const mergedTasks = useMemo(
    () => mergeTaskLists(tasks, Object.values(jobsById)),
    [jobsById, tasks]
  );

  const activeTaskIds = useMemo(
    () => mergedTasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).map((task) => task.id),
    [mergedTasks]
  );

  useEffect(() => {
    if (activeTaskIds.length === 0) {
      previousActiveTaskIdsRef.current = activeTaskIds;
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollActiveTasks = async () => {
      try {
        const activeTasks = await api.listTasks(undefined, [...ACTIVE_STATUSES], { limit: 200 });
        if (cancelled) return;
        upsertJobs(activeTasks);
        setTasks((current) => mergeTaskLists(current, activeTasks));
      } catch (pollError) {
        if (!cancelled) {
          console.error("Failed to poll active tasks dashboard jobs:", pollError);
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(pollActiveTasks, 3000);
        }
      }
    };

    timeoutId = window.setTimeout(pollActiveTasks, 3000);
    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeTaskIds, upsertJobs]);

  useEffect(() => {
    const previousIds = previousActiveTaskIdsRef.current;
    const activeIdSet = new Set(activeTaskIds);
    const finishedJobIds = previousIds.filter((jobId) => !activeIdSet.has(jobId));
    previousActiveTaskIdsRef.current = activeTaskIds;

    if (finishedJobIds.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const taskList = await api.listTasks(undefined, undefined, { limit: 200 });
        if (cancelled) return;
        writeStudioCache(STUDIO_TASK_LIST_CACHE_KEY, taskList);
        upsertJobs(taskList);
        setTasks(mergeTaskLists(taskList));
      } catch (refreshError) {
        if (!cancelled) {
          console.error("Failed to refresh tasks dashboard after task completion:", refreshError);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTaskIds, upsertJobs]);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const seriesMap = useMemo(() => new Map(seriesList.map((item) => [item.id, item])), [seriesList]);

  const rows = useMemo<TaskTableRow[]>(
    () =>
      mergedTasks.map((task) => {
        const scopeMeta = getScopeMeta(task, projectMap, seriesMap);
        const statusMeta = STATUS_META[task.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
        return {
          ...task,
          ...scopeMeta,
          taskLabel: TASK_COPY[task.task_type] || task.task_type,
          statusLabel: statusMeta.label,
        };
      }),
    [mergedTasks, projectMap, seriesMap]
  );

  const taskTypeOptions = useMemo(
    () => ["all", ...Array.from(new Set(rows.map((item) => item.task_type))).sort((a, b) => a.localeCompare(b))],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }
      if (ownerFilter !== "all") {
        const expectedType = ownerFilter === "project" ? "项目" : ownerFilter === "series" ? "系列" : "系统";
        if (row.scopeType !== expectedType) {
          return false;
        }
      }
      if (taskTypeFilter !== "all" && row.task_type !== taskTypeFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      const haystack = [row.scopeName, row.taskLabel, row.id, row.error_message || ""].join(" ").toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }, [keyword, ownerFilter, rows, statusFilter, taskTypeFilter]);

  useEffect(() => {
    setPage(1);
  }, [keyword, ownerFilter, statusFilter, taskTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredRows]);

  const summary = useMemo(
    () => [
      { label: "总任务数", value: rows.length },
      { label: "进行中", value: rows.filter((item) => ACTIVE_STATUSES.includes(item.status)).length },
      { label: "已完成", value: rows.filter((item) => item.status === "succeeded").length },
      { label: "需关注", value: rows.filter((item) => ["failed", "timed_out"].includes(item.status)).length },
    ],
    [rows]
  );

  const attentionRows = useMemo(
    () =>
      rows
        .filter((item) => ["failed", "timed_out", "retry_waiting", "cancel_requested"].includes(item.status))
        .sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at))
        .slice(0, 5),
    [rows]
  );

  const taskTypeLeaders = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      counts.set(row.task_type, (counts.get(row.task_type) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([taskType, count]) => ({
        taskType,
        label: TASK_COPY[taskType] || taskType,
        count,
      }));
  }, [rows]);

  const oldestActiveMinutes = useMemo(() => {
    const activeCreatedAt = rows
      .filter((row) => ACTIVE_STATUSES.includes(row.status))
      .map((row) => getTimestamp(row.created_at))
      .filter(Boolean);
    if (activeCreatedAt.length === 0) return 0;
    const oldestTimestamp = Math.min(...activeCreatedAt);
    return Math.max(1, Math.round((Date.now() - oldestTimestamp) / 60000));
  }, [rows]);

  const signalCards = useMemo(
    () => [
      {
        label: "排队积压",
        value: rows.filter((item) => ["queued", "claimed"].includes(item.status)).length,
        note: "尚未进入执行器的任务数量",
      },
      {
        label: "执行中",
        value: rows.filter((item) => item.status === "running").length,
        note: oldestActiveMinutes > 0 ? `最老活跃任务已运行 ${formatDurationMinutes(oldestActiveMinutes)}` : "当前无长跑任务",
      },
      {
        label: "等待重试",
        value: rows.filter((item) => item.status === "retry_waiting").length,
        note: "通常意味着供应商波动、限流或阶段性失败",
      },
      {
        label: "失败 / 超时",
        value: rows.filter((item) => ["failed", "timed_out"].includes(item.status)).length,
        note: attentionRows[0] ? `最近异常：${attentionRows[0].taskLabel}` : "最近没有异常任务",
      },
    ],
    [attentionRows, oldestActiveMinutes, rows]
  );

  const dispatchBoard = useMemo(
    () => [
      {
        label: "当前队列负载",
        value: rows.filter((item) => ["queued", "claimed", "running"].includes(item.status)).length,
        note: "用于判断执行器是否繁忙，以及是否存在积压。",
      },
      {
        label: "异常关注项",
        value: attentionRows.length,
        note: "失败、超时、等待重试和取消中的任务会集中暴露在这里。",
      },
      {
        label: "最高频任务",
        value: taskTypeLeaders[0]?.label || "暂无",
        note: "帮助判断当前工作区主要在推进哪类 AI 生产环节。",
      },
    ],
    [attentionRows.length, rows, taskTypeLeaders]
  );

  if (loading) {
    return (
      <div className="studio-panel flex min-h-[360px] items-center justify-center p-12">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="studio-panel rounded-[1.5rem] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-300">任务中心加载失败</p>
        <p className="mt-2 text-sm text-rose-200/80">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="studio-panel overflow-hidden">
        <div
          className="border-b px-6 py-6 lg:px-8"
          style={{
            borderColor: "var(--studio-shell-border)",
            background:
              "radial-gradient(circle at top left, rgba(244, 162, 97, 0.16), transparent 36%), linear-gradient(135deg, color-mix(in srgb, var(--studio-shell-panel-strong) 96%, transparent) 0%, color-mix(in srgb, var(--studio-shell-panel) 96%, transparent) 100%)",
          }}
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
            <div>
              <div className="studio-eyebrow">Task Dispatch</div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] studio-strong">任务调度总览与异常聚焦</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 studio-muted">
                任务中心不只展示列表，而是优先把积压、执行中、重试和异常任务直接暴露出来，帮助后台快速判断 AI 生产链路是否健康。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="studio-status-pill"><span className="studio-status-dot" />生产调度后台</span>
                <span className="studio-status-pill"><Workflow size={14} />排队 / 执行 / 重试</span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.map((item) => (
                  <div key={item.label} className="studio-kpi min-w-[148px]">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {dispatchBoard.map((item) => (
                  <div key={item.label} className="studio-console-strip">
                    <div className="studio-console-label">{item.label}</div>
                    <div className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</div>
                    <p className="mt-2 text-sm leading-6 studio-muted">{item.note}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {signalCards.map((item) => (
                  <div key={item.label} className="studio-kpi">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</p>
                    <p className="mt-2 text-xs leading-6 studio-muted">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="studio-kpi">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="studio-eyebrow">Attention Queue</div>
                  <h3 className="mt-2 text-xl font-semibold studio-strong">最近需关注任务</h3>
                </div>
                {refreshing ? (
                  <span className="studio-badge studio-badge-soft">
                    <RefreshCw size={14} className="animate-spin" style={{ color: "var(--studio-shell-accent)" }} />
                    刷新中
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {attentionRows.length === 0 ? (
                  <div
                    className="rounded-[1.2rem] border border-dashed px-4 py-6 text-sm studio-muted"
                    style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}
                  >
                    当前没有失败、超时或等待重试的任务。
                  </div>
                ) : (
                  attentionRows.map((row) => {
                    const meta = STATUS_META[row.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
                    return (
                      <div
                        key={row.id}
                        className="rounded-[1.2rem] border px-4 py-3"
                        style={{ borderColor: "var(--studio-shell-border)", background: "color-mix(in srgb, var(--studio-shell-panel-strong) 96%, transparent)" }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold studio-strong">{row.scopeName}</p>
                            <p className="mt-1 text-xs studio-muted">{row.taskLabel}</p>
                          </div>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={meta.tone}>
                            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                            {row.statusLabel}
                          </span>
                        </div>
                        <p className="mt-2 text-xs studio-muted">创建时间 {formatTime(row.created_at)}</p>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--studio-shell-border)" }}>
                <div className="studio-eyebrow">Top Task Types</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {taskTypeLeaders.map((item) => (
                    <span key={item.taskType} className="studio-mini-chip">
                      {item.label} · {item.count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 lg:px-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
                <label className="relative block min-w-[240px]">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 studio-faint" />
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索项目名、系列名、任务类型或任务 ID"
                    className="studio-input rounded-full py-3 pl-11 pr-4 text-sm"
                  />
                </label>

                <label className="studio-control-chip">
                  <Filter size={16} className="studio-faint" />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="studio-select border-none bg-transparent py-0 pr-6 text-sm font-medium shadow-none"
                  >
                    <option value="all">全部状态</option>
                    {ALL_STATUS_OPTIONS.filter((item) => item !== "all").map((status) => (
                      <option key={status} value={status}>
                        {STATUS_META[status as keyof typeof STATUS_META].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="studio-control-chip">
                  <select
                    value={ownerFilter}
                    onChange={(event) => setOwnerFilter(event.target.value as OwnerFilter)}
                    className="studio-select border-none bg-transparent py-0 pr-6 text-sm font-medium shadow-none"
                  >
                    <option value="all">全部归属</option>
                    <option value="project">项目任务</option>
                    <option value="series">系列任务</option>
                    <option value="system">系统任务</option>
                  </select>
                </label>

                <label className="studio-control-chip">
                  <select
                    value={taskTypeFilter}
                    onChange={(event) => setTaskTypeFilter(event.target.value)}
                    className="studio-select max-w-[220px] border-none bg-transparent py-0 pr-6 text-sm font-medium shadow-none"
                  >
                    <option value="all">全部任务类型</option>
                    {taskTypeOptions.filter((item) => item !== "all").map((taskType) => (
                      <option key={taskType} value={taskType}>
                        {TASK_COPY[taskType] || taskType}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-3 text-sm studio-muted">
                <span className="studio-badge studio-badge-soft">
                  {filteredRows.length} / {rows.length} 条
                </span>
                {refreshing && (
                  <span className="studio-badge studio-badge-soft">
                    <RefreshCw size={14} className="animate-spin" style={{ color: "var(--studio-shell-accent)" }} />
                    刷新中
                  </span>
                )}
              </div>
            </div>

            <div className="studio-table-wrap">
              <div className="overflow-x-auto">
                <table className="studio-table">
                  <thead>
                    <tr>
                      <th className="w-[240px]">归属对象</th>
                      <th className="w-[110px]">归属类型</th>
                      <th>生产任务</th>
                      <th className="w-[176px]">创建时间</th>
                      <th className="w-[176px]">结束时间</th>
                      <th className="w-[160px]">执行状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-16">
                          <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}>
                            <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--studio-shell-accent-soft)", color: "var(--studio-shell-accent-strong)" }}>
                              <Workflow size={22} />
                            </div>
                            <p className="mt-4 text-base font-semibold studio-strong">当前筛选条件下没有任务</p>
                            <p className="mt-2 max-w-md text-sm leading-7 studio-muted">可以尝试切换状态、归属或任务类型筛选，也可以清空关键词查看最近任务全貌。</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => {
                        const meta = STATUS_META[row.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
                        const Icon = meta.icon;

                        return (
                          <tr key={row.id} className="group transition-colors">
                            <td className="w-[240px]">
                              <div className="w-[240px]">
                                <p className="truncate text-sm font-semibold studio-strong" title={row.scopeName}>{row.scopeName}</p>
                              </div>
                            </td>
                            <td className="w-[110px] whitespace-nowrap text-sm">
                              {row.scopeType}
                            </td>
                            <td>
                              <div className="min-w-[180px]">
                                <p className="text-sm font-semibold studio-strong">{row.taskLabel}</p>
                              </div>
                            </td>
                            <td className="w-[176px] whitespace-nowrap text-sm">
                              {formatTime(row.created_at)}
                            </td>
                            <td className="w-[176px] whitespace-nowrap text-sm">
                              {formatTime(row.finished_at)}
                            </td>
                            <td className="w-[160px]">
                              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={meta.tone}>
                                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                                <Icon size={14} />
                                {row.statusLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {filteredRows.length > 0 && (
                <div className="flex flex-col gap-3 border-t px-6 py-4 md:flex-row md:items-center md:justify-between" style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}>
                  <p className="text-sm studio-muted">
                    第 {currentPage} / {totalPages} 页，当前展示 {pagedRows.length} 条
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={currentPage === 1}
                      className="studio-button studio-button-secondary disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ChevronLeft size={16} />
                      上一页
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                      disabled={currentPage === totalPages}
                      className="studio-button studio-button-secondary disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      下一页
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
