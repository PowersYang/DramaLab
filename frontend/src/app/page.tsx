"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, FolderOpen, Library, Calendar, Play, Trash2, FileUp, X, ChevronDown, FileText } from "lucide-react";
import { useProjectStore, Series, Project } from "@/store/projectStore";
import ProjectCard from "@/components/project/ProjectCard";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import CreativeCanvas from "@/components/canvas/CreativeCanvas";
import AppShell from "@/components/layout/AppShell";
import type { GlobalTab } from "@/components/layout/GlobalSidebar";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";

const ProjectClient = dynamic(() => import("@/components/project/ProjectClient"), { ssr: false });
const SeriesDetailPage = dynamic(() => import("@/components/series/SeriesDetailPage"), { ssr: false });
const ImportFileDialog = dynamic(() => import("@/components/series/ImportFileDialog"), { ssr: false });
const SettingsPage = dynamic(() => import("@/components/settings/SettingsPage"), { ssr: false });
const AssetLibraryPage = dynamic(() => import("@/components/library/AssetLibraryPage"), { ssr: false });

const parseDateMs = (value?: string | number | null) => {
  // 兼容历史秒级时间戳和新引入的 ISO datetime，首页排序与展示都走这一层兜底。
  if (value == null) return 0;
  if (typeof value === "number") return value * 1000;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

// ── Create Series Dialog ──
function CreateSeriesDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createSeries = useProjectStore((state) => state.createSeries);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!title.trim()) return;
    setIsCreating(true);
    try {
      const series = await createSeries(title.trim(), description.trim() || undefined);
      setTitle("");
      setDescription("");
      onClose();
      window.location.hash = `#/series/${series.id}`;
    } catch (error) {
      console.error("Failed to create series:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-display font-bold text-white">新建系列</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">系列标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：我的漫剧系列"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-primary transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">描述（可选）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述这个系列..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-primary transition-colors resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? "创建中..." : "创建系列"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Series Card (col-span-2 + episode preview strip) ──
function SeriesCard({
  series,
  onDelete,
  episodes,
  episodesLoading,
  onEpisodesChange,
}: {
  series: Series;
  onDelete: (id: string) => void;
  episodes: Project[] | undefined;
  episodesLoading: boolean;
  onEpisodesChange: (seriesId: string) => void;
}) {
  const [inlineTitle, setInlineTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showInlineInput, setShowInlineInput] = useState(false);

  const handleOpen = () => {
    window.location.hash = `#/series/${series.id}`;
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定要删除系列"${series.title}"吗？这不会删除其中的项目。`)) {
      onDelete(series.id);
    }
  };

  const handleInlineAddEpisode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!inlineTitle.trim()) return;
    setIsAdding(true);
    try {
      const nextEpNum = (episodes?.length || 0) + 1;
      await api.createEpisodeForSeries(series.id, inlineTitle.trim(), nextEpNum);
      setInlineTitle("");
      setShowInlineInput(false);
      onEpisodesChange(series.id);
    } catch (error) {
      console.error("Failed to add episode inline:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const sortedEpisodes = episodes
    ? [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className="glass-panel p-6 rounded-xl cursor-pointer group relative border-l-2 border-l-blue-500"
      onClick={handleOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
              系列
            </span>
            <h3 className="text-lg font-display font-bold text-white">
              {series.title}
            </h3>
          </div>
          {series.description && (
            <p className="text-sm text-gray-400 mb-2 line-clamp-1">{series.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>集数 <span className="text-white font-medium">{series.episode_ids?.length || 0}</span></span>
            <span className="text-gray-600">·</span>
            <span>角色 <span className="text-white font-medium">{series.characters?.length || 0}</span></span>
            <span className="text-gray-600">·</span>
            <span>场景 <span className="text-white font-medium">{series.scenes?.length || 0}</span></span>
          </div>
        </div>

        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleDelete}
            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Episode preview strip */}
      <div className="mt-4 -mx-1">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin" onClick={(e) => e.stopPropagation()}>
          {episodesLoading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-shrink-0 w-28 h-16 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </>
          ) : (
            <>
              {sortedEpisodes.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => { window.location.hash = `#/series/${series.id}/episode/${ep.id}`; }}
                  className="flex-shrink-0 w-28 p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-gray-700/50 hover:border-gray-500/50 transition-colors text-left"
                >
                  <span className="text-[10px] text-primary font-mono font-bold block">EP{ep.episode_number || "?"}</span>
                  <span className="text-xs text-white truncate block mt-0.5">{ep.title}</span>
                  <span className="text-[10px] text-gray-500 block mt-0.5">{ep.frames?.length || 0} 分镜</span>
                </button>
              ))}

              {/* Inline add episode */}
              {showInlineInput ? (
                <div className="flex-shrink-0 w-36 p-2 rounded-lg bg-white/5 border border-primary/30 flex flex-col gap-1">
                  <input
                    type="text"
                    value={inlineTitle}
                    onChange={(e) => setInlineTitle(e.target.value)}
                    placeholder="集数标题..."
                    className="w-full bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleInlineAddEpisode(e as unknown as React.MouseEvent);
                      if (e.key === "Escape") { setShowInlineInput(false); setInlineTitle(""); }
                    }}
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleInlineAddEpisode}
                      disabled={!inlineTitle.trim() || isAdding}
                      className="flex-1 text-[10px] text-primary hover:text-white transition-colors disabled:opacity-50"
                    >
                      {isAdding ? "..." : "确定"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowInlineInput(false); setInlineTitle(""); }}
                      className="text-[10px] text-gray-500 hover:text-white transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowInlineInput(true); }}
                  className="flex-shrink-0 w-28 p-2 rounded-lg border border-dashed border-gray-600 hover:border-gray-400 bg-white/[0.02] hover:bg-white/5 transition-colors flex flex-col items-center justify-center gap-1"
                >
                  <Plus size={14} className="text-gray-500" />
                  <span className="text-[10px] text-gray-500">添加集数</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700/30">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Calendar size={12} />
          <span>{parseDateMs(series.created_at) ? new Date(parseDateMs(series.created_at)).toLocaleDateString('zh-CN') : '-'}</span>
        </div>
        <div className="flex items-center gap-1 text-primary text-xs font-medium">
          <Play size={14} />
          <span>打开系列</span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Episode Breadcrumb Wrapper ──
function EpisodeBreadcrumbWrapper({ seriesId, episodeId }: { seriesId: string; episodeId: string }) {
  const [seriesTitle, setSeriesTitle] = useState<string>("");
  const [episodeNumber, setEpisodeNumber] = useState<number | null>(null);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const series = await api.getSeries(seriesId);
        setSeriesTitle(series.title || "");
        const episodes = await api.getSeriesEpisodes(seriesId);
        const ep = episodes.find((e: Project) => e.id === episodeId);
        if (ep) {
          setEpisodeNumber(ep.episode_number ?? null);
        }
      } catch (error) {
        console.error("Failed to fetch series info for breadcrumb:", error);
      }
    };
    fetchInfo();
  }, [seriesId, episodeId]);

  const segments = [
    { label: "LumenX", hash: "#/" },
    { label: seriesTitle || "系列", hash: `#/series/${seriesId}` },
    { label: episodeNumber != null ? `第${episodeNumber}集` : "集数" },
  ];

  return (
    <ProjectClient id={episodeId} breadcrumbSegments={segments} />
  );
}

// ── Main Component ──
export default function Home() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSeriesDialogOpen, setIsSeriesDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'project' | 'series' | 'series-episode' | 'library' | 'settings'>('home');
  const [activeTab, setActiveTab] = useState<GlobalTab>("workspace");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, Project[]>>({});
  const [episodesLoadingBySeries, setEpisodesLoadingBySeries] = useState<Record<string, boolean>>({});
  const projects = useProjectStore((state) => state.projects);
  const seriesList = useProjectStore((state) => state.seriesList);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const deleteSeries = useProjectStore((state) => state.deleteSeries);
  const setProjects = useProjectStore((state) => state.setProjects);
  const setSeriesList = useProjectStore((state) => state.setSeriesList);

  const refreshWorkspaceData = async () => {
    try {
      const [backendProjects, backendSeries] = await Promise.all([
        api.getProjects(),
        api.listSeries(),
      ]);
      // 工作区首页始终以后端最新列表为准，哪怕后端当前返回空数组，也不能继续保留旧缓存。
      setProjects(backendProjects || []);
      setSeriesList(backendSeries || []);
    } catch (error) {
      console.error("Failed to refresh workspace data:", error);
    }
  };

  // 首屏进入工作区时自动刷新，不再依赖手动“同步”按钮。
  useEffect(() => {
    void refreshWorkspaceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentView !== "home") {
      return;
    }
    void refreshWorkspaceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  useEffect(() => {
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible" && currentView === "home") {
        void refreshWorkspaceData();
      }
    };
    const handleWindowFocus = () => {
      if (currentView === "home") {
        void refreshWorkspaceData();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleWindowFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  // 系列卡片先展示出来，再让每个系列独立补分集，避免首页被全局 loading 拖慢。
  useEffect(() => {
    if (seriesList.length === 0) return;
    void loadAllSeriesEpisodes(seriesList.map((series) => series.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesList]);

  const loadAllSeriesEpisodes = async (seriesIds: string[]) => {
    if (seriesIds.length === 0) {
      return;
    }
    setEpisodesLoadingBySeries((prev) => ({
      ...prev,
      ...Object.fromEntries(seriesIds.map((id) => [id, true])),
    }));
    try {
      const results = await Promise.all(
        seriesIds.map(async (seriesId) => {
          const eps = await api.getSeriesEpisodes(seriesId);
          return [seriesId, eps] as const;
        })
      );
      setSeriesEpisodes((prev) => ({
        ...prev,
        ...Object.fromEntries(results),
      }));
    } catch (error) {
      console.error("Failed to load series episodes:", error);
    } finally {
      setEpisodesLoadingBySeries((prev) => ({
        ...prev,
        ...Object.fromEntries(seriesIds.map((id) => [id, false])),
      }));
    }
  };

  const refreshSeriesEpisodes = async (sid: string) => {
    try {
      setEpisodesLoadingBySeries((prev) => ({ ...prev, [sid]: true }));
      const eps = await api.getSeriesEpisodes(sid);
      setSeriesEpisodes((prev) => ({ ...prev, [sid]: eps }));
    } catch (error) {
      console.error("Failed to refresh series episodes:", error);
    } finally {
      setEpisodesLoadingBySeries((prev) => ({ ...prev, [sid]: false }));
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showCreateDropdown) return;
    const handleClick = () => setShowCreateDropdown(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [showCreateDropdown]);

  // 监听 hash 变化
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      // Match #/series/{id}/episode/{eid} first (more specific)
      const seriesEpisodeMatch = hash.match(/^#\/series\/([^/]+)\/episode\/([^/]+)$/);
      if (seriesEpisodeMatch) {
        setSeriesId(seriesEpisodeMatch[1]);
        setEpisodeId(seriesEpisodeMatch[2]);
        setProjectId(null);
        setCurrentView('series-episode');
        return;
      }
      // Match #/series/{id}
      const seriesMatch = hash.match(/^#\/series\/([^/]+)$/);
      if (seriesMatch) {
        setSeriesId(seriesMatch[1]);
        setEpisodeId(null);
        setProjectId(null);
        setCurrentView('series');
        return;
      }
      if (hash.startsWith('#/project/')) {
        const id = hash.replace('#/project/', '');
        setProjectId(id);
        setSeriesId(null);
        setEpisodeId(null);
        setCurrentView('project');
        return;
      }
      if (hash === '#/library') {
        setCurrentView('library');
        setActiveTab('library');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      if (hash === '#/settings') {
        setCurrentView('settings');
        setActiveTab('settings');
        setProjectId(null);
        setSeriesId(null);
        setEpisodeId(null);
        return;
      }
      // Default: workspace
      setCurrentView('home');
      setActiveTab('workspace');
      setProjectId(null);
      setSeriesId(null);
      setEpisodeId(null);
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 项目详情页 — 全屏，无 GlobalSidebar
  if (currentView === 'project' && projectId) {
    return <ProjectClient id={projectId} />;
  }

  // 系列集数编辑 — 全屏，BreadcrumbBar 内嵌在 ProjectClient
  if (currentView === 'series-episode' && seriesId && episodeId) {
    return <EpisodeBreadcrumbWrapper seriesId={seriesId} episodeId={episodeId} />;
  }

  // 系列详情页 — 全屏，自带 BreadcrumbBar
  if (currentView === 'series' && seriesId) {
    return <SeriesDetailPage seriesId={seriesId} />;
  }

  // Filter standalone projects (not belonging to any series)
  const standaloneProjects = projects.filter((p) => !p.series_id);

  // Build mixed list: series + standalone projects, sorted by creation time descending
  type ListItem = { type: 'series'; data: Series; sortTime: number } | { type: 'project'; data: Project; sortTime: number };
  const mixedList: ListItem[] = [
    ...seriesList.map((s) => ({ type: 'series' as const, data: s, sortTime: parseDateMs(s.created_at) })),
    ...standaloneProjects.map((p) => ({
      type: 'project' as const,
      data: p,
      sortTime: p.createdAt ? new Date(p.createdAt).getTime() : parseDateMs(p.created_at),
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);

  const totalCount = mixedList.length;

  const handleTabChange = (tab: GlobalTab) => {
    setActiveTab(tab);
  };

  // Determine content based on activeTab
  const renderContent = () => {
    if (currentView === 'library') {
      return <AssetLibraryPage />;
    }
    if (currentView === 'settings') {
      return <SettingsPage />;
    }

    // Workspace view
    return (
      <div className="container mx-auto px-6 py-8">
        {/* Content Section */}
        {totalCount === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <FolderOpen size={64} className="text-gray-600 mb-4" />
            <h3 className="text-xl font-medium text-gray-400 mb-2">还没有项目</h3>
            <p className="text-gray-500 mb-8">选择一种方式开始创作</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-xl w-full">
              <button
                onClick={() => setIsSeriesDialogOpen(true)}
                className="glass-panel p-6 rounded-xl border border-blue-500/30 hover:border-blue-500/60 transition-all group text-left"
              >
                <Library size={32} className="text-blue-400 mb-3" />
                <h4 className="text-lg font-display font-bold text-white mb-1 group-hover:text-blue-400 transition-colors">创建系列</h4>
                <p className="text-sm text-gray-400">适合多集连续故事</p>
              </button>
              <button
                onClick={() => setIsDialogOpen(true)}
                className="glass-panel p-6 rounded-xl border border-gray-600/30 hover:border-gray-500/60 transition-all group text-left"
              >
                <FileText size={32} className="text-gray-400 mb-3" />
                <h4 className="text-lg font-display font-bold text-white mb-1 group-hover:text-primary transition-colors">创建独立项目</h4>
                <p className="text-sm text-gray-400">适合单个短视频</p>
              </button>
            </div>
          </motion.div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-display font-bold text-white">
                我的工作区 ({totalCount})
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsImportDialogOpen(true)}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
                >
                  <FileUp size={16} />
                  导入文件
                </button>
                {/* Unified create dropdown */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowCreateDropdown((v) => !v); }}
                    className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
                  >
                    <Plus size={16} />
                    新建
                    <ChevronDown size={14} />
                  </button>
                  {showCreateDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-20 overflow-hidden"
                    >
                      <button
                        onClick={() => { setIsSeriesDialogOpen(true); setShowCreateDropdown(false); }}
                        className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                      >
                        <Library size={16} className="text-blue-400" />
                        新建系列
                      </button>
                      <button
                        onClick={() => { setIsDialogOpen(true); setShowCreateDropdown(false); }}
                        className="w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                      >
                        <FileText size={16} className="text-gray-400" />
                        新建独立项目
                      </button>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-12">
              {mixedList.map((item, i) => (
                <motion.div
                  key={item.type === 'series' ? `s-${item.data.id}` : `p-${(item.data as Project).id}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className={item.type === 'series' ? 'col-span-1 md:col-span-2' : ''}
                >
                  {item.type === 'series' ? (
                    <SeriesCard
                      series={item.data as Series}
                      onDelete={deleteSeries}
                      episodes={seriesEpisodes[(item.data as Series).id]}
                      episodesLoading={episodesLoadingBySeries[(item.data as Series).id] ?? false}
                      onEpisodesChange={refreshSeriesEpisodes}
                    />
                  ) : (
                    <ProjectCard project={item.data as Project} onDelete={deleteProject} />
                  )}
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main className="relative h-screen w-screen bg-background flex flex-col">
      {/* Background Canvas */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <CreativeCanvas />
      </div>

      {/* AppShell with GlobalSidebar + content */}
      <div className="relative z-10 flex-1 overflow-hidden">
        <AppShell activeTab={activeTab} onTabChange={handleTabChange}>
          {renderContent()}
        </AppShell>
      </div>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      />

      {/* Create Series Dialog */}
      <CreateSeriesDialog
        isOpen={isSeriesDialogOpen}
        onClose={() => setIsSeriesDialogOpen(false)}
      />

      {/* Environment Configuration Dialog (kept for EnvConfigChecker) */}
      <EnvConfigDialog
        isOpen={false}
        onClose={() => {}}
        isRequired={false}
      />

      {/* Import File Dialog */}
      <ImportFileDialog
        isOpen={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        onSuccess={() => {
          void refreshWorkspaceData();
        }}
      />
    </main>
  );
}
