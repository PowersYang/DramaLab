"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Calendar, ChevronDown, FileText, FileUp, Play, Plus, Trash2 } from "lucide-react";

import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import ImportFileDialog from "@/components/series/ImportFileDialog";
import CreateSeriesDialog from "@/components/studio/CreateSeriesDialog";
import { api } from "@/lib/api";
import { type Project, type Series, useProjectStore } from "@/store/projectStore";

const parseTime = (value?: string | number | null) => {
  if (value == null) return 0;
  if (typeof value === "number") return value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

type FilterMode = "all" | "series" | "project";

function SeriesResourceCard({
  series,
  episodes,
  episodesLoading,
  onDelete,
  onEpisodesChange,
}: {
  series: Series;
  episodes: Project[] | undefined;
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
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tracking-[0.18em] text-primary">系列</span>
            <h3 className="text-xl font-bold text-slate-950">{series.title}</h3>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{series.description || "适合多集项目的共享资产与创作容器。"}</p>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>集数 <strong className="text-slate-900">{series.episode_ids?.length || 0}</strong></span>
            <span>角色 <strong className="text-slate-900">{series.characters?.length || 0}</strong></span>
            <span>场景 <strong className="text-slate-900">{series.scenes?.length || 0}</strong></span>
            <span>更新于 <strong className="text-slate-900">{new Date(parseTime(series.updated_at)).toLocaleDateString("zh-CN")}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/studio/series/${series.id}`} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/40 hover:text-slate-950">
            查看系列
          </Link>
          <button
            onClick={() => {
              if (confirm(`确定要删除系列"${series.title}"吗？这不会删除其中项目。`)) {
                onDelete(series.id);
              }
            }}
            className="rounded-full border border-rose-200 bg-rose-50 p-2.5 text-rose-600 transition-colors hover:bg-rose-100"
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
                className="block min-h-[96px] w-52 flex-shrink-0 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-primary/40 hover:bg-white"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">EP {episode.episode_number || "?"}</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{episode.title}</p>
                <p className="mt-1 text-xs text-slate-500">{episode.frames?.length || 0} 分镜 · 进入集数编辑</p>
              </Link>
            ))}
            {showInlineInput ? (
              <div className="w-56 flex-shrink-0 rounded-[1.5rem] border border-primary/30 bg-primary/5 p-4">
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
                  className="w-full border-none bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
                />
                <div className="mt-3 flex gap-3 text-xs">
                  <button onClick={handleInlineAddEpisode} disabled={!inlineTitle.trim() || isAdding} className="font-semibold text-primary disabled:opacity-50">
                    {isAdding ? "创建中..." : "确认创建"}
                  </button>
                  <button
                    onClick={() => {
                      setShowInlineInput(false);
                      setInlineTitle("");
                    }}
                    className="text-slate-500"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowInlineInput(true)}
                className="flex min-h-[96px] w-48 flex-shrink-0 items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-500 transition-colors hover:border-primary/40 hover:text-slate-900"
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

function ProjectResourceCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const createdDate = project.createdAt ? new Date(project.createdAt) : new Date(parseTime(project.created_at));

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="studio-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-950/5 px-2.5 py-1 text-xs font-semibold tracking-[0.18em] text-slate-600">项目</span>
            <h3 className="text-xl font-bold text-slate-950">{project.title}</h3>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><Calendar size={12} /> {Number.isNaN(createdDate.getTime()) ? "-" : createdDate.toLocaleDateString("zh-CN")}</span>
            <span>角色 {project.characters?.length || 0}</span>
            <span>场景 {project.scenes?.length || 0}</span>
            <span>分镜 {project.frames?.length || 0}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/studio/projects/${project.id}`} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
            <Play size={14} />
            打开项目
          </Link>
          <button
            onClick={() => {
              if (confirm(`确定要删除项目"${project.title}"吗？`)) {
                onDelete(project.id);
              }
            }}
            className="rounded-full border border-rose-200 bg-rose-50 p-2.5 text-rose-600 transition-colors hover:bg-rose-100"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function StudioProjectsPage() {
  const projects = useProjectStore((state) => state.projects);
  const seriesList = useProjectStore((state) => state.seriesList);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteSeries = useProjectStore((state) => state.deleteSeries);
  const setProjects = useProjectStore((state) => state.setProjects);
  const setSeriesList = useProjectStore((state) => state.setSeriesList);

  const [filter, setFilter] = useState<FilterMode>("all");
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isCreateSeriesOpen, setIsCreateSeriesOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, Project[]>>({});
  const [episodesLoadingBySeries, setEpisodesLoadingBySeries] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const [projectsData, seriesData] = await Promise.all([api.getProjects(), api.listSeries()]);
      setProjects(projectsData);
      setSeriesList(seriesData);

      await Promise.all(
        seriesData.map(async (series: Series) => {
          try {
            setEpisodesLoadingBySeries((state) => ({ ...state, [series.id]: true }));
            const episodes = await api.getSeriesEpisodes(series.id);
            setSeriesEpisodes((state) => ({ ...state, [series.id]: episodes }));
          } finally {
            setEpisodesLoadingBySeries((state) => ({ ...state, [series.id]: false }));
          }
        })
      );
    };

    void load();
  }, [setProjects, setSeriesList]);

  const refreshSeriesEpisodes = async (seriesId: string) => {
    try {
      setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: true }));
      const episodes = await api.getSeriesEpisodes(seriesId);
      setSeriesEpisodes((state) => ({ ...state, [seriesId]: episodes }));
    } catch (error) {
      console.error("Failed to refresh series episodes:", error);
    } finally {
      setEpisodesLoadingBySeries((state) => ({ ...state, [seriesId]: false }));
    }
  };

  const standaloneProjects = useMemo(() => projects.filter((project) => !project.series_id), [projects]);

  const visibleSeries = filter === "project" ? [] : seriesList;
  const visibleProjects = filter === "series" ? [] : standaloneProjects;

  return (
    <div className="space-y-6">
      <section className="studio-panel px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {[
              { id: "all", label: "全部资源" },
              { id: "series", label: "系列" },
              { id: "project", label: "项目" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id as FilterMode)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  filter === item.id ? "bg-primary text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => setIsImportOpen(true)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              <span className="inline-flex items-center gap-2"><FileUp size={16} /> 导入剧本</span>
            </button>

            <div className="relative">
              <button onClick={() => setShowCreateDropdown((value) => !value)} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
                <span className="inline-flex items-center gap-2"><Plus size={16} /> 新建 <ChevronDown size={16} /></span>
              </button>
              {showCreateDropdown && (
                <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-xl">
                  <button onClick={() => { setIsCreateSeriesOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <FolderKanban size={16} className="text-primary" />
                    新建系列
                  </button>
                  <button onClick={() => { setIsCreateProjectOpen(true); setShowCreateDropdown(false); }} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <FileText size={16} className="text-primary" />
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
            onDelete={deleteSeries}
            onEpisodesChange={refreshSeriesEpisodes}
          />
        ))}

        {visibleProjects.map((project) => (
          <ProjectResourceCard key={project.id} project={project} onDelete={deleteProject} />
        ))}

        {visibleSeries.length === 0 && visibleProjects.length === 0 && (
          <div className="studio-panel p-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles size={24} />
            </div>
            <h3 className="mt-4 text-xl font-bold text-slate-950">工作区已经准备好商业化承载结构</h3>
            <p className="mt-3 text-sm leading-7 text-slate-500">先创建一个系列或项目，你就会看到新的资源管理方式、任务流和创作入口。</p>
          </div>
        )}
      </section>

      <CreateProjectDialog isOpen={isCreateProjectOpen} onClose={() => setIsCreateProjectOpen(false)} />
      <CreateSeriesDialog isOpen={isCreateSeriesOpen} onClose={() => setIsCreateSeriesOpen(false)} />
      <ImportFileDialog isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} onSuccess={() => undefined} />
    </div>
  );
}
