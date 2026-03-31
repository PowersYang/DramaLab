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
  Layers3,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";

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
    <div className="studio-admin-block">
      <div className="studio-admin-ledger-row">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="studio-badge studio-badge-soft">系列</span>
            <p className="truncate text-base font-semibold studio-strong">{series.title}</p>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 studio-muted">
            {series.description || "适合多集内容的共享设定、系列角色与跨项目复用资产。"}
          </p>
        </div>

        <div className="studio-admin-meta">
          <div>
            <div className="studio-admin-meta-label">集数</div>
            <div className="studio-admin-meta-value">{series.episode_count || 0}</div>
          </div>
          <div>
            <div className="studio-admin-meta-label">角色</div>
            <div className="studio-admin-meta-value">{series.character_count || 0}</div>
          </div>
          <div>
            <div className="studio-admin-meta-label">场景</div>
            <div className="studio-admin-meta-value">{series.scene_count || 0}</div>
          </div>
          <div>
            <div className="studio-admin-meta-label">更新</div>
            <div className="studio-admin-meta-value">{formatDate(series.updated_at)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => onToggleExpand(series.id)} className="studio-button studio-button-secondary">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {expanded ? "收起分集" : "查看分集"}
          </button>
          <Link href={`/studio/series/${series.id}`} className="studio-button studio-button-primary">
            <FolderKanban size={14} />
            管理系列
          </Link>
          <button
            onClick={() => {
              if (confirm(`确定要删除系列"${series.title}"吗？这不会删除其中项目。`)) {
                onDelete(series.id);
              }
            }}
            className="studio-button studio-button-danger !min-h-[2.5rem] !px-3"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t px-5 py-5" style={{ borderColor: "var(--studio-shell-border)" }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] studio-faint">Episode Registry</div>
              <p className="mt-1 text-sm studio-muted">系列分集台账按展开加载，控制首屏请求量。</p>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {episodesLoading ? (
              [1, 2, 3].map((item) => <div key={item} className="h-24 w-52 flex-shrink-0 rounded-[1.25rem] bg-slate-100 animate-pulse" />)
            ) : (
              <>
                {sortedEpisodes.map((episode) => (
                  <Link
                    key={episode.id}
                    href={`/studio/projects/${episode.id}?seriesId=${series.id}`}
                    className="block min-h-[104px] w-56 flex-shrink-0 rounded-[1.3rem] border p-4 transition-colors hover:border-[rgba(166,75,42,0.24)] hover:bg-white"
                    style={{ borderColor: "var(--studio-shell-border)", background: "rgba(255,255,255,0.82)" }}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--studio-shell-accent)" }}>
                      EP {episode.episode_number || "?"}
                    </p>
                    <p className="mt-2 line-clamp-1 text-sm font-semibold studio-strong">{episode.title}</p>
                    <p className="mt-2 text-xs studio-muted">{episode.frame_count || 0} 分镜 · 进入单集编辑</p>
                  </Link>
                ))}

                {showInlineInput ? (
                  <div
                    className="w-60 flex-shrink-0 rounded-[1.3rem] border p-4"
                    style={{ borderColor: "color-mix(in srgb, var(--studio-shell-accent) 36%, transparent)", background: "var(--studio-shell-accent-soft)" }}
                  >
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
                      placeholder="输入集数标题"
                      className="w-full border-none bg-transparent text-sm font-medium studio-strong outline-none placeholder:text-slate-400"
                    />
                    <div className="mt-3 flex gap-3 text-xs">
                      <button onClick={handleInlineAddEpisode} disabled={!inlineTitle.trim() || isAdding} className="font-semibold disabled:opacity-50" style={{ color: "var(--studio-shell-accent-strong)" }}>
                        {isAdding ? "创建中..." : "确认创建"}
                      </button>
                      <button onClick={() => { setShowInlineInput(false); setInlineTitle(""); }} className="studio-muted">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowInlineInput(true)}
                    className="flex min-h-[104px] w-52 flex-shrink-0 items-center justify-center rounded-[1.3rem] border border-dashed text-sm font-semibold transition-colors studio-muted hover:bg-slate-50"
                    style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}
                  >
                    + 添加分集
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProjectLedgerRow({ project, onDelete }: { project: ProjectSummary; onDelete: (id: string) => void }) {
  return (
    <div className="studio-admin-ledger-row">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="studio-badge studio-badge-soft">项目</span>
          <p className="truncate text-base font-semibold studio-strong">{project.title}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs studio-muted">
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} />
            创建于 {formatDate(project.created_at)}
          </span>
          <span>角色 {project.character_count || 0}</span>
          <span>场景 {project.scene_count || 0}</span>
          <span>分镜 {project.frame_count || 0}</span>
        </div>
      </div>

      <div className="studio-admin-meta">
        <div>
          <div className="studio-admin-meta-label">角色</div>
          <div className="studio-admin-meta-value">{project.character_count || 0}</div>
        </div>
        <div>
          <div className="studio-admin-meta-label">场景</div>
          <div className="studio-admin-meta-value">{project.scene_count || 0}</div>
        </div>
        <div>
          <div className="studio-admin-meta-label">分镜</div>
          <div className="studio-admin-meta-value">{project.frame_count || 0}</div>
        </div>
        <div>
          <div className="studio-admin-meta-label">更新</div>
          <div className="studio-admin-meta-value">{formatDate(project.updated_at)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href={`/studio/projects/${project.id}`} className="studio-button studio-button-primary">
          <Play size={14} />
          打开项目
        </Link>
        <button
          onClick={() => {
            if (confirm(`确定要删除项目"${project.title}"吗？`)) {
              onDelete(project.id);
            }
          }}
          className="studio-button studio-button-danger !min-h-[2.5rem] !px-3"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export default function StudioProjectsPage() {
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteSeries = useProjectStore((state) => state.deleteSeries);

  const [filter, setFilter] = useState<FilterMode>("all");
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
  const visibleSeries = filter === "project" ? [] : seriesList;
  const visibleProjects = filter === "series" ? [] : standaloneProjects;

  const totals = useMemo(
    () => [
      { label: "项目总数", value: projects.length, note: "工作区内全部项目记录", icon: FileText },
      { label: "系列总数", value: seriesList.length, note: "系列母体与世界观容器", icon: Layers3 },
      { label: "独立项目", value: standaloneProjects.length, note: "未归属系列的单体项目", icon: FolderKanban },
      {
        label: "已进入分镜",
        value: projects.filter((item) => (item.frame_count || 0) > 0).length,
        note: "已开始镜头生产的项目",
        icon: Workflow,
      },
    ],
    [projects, seriesList.length, standaloneProjects.length],
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

      <section className="studio-panel overflow-hidden">
        <div className="grid gap-6 border-b px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:px-6" style={{ borderColor: "var(--studio-shell-border)" }}>
          <div>
            <div className="studio-eyebrow">Project Registry</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] studio-strong">项目台账与系列编排中心</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 studio-muted">
              这里不再强调创作卡片，而是按后台管理视角组织项目母体、系列编排、独立项目和分集状态，便于运营和制作管理一起判断资源分布。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {totals.slice(0, 2).map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="studio-kpi">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</div>
                    <span className="studio-stat-icon"><Icon size={16} /></span>
                  </div>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</p>
                  <p className="mt-2 text-xs leading-6 studio-muted">{item.note}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-4 lg:px-6">
          {totals.slice(2).map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="studio-kpi">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] studio-faint">{item.label}</div>
                  <span className="studio-stat-icon"><Icon size={16} /></span>
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] studio-strong">{item.value}</p>
                <p className="mt-2 text-xs leading-6 studio-muted">{item.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="studio-panel px-5 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="studio-tab-strip flex flex-wrap items-center gap-1">
            {[
              { id: "all", label: "全部台账" },
              { id: "series", label: "系列编排" },
              { id: "project", label: "独立项目" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id as FilterMode)}
                className={`studio-tab ${filter === item.id ? "studio-tab-active" : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => setIsImportOpen(true)} className="studio-button studio-button-secondary">
              <FileUp size={16} />
              导入剧本
            </button>

            <div className="relative">
              <button onClick={() => setShowCreateDropdown((value) => !value)} className="studio-button studio-button-primary">
                <Plus size={16} />
                新建资源
                <ChevronDown size={16} />
              </button>
              {showCreateDropdown ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-[1.5rem] p-2 shadow-xl" style={{ border: "1px solid var(--studio-shell-border)", background: "var(--studio-shell-panel-strong)" }}>
                  <button onClick={() => { setIsCreateSeriesOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold studio-muted hover:bg-slate-50">
                    <FolderKanban size={16} style={{ color: "var(--studio-shell-accent)" }} />
                    新建系列
                  </button>
                  <button onClick={() => { setIsCreateProjectOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold studio-muted hover:bg-slate-50">
                    <FileText size={16} style={{ color: "var(--studio-shell-accent)" }} />
                    新建项目
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {visibleSeries.length > 0 ? (
        <section className="studio-panel overflow-hidden">
          <div className="border-b px-5 py-4 lg:px-6" style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}>
            <div className="studio-eyebrow">Series Ledger</div>
            <h3 className="mt-2 text-xl font-semibold studio-strong">系列编排台账</h3>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--studio-shell-border)" }}>
            {visibleSeries.map((series) => (
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
          </div>
        </section>
      ) : null}

      {visibleProjects.length > 0 ? (
        <section className="studio-panel overflow-hidden">
          <div className="border-b px-5 py-4 lg:px-6" style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}>
            <div className="studio-eyebrow">Standalone Registry</div>
            <h3 className="mt-2 text-xl font-semibold studio-strong">独立项目台账</h3>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--studio-shell-border)" }}>
            {visibleProjects.map((project) => (
              <ProjectLedgerRow key={project.id} project={project} onDelete={handleDeleteProject} />
            ))}
          </div>
        </section>
      ) : null}

      {visibleSeries.length === 0 && visibleProjects.length === 0 ? (
        <section className="studio-panel p-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--studio-shell-accent-soft)", color: "var(--studio-shell-accent-strong)" }}>
            <Sparkles size={24} />
          </div>
          <p className="mt-4 text-base font-semibold studio-strong">当前筛选条件下没有可展示的项目资源</p>
          <p className="mt-2 text-sm leading-7 studio-muted">可以新建系列、导入剧本，或者切回“全部台账”查看完整项目母体。</p>
        </section>
      ) : null}

      <CreateProjectDialog isOpen={isCreateProjectOpen} onClose={() => setIsCreateProjectOpen(false)} />
      <CreateSeriesDialog isOpen={isCreateSeriesOpen} onClose={() => setIsCreateSeriesOpen(false)} />
      <ImportFileDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => { void loadWorkspaceData(); }} />
    </div>
  );
}
