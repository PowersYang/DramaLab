"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronRight,
  FileText,
  FileUp,
  FolderKanban,
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
  writeStudioCache,
} from "@/lib/studioCache";
import { useProjectStore } from "@/store/projectStore";

const ImportFileDialog = dynamic(() => import("@/components/series/ImportFileDialog"));
const CreateSeriesDialog = dynamic(() => import("@/components/studio/CreateSeriesDialog"));

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

function SeriesLedgerRow({
  series,
  episodes,
  episodesLoading,
  expanded,
  onDelete,
  onToggleExpand,
  onEpisodesChange,
  onEpisodeCreated,
}: {
  series: SeriesSummary;
  episodes: EpisodeBrief[] | undefined;
  episodesLoading: boolean;
  expanded: boolean;
  onDelete: (id: string) => void;
  onToggleExpand: (seriesId: string) => void;
  onEpisodesChange: (seriesId: string) => void;
  onEpisodeCreated: (seriesId: string, episode: EpisodeBrief, project: any) => void;
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
      const project = await api.createEpisodeForSeries(series.id, inlineTitle.trim(), nextEpisodeNumber);
      onEpisodeCreated(
        series.id,
        {
          id: project.id,
          title: project.title,
          series_id: series.id,
          episode_number: nextEpisodeNumber,
          frame_count: 0,
          created_at: project.created_at ?? project.createdAt,
          updated_at: project.updated_at ?? project.updatedAt,
        },
        project,
      );
      setInlineTitle("");
      setShowInlineInput(false);
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
              <span className="admin-status-badge admin-status-badge-neutral">剧集</span>
              <h4 className="truncate text-sm font-bold text-slate-800">{series.title}</h4>
            </div>
            <p className="truncate text-[11px] text-slate-400">
              {series.description || "剧集主档"}
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
            <button onClick={() => onToggleExpand(series.id)} className="studio-button studio-button-secondary !h-8 !px-3 text-xs whitespace-nowrap">
              {expanded ? "收起" : "展开"}
            </button>
            <Link href={`/studio/series/${series.id}`} className="studio-button studio-button-primary !h-8 !px-3 text-xs whitespace-nowrap">
              管理
            </Link>
            <button
              onClick={() => {
                if (confirm(`确定要删除剧集"${series.title}"吗？`)) {
                  onDelete(series.id);
                }
              }}
              className="studio-button studio-button-danger !h-8 !w-8 !p-0 ml-3 flex-shrink-0"
            >
              <Trash2 size={15} />
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
                      <p className="mt-1 text-xs text-slate-400">从这里快速进入单集编辑器，或继续补齐剧集下的集数标题。</p>
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

export default function StudioProjectsPage() {
  const deleteSeries = useProjectStore((state) => state.deleteSeries);

  const [keyword, setKeyword] = useState("");
  const [isCreateSeriesOpen, setIsCreateSeriesOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
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

  const fetchSeriesEpisodes = async (seriesId: string, options?: { force?: boolean }) => {
    if (!options?.force && (seriesEpisodes[seriesId] || episodesLoadingBySeries[seriesId])) {
      return;
    }
    setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: true }));
    try {
      const episodes = await logRequestDuration(`episode-briefs:${seriesId}`, api.getSeriesEpisodeBriefs(seriesId));
      setSeriesEpisodes((state) => ({ ...state, [seriesId]: episodes }));
      return episodes;
    } catch (error) {
      console.error("Failed to load series episode briefs:", seriesId, error);
      return;
    } finally {
      setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: false }));
    }
  };

  const toggleSeriesExpand = (seriesId: string) => {
    const willExpand = !expandedSeriesIds.includes(seriesId);
    setExpandedSeriesIds((current) =>
      current.includes(seriesId) ? current.filter((item) => item !== seriesId) : [...current, seriesId],
    );
    if (willExpand) {
      void fetchSeriesEpisodes(seriesId);
    }
  };

  const refreshSeriesEpisodes = async (seriesId: string) => {
    try {
      const episodes = await fetchSeriesEpisodes(seriesId, { force: true });
      if (episodes) {
        setSeriesList((current) => {
          const next = current.map((item) =>
            item.id === seriesId
              ? { ...item, episode_count: episodes.length, updated_at: new Date().toISOString() }
              : item,
          );
          writeStudioCache(STUDIO_SERIES_SUMMARIES_CACHE_KEY, next);
          return next;
        });
      }
    } catch (error) {
      console.error("Failed to refresh series episodes:", error);
    }
  };

  const handleEpisodeCreated = useCallback((seriesId: string, episode: EpisodeBrief, project: any) => {
    setSeriesEpisodes((current) => {
      const previous = current[seriesId] || [];
      const exists = previous.some((item) => item.id === episode.id);
      const nextForSeries = exists ? previous : [...previous, episode];
      return {
        ...current,
        [seriesId]: nextForSeries,
      };
    });

    setSeriesList((current) => {
      const next = current.map((item) =>
        item.id === seriesId
          ? { ...item, episode_count: (item.episode_count || 0) + 1, updated_at: new Date().toISOString() }
          : item,
      );
      writeStudioCache(STUDIO_SERIES_SUMMARIES_CACHE_KEY, next);
      return next;
    });

    setProjects((current) => {
      const exists = current.some((item) => item.id === project.id);
      if (exists) return current;
      const createdAt = project.created_at ?? project.createdAt;
      const updatedAt = project.updated_at ?? project.updatedAt;
      const next: ProjectSummary[] = [
        ...current,
        {
          id: project.id,
          title: project.title,
          series_id: seriesId,
          episode_number: episode.episode_number ?? null,
          status: project.status || "pending",
          character_count: 0,
          scene_count: 0,
          prop_count: 0,
          frame_count: 0,
          created_at: createdAt,
          updated_at: updatedAt,
        },
      ];
      writeStudioCache(STUDIO_PROJECT_SUMMARIES_CACHE_KEY, next);
      return next;
    });
  }, []);

  const keywordLower = keyword.trim().toLowerCase();

  const filteredSeries = useMemo(() => {
    let rows = [...seriesList];
    if (keywordLower) {
      rows = rows.filter((item) => `${item.title} ${item.description || ""}`.toLowerCase().includes(keywordLower));
    }
    return rows;
  }, [keywordLower, seriesList]);

  const summaryItems = useMemo(
    () => [
      { label: "剧集总数", value: seriesList.length, icon: FolderKanban },
      {
        label: "待推进",
        value: projects.filter((item) => item.series_id && (item.frame_count || 0) === 0).length,
        icon: Sparkles,
      },
      {
        label: "已入分镜",
        value: projects.filter((item) => item.series_id && (item.frame_count || 0) > 0).length,
        icon: Calendar,
      },
    ],
    [projects, seriesList.length],
  );

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
          剧集中心加载失败：{loadError}
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
                placeholder="搜索剧集、单集项目或关键词"
                className="admin-filter-search-input"
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setIsImportOpen(true)} className="studio-button studio-button-secondary !h-8 !px-3">
              <FileUp size={14} />
              导入剧本
            </button>

            <button
              onClick={() => setIsCreateSeriesOpen(true)}
              className="studio-button studio-button-primary !h-8 !px-3"
            >
              <FolderKanban size={14} />
              新建剧集
            </button>
          </div>
        </div>
      </section>

      {filteredSeries.length > 0 ? (
        <section className="studio-panel overflow-hidden">
          <div className="admin-ledger-head">
            <h3 className="text-sm font-bold text-slate-800">剧集列表</h3>
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
                  <th style={{ width: "180px" }} className="admin-table-cell-right">操作</th>
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
                    onEpisodeCreated={handleEpisodeCreated}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {filteredSeries.length === 0 ? (
        <section className="studio-panel p-10 text-center">
          <Sparkles size={24} className="mx-auto opacity-10" />
          <p className="mt-4 text-sm font-semibold studio-strong">暂无符合条件的剧集</p>
        </section>
      ) : null}

      <CreateSeriesDialog isOpen={isCreateSeriesOpen} onClose={() => setIsCreateSeriesOpen(false)} />
      <ImportFileDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => { void loadWorkspaceData(); }} />
    </div>
  );
}
