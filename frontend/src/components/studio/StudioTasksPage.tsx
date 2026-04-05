"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Workflow,
} from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
import { api, type ProjectSummary, type SeriesSummary, type TaskJob } from "@/lib/api";
import { formatTaskModelSummary, getTaskModelInfo } from "@/lib/taskModelInfo";
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
  "series.asset.generate": "剧集资产生成",
  "series.assets.extract": "剧集资产识别",
  "series.assets.import": "剧集资产导入",
  "series.import.confirm": "剧集导入确认",
  "series.import.preview": "剧集导入预分析",
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
  running: { label: "进行中", tone: "warning" as const, dot: "bg-amber-500", icon: Clock3 },
  queued: { label: "排队中", tone: "neutral" as const, dot: "bg-slate-400", icon: Clock3 },
  claimed: { label: "已领取", tone: "neutral" as const, dot: "bg-slate-500", icon: Clock3 },
  succeeded: { label: "已完成", tone: "success" as const, dot: "bg-emerald-500", icon: CheckCircle2 },
  failed: { label: "失败", tone: "danger" as const, dot: "bg-rose-500", icon: AlertTriangle },
  cancelled: { label: "已取消", tone: "neutral" as const, dot: "bg-slate-400", icon: AlertTriangle },
  timed_out: { label: "超时", tone: "danger" as const, dot: "bg-rose-500", icon: AlertTriangle },
  retry_waiting: { label: "等待重试", tone: "warning" as const, dot: "bg-orange-500", icon: Clock3 },
  cancel_requested: { label: "取消中", tone: "neutral" as const, dot: "bg-slate-500", icon: Clock3 },
} as const;

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];
const ALL_STATUS_OPTIONS = ["all", ...Object.keys(STATUS_META)] as const;

type StatusFilter = typeof ALL_STATUS_OPTIONS[number];
type OwnerFilter = "all" | "project" | "series" | "system";

interface TaskTableRow extends TaskJob {
  scopeName: string;
  scopeType: "项目" | "剧集" | "系统";
  taskLabel: string;
  statusLabel: string;
  modelSummary: string | null;
  fallbackReason: string | null;
}

const TASK_DASHBOARD_LOG_PREFIX = "[tasks-dashboard]";
const TASK_CACHE_MAX_AGE = 15_000;

const mergeTaskLists = (...lists: TaskJob[][]): TaskJob[] => {
  const merged = new Map<string, TaskJob>();

  for (const list of lists) {
    for (const task of list) {
      const existing = merged.get(task.id);
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
  if (task.project_id) {
    return {
      scopeName: projectMap.get(task.project_id)?.title || `项目 ${task.project_id}`,
      scopeType: "项目",
    };
  }
  if (task.series_id) {
    return {
      scopeName: seriesMap.get(task.series_id)?.title || `剧集 ${task.series_id}`,
      scopeType: "剧集",
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
      } catch (loadError) {
        console.error(TASK_DASHBOARD_LOG_PREFIX, "init-request:error", {
          label,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          detail: loadError instanceof Error ? loadError.message : String(loadError),
        });
        throw loadError;
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

  const mergedTasks = useMemo(() => mergeTaskLists(tasks, Object.values(jobsById)), [jobsById, tasks]);

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
          modelSummary: formatTaskModelSummary(task),
          fallbackReason: getTaskModelInfo(task).fallbackReason,
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
        const expectedType = ownerFilter === "project" ? "项目" : ownerFilter === "series" ? "剧集" : "系统";
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
      { label: "总任务", value: rows.length, icon: Workflow },
      { label: "已完成", value: rows.filter((item) => item.status === "succeeded").length, icon: CheckCircle2 },
      { label: "执行中", value: rows.filter((item) => item.status === "running").length, icon: Clock3 },
      { label: "积压中", value: rows.filter((item) => ["queued", "claimed"].includes(item.status)).length, icon: AlertTriangle },
    ],
    [rows]
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
      <AdminSummaryStrip items={summary} />

      <section className="studio-panel p-5 lg:p-6">
        <div className="admin-filter-shell">
          <div className="admin-filter-bar">
            <label className="admin-filter-search">
              <Search size={16} className="admin-filter-search-icon" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索项目名、剧集名、任务类型或任务 ID"
                className="admin-filter-search-input"
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
                <option value="series">剧集任务</option>
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
            <span className="admin-status-badge admin-status-badge-neutral">
              {filteredRows.length} / {rows.length} 条
            </span>
            {refreshing ? (
              <span className="admin-status-badge admin-status-badge-neutral">
                <RefreshCw size={14} className="animate-spin" />
                刷新中
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <div className="studio-panel overflow-hidden">
          <div className="admin-ledger-head">
            <div>
              <h3 className="text-xl font-semibold studio-strong">任务台账</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={currentPage === 1}
                className="studio-button studio-button-secondary disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={currentPage === totalPages}
                className="studio-button studio-button-secondary disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="admin-table-wrap">
            <div className="admin-task-table-head">
              <span>任务</span>
              <span>归属</span>
              <span>创建时间</span>
              <span>结束时间</span>
              <span>状态</span>
            </div>
            {filteredRows.length === 0 ? (
              <div className="px-6 py-16">
                <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--studio-shell-accent-soft)", color: "var(--studio-shell-accent-strong)" }}>
                    <Workflow size={22} />
                  </div>
                  <p className="mt-4 text-base font-semibold studio-strong">当前筛选条件下没有任务</p>
                  <p className="mt-2 max-w-md text-sm leading-7 studio-muted">可以切换状态、归属或任务类型筛选，也可以清空关键词查看最近任务全貌。</p>
                </div>
              </div>
            ) : (
              <div className="admin-task-table-body">
                {pagedRows.map((row) => {
                  const meta = STATUS_META[row.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
                  return (
                    <div
                      key={row.id}
                      className="admin-task-table-row"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-semibold studio-strong">{row.taskLabel}</strong>
                        <span className="block truncate text-xs studio-muted">{row.id}</span>
                        {row.modelSummary ? <span className="block truncate text-xs studio-muted">{row.modelSummary}</span> : null}
                        {row.fallbackReason ? <span className="block truncate text-xs text-amber-500">{row.fallbackReason}</span> : null}
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-semibold studio-strong">{row.scopeName}</strong>
                        <span className="block text-xs studio-muted">{row.scopeType}</span>
                      </span>
                      <span className="text-sm studio-muted">{formatTime(row.created_at)}</span>
                      <span className="text-sm studio-muted">{formatTime(row.finished_at)}</span>
                      <span>
                        <span className={`admin-status-badge admin-status-badge-${meta.tone}`}>{row.statusLabel}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {filteredRows.length > 0 ? (
              <div className="admin-ledger-footer">
                <p className="text-sm studio-muted">第 {currentPage} / {totalPages} 页，当前展示 {pagedRows.length} 条</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
