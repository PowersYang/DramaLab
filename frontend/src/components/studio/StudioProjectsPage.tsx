"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  FolderKanban,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
import { api, type EpisodeBrief, type ProjectSummary, type SeriesSummary } from "@/lib/api";
import {
  isStudioCacheFresh,
  loadStudioCacheResource,
  readStudioCache,
  STUDIO_PROJECT_SUMMARIES_CACHE_KEY,
  STUDIO_SERIES_SUMMARIES_CACHE_KEY,
} from "@/lib/studioCache";
import { useProjectStore } from "@/store/projectStore";

const CreateProjectDialog = dynamic(() => import("@/components/project/CreateProjectDialog"));
const ImportFileDialog = dynamic(() => import("@/components/series/ImportFileDialog"));
const CreateSeriesDialog = dynamic(() => import("@/components/studio/CreateSeriesDialog"));

type FilterMode = "all" | "series" | "project";
type LedgerTab = "all" | "recent" | "risk";

const PROJECTS_DASHBOARD_LOG_PREFIX = "[projects-dashboard]";

const parseTime = (value?: string | number | null) => {
  if (value == null) return 0;
  if (typeof value === "number") return value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDate = (value?: string | number | null) => {
  const timestamp = parseTime(value);
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString("zh-CN");
};

const getProjectStage = (project: ProjectSummary) => {
  if ((project.frame_count || 0) > 0) {
    return { label: "分镜生产中", tone: "accent" as const };
  }
  if ((project.character_count || 0) > 0 || (project.scene_count || 0) > 0) {
    return { label: "资产筹备中", tone: "warning" as const };
  }
  return { label: "待推进", tone: "neutral" as const };
};

function SeriesLedgerRow({
  series,
  episodes,
  episodesLoading,
  expanded,
  onDelete,
  onToggleExpand,
  onEpisodesChange,
}: {
  series: SeriesSummary;
  episodes: EpisodeBrief[] | undefined;
  episodesLoading: boolean;
  expanded: boolean;
  onDelete: (id: string) => void;
  onToggleExpand: (seriesId: string) => void;
  onEpisodesChange: (seriesId: string) => void;
}) {
  const [inlineTitle, setInlineTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showInlineInput, setShowInlineInput] = useState(false);

  const sortedEpisodes = episodes ? [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0)) : [];

  const handleInlineAddEpisode = async (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    if (!inlineTitle.trim()) return;
    setIsAdding(true);
    try {
      const nextEpisodeNumber = (episodes?.length || 0) + 1;
      await api.createEpisodeForSeries(series.id, inlineTitle.trim(), nextEpisodeNumber);
      setInlineTitle("");
      setShowInlineInput(false);
      onEpisodesChange(series.id);
    } catch (error) {
      console.error("Failed to add episode inline:", error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      <tr>
        <td>
          <div className="admin-ledger-main">
            <div className="flex items-center gap-2">
              <span className="admin-status-badge admin-status-badge-neutral">系列</span>
              <h4 className="truncate text-sm font-bold text-slate-800">{series.title}</h4>
            </div>
            <p className="truncate text-[11px] text-slate-400">
              {series.description || "系列母体"}
            </p>
          </div>
        </td>

        <td className="admin-table-cell-center admin-table-cell-text">{series.episode_count || 0}</td>
        <td className="admin-table-cell-center admin-table-cell-text">{series.character_count || 0}</td>
        <td className="admin-table-cell-center admin-table-cell-text">{series.scene_count || 0}</td>
        <td className="admin-table-cell-center admin-table-cell-text">{series.prop_count || 0}</td>
        <td className="admin-table-cell-center admin-table-cell-text">{series.frame_count || 0}</td>
        <td className="admin-table-cell-center admin-table-cell-text text-slate-400">{formatDate(series.updated_at)}</td>

        <td>
          <div className="admin-ledger-actions">
            <button onClick={() => onToggleExpand(series.id)} className="studio-button studio-button-secondary !h-7 !px-2 text-[11px]">
              {expanded ? "收起" : "展开"}
            </button>
            <Link href={`/studio/series/${series.id}`} className="studio-button studio-button-primary !h-7 !px-2 text-[11px]">
              管理
            </Link>
            <button
              onClick={() => {
                if (confirm(`确定要删除系列"${series.title}"吗？`)) {
                  onDelete(series.id);
                }
              }}
              className="studio-button studio-button-danger !h-7 !w-7 !p-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className="admin-subledger-row">
          <td colSpan={8}>
            <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm">
                    <FileText size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Episode Ledger</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">分集台账</p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 shadow-sm">
                        {sortedEpisodes.length} / {series.episode_count || 0} 集
                      </span>
                      {!episodesLoading && episodes && episodes.length === 0 && (series.episode_count || 0) > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          检测到台账未同步
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">从这里快速进入单集编辑器，或在列表内补齐集数标题。</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <button
                    onClick={() => onEpisodesChange(series.id)}
                    className="studio-button studio-button-secondary !h-8 !px-3 text-[12px]"
                    disabled={episodesLoading}
                  >
                    {episodesLoading ? "刷新中..." : "刷新"}
                  </button>
                  <button
                    onClick={() => setShowInlineInput(true)}
                    className="studio-button studio-button-primary !h-8 !px-3 text-[12px]"
                  >
                    + 添加集数
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                {episodesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                    ))}
                  </div>
                ) : sortedEpisodes.length > 0 ? (
                  <div className="space-y-2">
                    {sortedEpisodes.map((episode) => (
                      <Link
                        key={episode.id}
                        href={`/studio/projects/${episode.id}?seriesId=${series.id}`}
                        className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 transition-all hover:border-slate-200 hover:bg-slate-50"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">
                          {episode.episode_number || "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{episode.title}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{episode.frame_count || 0} 分镜 · 进入单集编辑</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                      <FileText size={18} />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">暂无分集</p>
                    <p className="text-xs text-slate-400">先创建一个集数标题，后续再进入单集编辑器推进制作。</p>
                  </div>
                )}

                {showInlineInput ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
                        <Plus size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Create Episode</p>
                        <input
                          value={inlineTitle}
                          onChange={(event) => setInlineTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleInlineAddEpisode(event);
                            if (event.key === "Escape") {
                              setShowInlineInput(false);
                              setInlineTitle("");
                            }
                          }}
                          placeholder="例如：第一集·开场冲突"
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-slate-300"
                          autoFocus
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            onClick={handleInlineAddEpisode}
                            disabled={!inlineTitle.trim() || isAdding}
                            className="studio-button studio-button-primary !h-8 !px-3 text-[12px] disabled:opacity-50"
                          >
                            {isAdding ? "创建中..." : "确认创建"}
                          </button>
                          <button
                            onClick={() => {
                              setShowInlineInput(false);
                              setInlineTitle("");
                            }}
                            className="studio-button studio-button-secondary !h-8 !px-3 text-[12px]"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ProjectLedgerRow({ project, onDelete }: { project: ProjectSummary; onDelete: (id: string) => void }) {
  const stage = getProjectStage(project);

  return (
    <tr>
      <td>
        <div className="admin-ledger-main">
          <div className="flex items-center gap-2">
            <span className="admin-status-badge admin-status-badge-neutral">项目</span>
            <h4 className="truncate text-sm font-bold text-slate-800">{project.title}</h4>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar size={10} />
              {formatDate(project.created_at)}
            </span>
          </div>
        </div>
      </td>

      <td className="admin-table-cell-center whitespace-nowrap">
        <span className={`text-[11px] admin-status-badge-${stage.tone} whitespace-nowrap`}>{stage.label}</span>
      </td>
      <td className="admin-table-cell-center admin-table-cell-text">{project.character_count || 0}</td>
      <td className="admin-table-cell-center admin-table-cell-text">{project.scene_count || 0}</td>
      <td className="admin-table-cell-center admin-table-cell-text">{project.prop_count || 0}</td>
      <td className="admin-table-cell-center admin-table-cell-text">{project.frame_count || 0}</td>
      <td className="admin-table-cell-center admin-table-cell-text text-slate-400">{formatDate(project.updated_at)}</td>

      <td>
        <div className="admin-ledger-actions">
          <Link href={`/studio/projects/${project.id}`} className="studio-button studio-button-primary !h-7 !px-3 text-[11px]">
            打开
          </Link>
          <button
            onClick={() => {
              if (confirm(`确定要删除项目"${project.title}"吗？`)) {
                onDelete(project.id);
              }
            }}
            className="studio-button studio-button-danger !h-7 !w-7 !p-0"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function StudioProjectsPage() {
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteSeries = useProjectStore((state) => state.deleteSeries);

  const [filter, setFilter] = useState<FilterMode>("all");
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("all");
  const [keyword, setKeyword] = useState("");
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreateSeriesOpen, setIsCreateSeriesOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, EpisodeBrief[]>>({});
  const [episodesLoadingBySeries, setEpisodesLoadingBySeries] = useState<Record<string, boolean>>({});
  const [expandedSeriesIds, setExpandedSeriesIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const didInitialLoadRef = useRef(false);

  const logRequestDuration = async <T,>(label: string, request: Promise<T>) => {
    const startedAt = performance.now();
    try {
      const result = await request;
      console.info(PROJECTS_DASHBOARD_LOG_PREFIX, "request:end", {
        label,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
      return result;
    } catch (error) {
      console.error(PROJECTS_DASHBOARD_LOG_PREFIX, "request:error", {
        label,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const loadWorkspaceData = useCallback(async () => {
    const startedAt = performance.now();
    try {
      setLoadError(null);
      const [projectEnvelope, seriesEnvelope] = await Promise.all([
        loadStudioCacheResource(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, () =>
          logRequestDuration("project-summaries", api.getProjectSummaries()),
        ),
        loadStudioCacheResource(STUDIO_SERIES_SUMMARIES_CACHE_KEY, () =>
          logRequestDuration("series-summaries", api.listSeriesSummaries()),
        ),
      ]);
      const projectsData = projectEnvelope.data;
      const seriesData = seriesEnvelope.data;
      setProjects(projectsData);
      setSeriesList(seriesData);
      console.info(PROJECTS_DASHBOARD_LOG_PREFIX, "batch:end", {
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        projectCount: projectsData.length,
        seriesCount: seriesData.length,
      });
    } catch (error) {
      console.error("Failed to load studio projects workspace:", error);
      setLoadError(error instanceof Error ? error.message : "项目中心加载失败");
      console.error(PROJECTS_DASHBOARD_LOG_PREFIX, "batch:error", {
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    if (didInitialLoadRef.current) {
      return;
    }
    didInitialLoadRef.current = true;

    const cachedProjects = readStudioCache<ProjectSummary[]>(STUDIO_PROJECT_SUMMARIES_CACHE_KEY);
    const cachedSeries = readStudioCache<SeriesSummary[]>(STUDIO_SERIES_SUMMARIES_CACHE_KEY);
    if (cachedProjects?.data) {
      setProjects(cachedProjects.data);
    }
    if (cachedSeries?.data) {
      setSeriesList(cachedSeries.data);
    }

    if (!isStudioCacheFresh(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, 30_000) || !isStudioCacheFresh(STUDIO_SERIES_SUMMARIES_CACHE_KEY, 30_000)) {
      void loadWorkspaceData();
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (expandedSeriesIds.length === 0) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      for (const seriesId of expandedSeriesIds) {
        if (cancelled || seriesEpisodes[seriesId] || episodesLoadingBySeries[seriesId]) {
          continue;
        }
        try {
          setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: true }));
          const episodes = await logRequestDuration(`episode-briefs:${seriesId}`, api.getSeriesEpisodeBriefs(seriesId));
          if (cancelled) return;
          setSeriesEpisodes((state) => ({ ...state, [seriesId]: episodes }));
        } catch (error) {
          if (cancelled) return;
          console.error("Failed to load series episode briefs:", seriesId, error);
        } finally {
          if (!cancelled) {
            setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: false }));
          }
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [episodesLoadingBySeries, expandedSeriesIds, seriesEpisodes]);

  const toggleSeriesExpand = (seriesId: string) => {
    setExpandedSeriesIds((current) =>
      current.includes(seriesId) ? current.filter((item) => item !== seriesId) : [...current, seriesId],
    );
  };

  const refreshSeriesEpisodes = async (seriesId: string) => {
    try {
      setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: true }));
      const episodes = await api.getSeriesEpisodeBriefs(seriesId);
      setSeriesEpisodes((state) => ({ ...state, [seriesId]: episodes }));
      await loadWorkspaceData();
    } catch (error) {
      console.error("Failed to refresh series episodes:", error);
    } finally {
      setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: false }));
    }
  };

  const standaloneProjects = useMemo(() => projects.filter((project) => !project.series_id), [projects]);
  const keywordLower = keyword.trim().toLowerCase();

  const filteredSeries = useMemo(() => {
    let rows = filter === "project" ? [] : [...seriesList];
    if (ledgerTab === "recent") {
      rows = rows.sort((a, b) => parseTime(b.updated_at) - parseTime(a.updated_at)).slice(0, 8);
    } else if (ledgerTab === "risk") {
      rows = rows.filter((item) => (item.episode_count || 0) === 0 || ((item.character_count || 0) === 0 && (item.scene_count || 0) === 0));
    }
    if (keywordLower) {
      rows = rows.filter((item) => `${item.title} ${item.description || ""}`.toLowerCase().includes(keywordLower));
    }
    return rows;
  }, [filter, keywordLower, ledgerTab, seriesList]);

  const filteredProjects = useMemo(() => {
    let rows = filter === "series" ? [] : [...standaloneProjects];
    if (ledgerTab === "recent") {
      rows = rows.sort((a, b) => parseTime(b.updated_at) - parseTime(a.updated_at)).slice(0, 10);
    } else if (ledgerTab === "risk") {
      rows = rows.filter((item) => (item.frame_count || 0) === 0);
    }
    if (keywordLower) {
      rows = rows.filter((item) => item.title.toLowerCase().includes(keywordLower));
    }
    return rows;
  }, [filter, keywordLower, ledgerTab, standaloneProjects]);

  const summaryItems = useMemo(
    () => [
      { label: "全部项目", value: projects.length, icon: FolderKanban },
      { label: "系列总数", value: seriesList.length, icon: FileText },
      {
        label: "待推进",
        value: projects.filter((item) => (item.frame_count || 0) === 0).length,
        icon: Sparkles,
      },
      {
        label: "已入分镜",
        value: projects.filter((item) => (item.frame_count || 0) > 0).length,
        icon: Play,
      },
    ],
    [projects, seriesList.length],
  );

  const handleDeleteProject = async (id: string) => {
    await deleteProject(id);
    await loadWorkspaceData();
  };

  const handleDeleteSeries = async (id: string) => {
    await deleteSeries(id);
    setSeriesEpisodes((state) => {
      const next = { ...state };
      delete next[id];
      return next;
    });
    await loadWorkspaceData();
  };

  return (
    <div className="space-y-6">
      {loadError ? (
        <section className="studio-panel rounded-[1.5rem] px-5 py-4 text-sm text-rose-300" style={{ borderColor: "rgba(244,63,94,0.22)", background: "rgba(127, 29, 29, 0.24)" }}>
          项目中心加载失败：{loadError}
        </section>
      ) : null}

      <AdminSummaryStrip items={summaryItems} />

      <section className="studio-panel p-4">
        <div className="admin-filter-shell">
          <div className="admin-filter-bar">
            <label className="admin-filter-search">
              <Search size={14} className="admin-filter-search-icon" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索系列、项目或关键词"
                className="admin-filter-search-input"
              />
            </label>

            <div className="admin-filter-divider" />

            <div className="admin-filter-chip-group">
              {[
                { id: "all", label: "全部台账" },
                { id: "series", label: "系列" },
                { id: "project", label: "独立项目" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id as FilterMode)}
                  className={`admin-filter-chip ${filter === item.id ? "admin-filter-chip-active" : ""}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="admin-filter-divider" />

            <div className="admin-filter-chip-group">
              {[
                { id: "all", label: "全部" },
                { id: "recent", label: "最近编辑" },
                { id: "risk", label: "待推进" },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setLedgerTab(item.id as LedgerTab)}
                  className={`admin-filter-chip ${ledgerTab === item.id ? "admin-filter-chip-active" : ""}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setIsImportOpen(true)} className="studio-button studio-button-secondary !h-8 !px-3">
              <FileUp size={14} />
              导入剧本
            </button>

            <div className="relative">
              <button onClick={() => setShowCreateDropdown((value) => !value)} className="studio-button studio-button-primary !h-8 !px-3">
                <Plus size={14} />
                新建资源
                <ChevronDown size={14} className="ml-1" />
              </button>
              {showCreateDropdown ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                  <button onClick={() => { setIsCreateSeriesOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <FolderKanban size={14} className="text-blue-500" />
                    新建系列
                  </button>
                  <button onClick={() => { setIsCreateProjectOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <FileText size={14} className="text-blue-500" />
                    新建项目
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {filteredSeries.length > 0 ? (
        <section className="studio-panel overflow-hidden">
          <div className="admin-ledger-head">
            <h3 className="text-sm font-bold text-slate-800">系列台账</h3>
            <span className="text-[11px] font-medium text-slate-400">{filteredSeries.length} 条</span>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: "auto" }}>主信息</th>
                  <th style={{ width: "80px" }} className="admin-table-cell-center">集数</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">角色</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">场景</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">道具</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">分镜</th>
                  <th style={{ width: "120px" }} className="admin-table-cell-center">最后更新</th>
                  <th style={{ width: "160px" }} className="admin-table-cell-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSeries.map((series) => (
                  <SeriesLedgerRow
                    key={series.id}
                    series={series}
                    episodes={seriesEpisodes[series.id]}
                    episodesLoading={episodesLoadingBySeries[series.id] ?? false}
                    expanded={expandedSeriesIds.includes(series.id)}
                    onDelete={handleDeleteSeries}
                    onToggleExpand={toggleSeriesExpand}
                    onEpisodesChange={refreshSeriesEpisodes}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {filteredProjects.length > 0 ? (
        <section className="studio-panel overflow-hidden">
          <div className="admin-ledger-head">
            <h3 className="text-sm font-bold text-slate-800">独立项目台账</h3>
            <span className="text-[11px] font-medium text-slate-400">{filteredProjects.length} 条</span>
          </div>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: "auto" }}>主信息</th>
                  <th style={{ width: "120px" }} className="admin-table-cell-center whitespace-nowrap">阶段</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">角色</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">场景</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">道具</th>
                  <th style={{ width: "60px" }} className="admin-table-cell-center">分镜</th>
                  <th style={{ width: "120px" }} className="admin-table-cell-center">最后更新</th>
                  <th style={{ width: "160px" }} className="admin-table-cell-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project) => (
                  <ProjectLedgerRow key={project.id} project={project} onDelete={handleDeleteProject} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {filteredSeries.length === 0 && filteredProjects.length === 0 ? (
        <section className="studio-panel p-10 text-center">
          <Sparkles size={24} className="mx-auto opacity-10" />
          <p className="mt-4 text-sm font-semibold studio-strong">暂无符合条件的项目</p>
        </section>
      ) : null}

      <CreateProjectDialog isOpen={isCreateProjectOpen} onClose={() => setIsCreateProjectOpen(false)} />
      <CreateSeriesDialog isOpen={isCreateSeriesOpen} onClose={() => setIsCreateSeriesOpen(false)} />
      <ImportFileDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => { void loadWorkspaceData(); }} />
    </div>
  );
}
