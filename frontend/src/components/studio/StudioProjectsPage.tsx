"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Calendar, ChevronDown, FileText, FileUp, FolderKanban, Play, Plus, Sparkles, Trash2 } from "lucide-react";

import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import ImportFileDialog from "@/components/series/ImportFileDialog";
import CreateSeriesDialog from "@/components/studio/CreateSeriesDialog";
import { api, type EpisodeBrief, type ProjectSummary, type SeriesSummary } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";

const parseTime = (value?: string | number | null) => {
  if (value == null) return 0;
  if (typeof value === "number") return value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const PROJECTS_DASHBOARD_LOG_PREFIX = "[projects-dashboard]";

type FilterMode = "all" | "series" | "project";

function SeriesResourceCard({
  series,
  episodes,
  episodesLoading,
  onDelete,
  onEpisodesChange,
}: {
  series: SeriesSummary;
  episodes: EpisodeBrief[] | undefined;
  episodesLoading: boolean;
  onDelete: (id: string) => void;
  onEpisodesChange: (seriesId: string) => void;
}) {
  const [inlineTitle, setInlineTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showInlineInput, setShowInlineInput] = useState(false);

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

  const sortedEpisodes = episodes ? [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0)) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="studio-panel p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="studio-badge studio-badge-soft">系列</span>
            <h3 className="text-xl font-semibold studio-strong">{series.title}</h3>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 studio-muted">{series.description || "适合多集项目的共享资产与创作容器。"}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-xs studio-muted">
            <span>集数 <strong className="studio-strong">{series.episode_count || 0}</strong></span>
            <span>角色 <strong className="studio-strong">{series.character_count || 0}</strong></span>
            <span>场景 <strong className="studio-strong">{series.scene_count || 0}</strong></span>
            <span>更新于 <strong className="studio-strong">{new Date(parseTime(series.updated_at)).toLocaleDateString("zh-CN")}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/studio/series/${series.id}`} className="studio-button studio-button-secondary">
            查看系列
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

      <div className="mt-6 flex gap-3 overflow-x-auto pb-2">
        {episodesLoading ? (
          [1, 2, 3].map((item) => <div key={item} className="h-24 w-48 flex-shrink-0 rounded-[1.5rem] bg-slate-100 animate-pulse" />)
        ) : (
          <>
            {sortedEpisodes.map((episode) => (
              <Link
                key={episode.id}
                href={`/studio/projects/${episode.id}?seriesId=${series.id}`}
                className="block min-h-[96px] w-52 flex-shrink-0 rounded-[1.5rem] p-4 transition-colors"
                style={{ border: "1px solid var(--studio-shell-border)", background: "color-mix(in srgb, var(--studio-shell-panel-strong) 94%, transparent)" }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--studio-shell-accent)" }}>EP {episode.episode_number || "?"}</p>
                <p className="mt-2 text-sm font-semibold studio-strong">{episode.title}</p>
                <p className="mt-1 text-xs studio-muted">{episode.frame_count || 0} 分镜 · 进入集数编辑</p>
              </Link>
            ))}
            {showInlineInput ? (
              <div className="w-56 flex-shrink-0 rounded-[1.5rem] p-4" style={{ border: "1px solid color-mix(in srgb, var(--studio-shell-accent) 36%, transparent)", background: "var(--studio-shell-accent-soft)" }}>
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
                className="flex min-h-[96px] w-48 flex-shrink-0 items-center justify-center rounded-[1.5rem] border border-dashed text-sm font-semibold transition-colors studio-muted"
                style={{ borderColor: "var(--studio-shell-border)", background: "var(--studio-shell-panel-soft)" }}
              >
                + 添加集数
              </button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function ProjectResourceCard({ project, onDelete }: { project: ProjectSummary; onDelete: (id: string) => void }) {
  const createdDate = new Date(parseTime(project.created_at));

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="studio-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="studio-badge studio-badge-soft">项目</span>
            <h3 className="text-xl font-semibold studio-strong">{project.title}</h3>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs studio-muted">
            <span className="inline-flex items-center gap-1"><Calendar size={12} /> {Number.isNaN(createdDate.getTime()) ? "-" : createdDate.toLocaleDateString("zh-CN")}</span>
            <span>角色 {project.character_count || 0}</span>
            <span>场景 {project.scene_count || 0}</span>
            <span>分镜 {project.frame_count || 0}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
    </motion.div>
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

  const loadWorkspaceData = async () => {
    const startedAt = performance.now();
    try {
      setLoadError(null);
      const [projectsData, seriesData] = await Promise.all([
        logRequestDuration("project-summaries", api.getProjectSummaries()),
        logRequestDuration("series-summaries", api.listSeriesSummaries()),
      ]);
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
  };

  useEffect(() => {
    if (didInitialLoadRef.current) {
      return;
    }
    didInitialLoadRef.current = true;
    void loadWorkspaceData();
  }, []);

  useEffect(() => {
    // 项目中心首屏先出卡片，再渐进加载各系列分集，避免首屏被 N 个 episodes 请求阻塞。
    if (seriesList.length === 0) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      for (const series of seriesList) {
        if (cancelled || seriesEpisodes[series.id]) {
          continue;
        }
        try {
          setEpisodesLoadingBySeries((state) => ({ ...state, [series.id]: true }));
          const episodes = await logRequestDuration(`episode-briefs:${series.id}`, api.getSeriesEpisodeBriefs(series.id));
          if (cancelled) return;
          setSeriesEpisodes((state) => ({ ...state, [series.id]: episodes }));
        } catch (error) {
          if (cancelled) return;
          console.error("Failed to load series episode briefs:", series.id, error);
        } finally {
          if (!cancelled) {
            setEpisodesLoadingBySeries((state) => ({ ...state, [series.id]: false }));
          }
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [seriesList]);

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

  const visibleSeries = filter === "project" ? [] : seriesList;
  const visibleProjects = filter === "series" ? [] : standaloneProjects;

  return (
    <div className="space-y-6">
      {loadError && (
        <section className="studio-panel rounded-[1.5rem] px-5 py-4 text-sm text-rose-300" style={{ borderColor: "rgba(244,63,94,0.22)", background: "rgba(127, 29, 29, 0.24)" }}>
          项目中心加载失败：{loadError}
        </section>
      )}

      <section className="studio-panel px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="studio-tab-strip flex flex-wrap items-center gap-1">
            {[
              { id: "all", label: "全部资源" },
              { id: "series", label: "系列" },
              { id: "project", label: "项目" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id as FilterMode)}
                className={`studio-tab ${
                  filter === item.id ? "studio-tab-active" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => setIsImportOpen(true)} className="studio-button studio-button-secondary">
              <span className="inline-flex items-center gap-2"><FileUp size={16} /> 导入剧本</span>
            </button>

            <div className="relative">
              <button onClick={() => setShowCreateDropdown((value) => !value)} className="studio-button studio-button-primary">
                <span className="inline-flex items-center gap-2"><Plus size={16} /> 新建 <ChevronDown size={16} /></span>
              </button>
              {showCreateDropdown && (
                <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-[1.5rem] p-2 shadow-xl" style={{ border: "1px solid var(--studio-shell-border)", background: "var(--studio-shell-panel-strong)" }}>
                  <button onClick={() => { setIsCreateSeriesOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold studio-muted" style={{ background: "transparent" }}>
                    <FolderKanban size={16} style={{ color: "var(--studio-shell-accent)" }} />
                    新建系列
                  </button>
                  <button onClick={() => { setIsCreateProjectOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold studio-muted" style={{ background: "transparent" }}>
                    <FileText size={16} style={{ color: "var(--studio-shell-accent)" }} />
                    新建项目
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6">
        {visibleSeries.map((series) => (
          <SeriesResourceCard
            key={series.id}
            series={series}
            episodes={seriesEpisodes[series.id]}
            episodesLoading={episodesLoadingBySeries[series.id] ?? false}
            onDelete={handleDeleteSeries}
            onEpisodesChange={refreshSeriesEpisodes}
          />
        ))}

        {visibleProjects.map((project) => (
          <ProjectResourceCard key={project.id} project={project} onDelete={handleDeleteProject} />
        ))}

        {visibleSeries.length === 0 && visibleProjects.length === 0 && (
          <div className="studio-panel p-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--studio-shell-accent-soft)", color: "var(--studio-shell-accent-strong)" }}>
              <Sparkles size={24} />
            </div>
          </div>
        )}
      </section>

      <CreateProjectDialog isOpen={isCreateProjectOpen} onClose={() => setIsCreateProjectOpen(false)} />
      <CreateSeriesDialog isOpen={isCreateSeriesOpen} onClose={() => setIsCreateSeriesOpen(false)} />
      <ImportFileDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => { void loadWorkspaceData(); }} />
    </div>
  );
}
