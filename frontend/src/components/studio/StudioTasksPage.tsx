"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Filter, Loader2, RefreshCw, Search, Workflow } from "lucide-react";

import { api, type ProjectBrief, type SeriesBrief, type TaskJob } from "@/lib/api";
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
  running: { label: "进行中", tone: "bg-amber-100 text-amber-700", dot: "bg-amber-500", icon: Clock3 },
  queued: { label: "排队中", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-400", icon: Clock3 },
  claimed: { label: "已领取", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-500", icon: Clock3 },
  succeeded: { label: "已完成", tone: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", icon: CheckCircle2 },
  failed: { label: "失败", tone: "bg-rose-100 text-rose-700", dot: "bg-rose-500", icon: AlertTriangle },
  cancelled: { label: "已取消", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-400", icon: AlertTriangle },
  timed_out: { label: "超时", tone: "bg-rose-100 text-rose-700", dot: "bg-rose-500", icon: AlertTriangle },
  retry_waiting: { label: "等待重试", tone: "bg-orange-100 text-orange-700", dot: "bg-orange-500", icon: Clock3 },
  cancel_requested: { label: "取消中", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-500", icon: Clock3 },
} as const;

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];
const ALL_STATUS_OPTIONS = ["all", ...Object.keys(STATUS_META)] as const;
const OWNER_OPTIONS = ["all", "project", "series", "system"] as const;

type StatusFilter = typeof ALL_STATUS_OPTIONS[number];
type OwnerFilter = typeof OWNER_OPTIONS[number];

interface TaskTableRow extends TaskJob {
  scopeName: string;
  scopeType: "项目" | "系列" | "系统";
  taskLabel: string;
  statusLabel: string;
}

const TASK_DASHBOARD_LOG_PREFIX = "[tasks-dashboard]";

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

const getScopeMeta = (
  task: TaskJob,
  projectMap: Map<string, ProjectBrief>,
  seriesMap: Map<string, SeriesBrief>
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
  const [tasks, setTasks] = useState<TaskJob[]>([]);
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 12;

  useEffect(() => {
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
        const [taskList, projectsData, seriesData] = await Promise.all([
          logRequestDuration("tasks", api.listTasks(undefined, undefined, { limit: 200 })),
          logRequestDuration("project-briefs", api.getProjectBriefs()),
          logRequestDuration("series-briefs", api.listSeriesBriefs()),
        ]);
        if (cancelled) return;

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

    void load(true);

    return () => {
      cancelled = true;
    };
  }, [upsertJobs]);

  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const seriesMap = useMemo(() => new Map(seriesList.map((item) => [item.id, item])), [seriesList]);

  const rows = useMemo<TaskTableRow[]>(
    () =>
      tasks.map((task) => {
        const scopeMeta = getScopeMeta(task, projectMap, seriesMap);
        const statusMeta = STATUS_META[task.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
        return {
          ...task,
          ...scopeMeta,
          taskLabel: TASK_COPY[task.task_type] || task.task_type,
          statusLabel: statusMeta.label,
        };
      }),
    [projectMap, seriesMap, tasks]
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
        <p className="text-sm font-semibold text-rose-700">任务中心加载失败</p>
        <p className="mt-2 text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="studio-panel overflow-hidden">
        <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(201,169,97,0.16),_transparent_38%),linear-gradient(135deg,_#ffffff_0%,_#f8f6f2_100%)] px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summary.map((item) => (
                <div key={item.label} className="min-w-[148px] rounded-[1.5rem] border border-white/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-sm">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">{item.label}</p>
                  <p className="mt-3 text-3xl font-bold text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-5 lg:px-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
                <label className="relative block min-w-[240px]">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索项目名、系列名、任务类型或任务 ID"
                    className="w-full rounded-full border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-primary/40 focus:bg-white"
                  />
                </label>

                <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <Filter size={16} className="text-slate-400" />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="bg-transparent pr-6 text-sm font-medium text-slate-700 outline-none"
                  >
                    <option value="all">全部状态</option>
                    {ALL_STATUS_OPTIONS.filter((item) => item !== "all").map((status) => (
                      <option key={status} value={status}>
                        {STATUS_META[status as keyof typeof STATUS_META].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <select
                    value={ownerFilter}
                    onChange={(event) => setOwnerFilter(event.target.value as OwnerFilter)}
                    className="bg-transparent pr-6 text-sm font-medium text-slate-700 outline-none"
                  >
                    <option value="all">全部归属</option>
                    <option value="project">项目任务</option>
                    <option value="series">系列任务</option>
                    <option value="system">系统任务</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <select
                    value={taskTypeFilter}
                    onChange={(event) => setTaskTypeFilter(event.target.value)}
                    className="max-w-[220px] bg-transparent pr-6 text-sm font-medium text-slate-700 outline-none"
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

              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">
                  {filteredRows.length} / {rows.length} 条
                </span>
                {refreshing && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600">
                    <RefreshCw size={14} className="animate-spin text-primary" />
                    刷新中
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="w-[240px] border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">剧本名称</th>
                      <th className="w-[110px] border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">剧本类型</th>
                      <th className="border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">任务类型</th>
                      <th className="w-[176px] border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">创建时间</th>
                      <th className="w-[176px] border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">结束时间</th>
                      <th className="w-[160px] border-b border-slate-200 px-6 py-4 text-left text-sm font-semibold text-slate-600">任务状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-16">
                          <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Workflow size={22} />
                            </div>
                            <p className="mt-4 text-base font-semibold text-slate-900">当前筛选条件下没有任务</p>
                            <p className="mt-2 max-w-md text-sm leading-7 text-slate-500">可以尝试切换状态、归属或任务类型筛选，也可以清空关键词查看最近任务全貌。</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => {
                        const meta = STATUS_META[row.status as keyof typeof STATUS_META] ?? STATUS_META.queued;
                        const Icon = meta.icon;

                        return (
                          <tr key={row.id} className="group transition-colors hover:bg-[#fcfbf8]">
                            <td className="w-[240px] border-b border-slate-100 px-6 py-5 align-top">
                              <div className="w-[240px]">
                                <p className="truncate text-sm font-semibold text-slate-950" title={row.scopeName}>{row.scopeName}</p>
                              </div>
                            </td>
                            <td className="w-[110px] whitespace-nowrap border-b border-slate-100 px-6 py-5 align-top text-sm text-slate-600">
                              {row.scopeType}
                            </td>
                            <td className="border-b border-slate-100 px-6 py-5 align-top">
                              <div className="min-w-[180px]">
                                <p className="text-sm font-semibold text-slate-900">{row.taskLabel}</p>
                              </div>
                            </td>
                            <td className="w-[176px] whitespace-nowrap border-b border-slate-100 px-6 py-5 align-top text-sm text-slate-600">
                              {formatTime(row.created_at)}
                            </td>
                            <td className="w-[176px] whitespace-nowrap border-b border-slate-100 px-6 py-5 align-top text-sm text-slate-600">
                              {formatTime(row.finished_at)}
                            </td>
                            <td className="w-[160px] border-b border-slate-100 px-6 py-5 align-top">
                              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${meta.tone}`}>
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
                <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-slate-500">
                    第 {currentPage} / {totalPages} 页，当前展示 {pagedRows.length} 条
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      disabled={currentPage === 1}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/30 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ChevronLeft size={16} />
                      上一页
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                      disabled={currentPage === totalPages}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/30 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
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
