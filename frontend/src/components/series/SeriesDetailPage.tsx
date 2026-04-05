"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Play, ChevronRight, Film, Sparkles, FolderKanban, Package, Check, X, PencilLine, Users, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, type EpisodeBrief } from "@/lib/api";
import type { Series, Character, Scene, Prop, Project } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import AssetTypeTabs from "@/components/common/AssetTypeTabs";
import SeriesSidebar, { type SidebarItem } from "./SeriesSidebar";
import { persistStudioTheme, readStoredStudioTheme, type StudioTheme } from "@/components/studio/studioTheme";
import CreateEpisodeDialog from "@/components/series/CreateEpisodeDialog";

const CreativeCanvas = dynamic(() => import("@/components/canvas/CreativeCanvas"), { ssr: false });
const ImportAssetsDialog = dynamic(() => import("./ImportAssetsDialog"), { ssr: false });

interface SeriesDetailPageProps {
  seriesId: string;
  homeHref?: string;
}

type AssetTab = "characters" | "scenes" | "props";

const ASSET_LABELS: Record<AssetTab, string> = {
  characters: "角色",
  scenes: "场景",
  props: "道具",
};

export default function SeriesDetailPage({ seriesId, homeHref = "/studio/projects" }: SeriesDetailPageProps) {
  const router = useRouter();
  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<SidebarItem>({ kind: "shared_assets" });
  const [assetTab, setAssetTab] = useState<AssetTab>("characters");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showImportAssets, setShowImportAssets] = useState(false);
  const [isCreateEpisodeOpen, setIsCreateEpisodeOpen] = useState(false);
  const [theme, setTheme] = useState<StudioTheme>("light");
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Project | null>(null);
  const [selectedEpisodeLoading, setSelectedEpisodeLoading] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [seriesData, episodesBriefs] = await Promise.all([
          api.getSeriesLight(seriesId),
          api.getSeriesEpisodeBriefs(seriesId),
        ]);
        setSeries(seriesData);
        setEpisodes(episodesBriefs);
        setEditTitle(seriesData.title);
      } catch (error) {
        console.error("Failed to fetch series data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [seriesId]);

  useEffect(() => {
    if (activeItem.kind === "episode") {
      setSelectedEpisodeLoading(true);
      api.getProject(activeItem.episodeId)
        .then((project) => setSelectedEpisode(project))
        .catch((error) => {
          console.error("Failed to load episode details:", error);
          setSelectedEpisode(null);
        })
        .finally(() => setSelectedEpisodeLoading(false));
    } else {
      setSelectedEpisode(null);
      setSelectedEpisodeLoading(false);
    }
  }, [activeItem]);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [seriesId]);

  useEffect(() => {
    setTheme(readStoredStudioTheme());
  }, []);

  useEffect(() => {
    persistStudioTheme(theme);
  }, [theme]);

  useEffect(() => {
    setShowCanvas(false);
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setShowCanvas(true), { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timeoutId = window.setTimeout(() => setShowCanvas(true), 200);
    return () => window.clearTimeout(timeoutId);
  }, [seriesId]);

  const handleBackToHome = () => {
    router.push(homeHref);
  };

  const handleTitleSave = async () => {
    if (!editTitle.trim() || !series) return;
    try {
      await api.updateSeries(seriesId, { title: editTitle.trim() });
      setSeries({ ...series, title: editTitle.trim() });
    } catch (error) {
      console.error("Failed to update series title:", error);
      setEditTitle(series.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") {
      setEditTitle(series?.title || "");
      setIsEditingTitle(false);
    }
  };

  const handleOpenEpisode = (episodeId: string) => {
    router.push(`/studio/projects/${episodeId}?seriesId=${seriesId}`);
  };

  const refreshSeriesData = async () => {
    try {
      const [seriesData, episodesBriefs] = await Promise.all([
        api.getSeriesLight(seriesId),
        api.getSeriesEpisodeBriefs(seriesId),
      ]);
      setSeries(seriesData);
      setEpisodes(episodesBriefs);
    } catch (error) {
      console.error("Failed to refresh series data:", error);
    }
  };

  const handleEpisodeCreated = async (episodeId: string) => {
    try {
      const episodesBriefs = await api.getSeriesEpisodeBriefs(seriesId);
      setEpisodes(episodesBriefs);
      setActiveItem({ kind: "episode", episodeId });
    } catch (error) {
      console.error("Failed to refresh episodes after create:", error);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  // ── Error ──
  if (!series) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-gray-400 mb-4">剧集未找到</p>
          <a href={homeHref} className="text-primary hover:underline">返回首页</a>
        </div>
      </div>
    );
  }

  // ── Derive content ──
  const getAssets = (tab: AssetTab): (Character | Scene | Prop)[] => {
    if (tab === "characters") return series.characters || [];
    if (tab === "scenes") return series.scenes || [];
    return series.props || [];
  };

  const isEpisodeSelected = activeItem.kind === "episode";
  const isSharedAssetsSelected = activeItem.kind === "shared_assets";
  const backgroundColor = theme === "light" ? "#f4f5f7" : "#0f172a";

  return (
    <main data-studio-theme={theme} className="studio-theme-root pipeline-theme-root flex h-screen w-screen overflow-hidden relative bg-background">
      <div className="absolute inset-0 z-0 pointer-events-none">
        {showCanvas ? (
          <CreativeCanvas theme={theme} />
        ) : (
          <div className="absolute inset-0 z-0 h-full w-full" style={{ backgroundColor }} aria-hidden="true" />
        )}
      </div>

      {/* ── Sidebar ── */}
      <div className="relative z-10 h-full flex w-full">
        <SeriesSidebar
          series={series}
          episodes={episodes}
          activeItem={activeItem}
          onItemChange={setActiveItem}
          onBack={handleBackToHome}
          onOpenCreateEpisode={() => setIsCreateEpisodeOpen(true)}
          onOpenImportAssets={() => setShowImportAssets(true)}
          theme={theme}
          onThemeChange={setTheme}
        />

        {/* ── Content Area ── */}
        <div className="flex-1 overflow-hidden px-5 py-5 lg:px-8">
          <div className="flex h-full flex-col gap-6 overflow-hidden">
            {isSharedAssetsSelected ? (
              <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_42px_rgba(2,6,23,0.16)] transition-all duration-300">
                  <SeriesSharedAssetsPanel
                    tab={assetTab}
                    onTabChange={setAssetTab}
                    characters={getAssets("characters") as Character[]}
                    scenes={getAssets("scenes") as Scene[]}
                    props={getAssets("props") as Prop[]}
                  />
                </section>

                <aside className="order-last lg:order-none overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_42px_rgba(2,6,23,0.16)]">
                  <div className="flex h-full flex-col overflow-hidden">
                    <div className="px-5 pt-5">
                      <div className="flex items-center gap-2">
                        <span className="h-1 w-7 rounded-full bg-white/10" />
                        <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">剧集</span>
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {isEditingTitle ? (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={handleTitleKeyDown}
                                onBlur={handleTitleSave}
                                className="w-full bg-transparent text-2xl font-bold tracking-tight text-gray-200 outline-none border-b-2 border-primary/60 focus:border-primary"
                                autoFocus
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={handleTitleSave}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                                title="保存"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setEditTitle(series.title);
                                  setIsEditingTitle(false);
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                                title="取消"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onDoubleClick={() => setIsEditingTitle(true)}
                              className="group min-w-0 text-left"
                              title="双击编辑标题"
                            >
                              <div className="flex items-center gap-2">
                                <h1 className="truncate text-2xl font-bold tracking-tight text-gray-200 group-hover:text-white">
                                  {series.title}
                                </h1>
                                <PencilLine size={16} className="text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                              </div>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4 scrollbar-hide">
                      {series.description ? (
                        <SeriesDescriptionCard
                          description={series.description}
                          expanded={isDescriptionExpanded}
                          onToggle={() => setIsDescriptionExpanded((v) => !v)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_10px_28px_rgba(2,6,23,0.14)]">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">简介</span>
                            <span className="h-px flex-1 bg-white/10" />
                          </div>
                          <div className="mt-2 text-sm text-gray-500">暂无简介</div>
                        </div>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            ) : (
              <>
                <section className="px-1">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isEditingTitle ? (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={handleTitleKeyDown}
                                onBlur={handleTitleSave}
                                className="w-full bg-transparent text-3xl font-bold tracking-tight text-gray-200 outline-none border-b-2 border-primary/60 focus:border-primary"
                                autoFocus
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={handleTitleSave}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                                title="保存"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setEditTitle(series.title);
                                  setIsEditingTitle(false);
                                }}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                                title="取消"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onDoubleClick={() => setIsEditingTitle(true)}
                              className="group min-w-0 text-left"
                              title="双击编辑标题"
                            >
                              <div className="flex items-center gap-2">
                                <h1 className="truncate text-3xl font-bold tracking-tight text-gray-200 group-hover:text-white">
                                  {series.title}
                                </h1>
                                <PencilLine size={16} className="text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                              </div>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {series.description ? (
                      <SeriesDescriptionCard
                        description={series.description}
                        expanded={isDescriptionExpanded}
                        onToggle={() => setIsDescriptionExpanded((v) => !v)}
                      />
                    ) : null}
                  </div>
                </section>

                <section className="flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_18px_42px_rgba(2,6,23,0.16)] transition-all duration-300">
                  <AnimatePresence mode="wait">
                    {activeItem.kind === "shared_assets" ? (
                      <SeriesSharedAssetsPanel
                        key="shared-assets"
                        tab={assetTab}
                        onTabChange={setAssetTab}
                        characters={getAssets("characters") as Character[]}
                        scenes={getAssets("scenes") as Scene[]}
                        props={getAssets("props") as Prop[]}
                      />
                    ) : isEpisodeSelected && selectedEpisode ? (
                      <EpisodeContentPanel
                        key={`episode-${selectedEpisode.id}`}
                        episode={selectedEpisode}
                        onOpenEditor={() => handleOpenEpisode(selectedEpisode.id)}
                      />
                    ) : isEpisodeSelected && selectedEpisodeLoading ? (
                      <div className="flex items-center justify-center h-full text-gray-400">分集详情加载中...</div>
                    ) : null}
                  </AnimatePresence>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <CreateEpisodeDialog
        isOpen={isCreateEpisodeOpen}
        onClose={() => setIsCreateEpisodeOpen(false)}
        seriesId={seriesId}
        nextEpisodeNumber={episodes.length + 1}
        onCreated={handleEpisodeCreated}
      />
      <ImportAssetsDialog
        isOpen={showImportAssets}
        onClose={() => setShowImportAssets(false)}
        seriesId={seriesId}
        onImported={refreshSeriesData}
      />
    </main>
  );
}

// ── Shared animation config ──

const contentTransition = {
  duration: 0.25,
  ease: [0.25, 1, 0.5, 1] as const, // ease-out-quart
};

function SeriesDescriptionCard({
  description,
  expanded,
  onToggle,
}: {
  description: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shouldShowToggle = description.trim().length > 80;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_10px_28px_rgba(2,6,23,0.14)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500">简介</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <div
            className={`mt-2 text-sm text-gray-300 whitespace-pre-wrap ${
              expanded ? "" : "max-h-[44px] overflow-hidden"
            }`}
          >
            {description}
          </div>
        </div>
        {shouldShowToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/10"
          >
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SeriesSharedAssetsPanel({
  tab,
  onTabChange,
  characters,
  scenes,
  props,
}: {
  tab: AssetTab;
  onTabChange: (tab: AssetTab) => void;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
}) {
  const assets = tab === "characters" ? characters : tab === "scenes" ? scenes : props;
  const label = ASSET_LABELS[tab];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="px-8 pt-7 pb-5 border-b border-white/10">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-1 w-7 rounded-full bg-primary/80" />
              <h2 className="text-xl font-bold text-gray-200">共享资产</h2>
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-bold text-gray-300">
                {characters.length + scenes.length + props.length}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              统一沉淀剧集级角色 / 场景 / 道具，供整部作品复用
            </p>
          </div>
        </div>

        <div className="mt-5">
          <AssetTypeTabs
            layoutIdPrefix="series-shared-assets"
            value={tab}
            onChange={onTabChange}
            items={[
              { id: "characters", label: "角色", icon: <Users size={14} />, count: characters.length },
              { id: "scenes", label: "场景", icon: <MapPin size={14} />, count: scenes.length },
              { id: "props", label: "道具", icon: <Package size={14} />, count: props.length },
            ]}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-7 scrollbar-hide">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-400">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
              <ImageIcon size={28} className="text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-300">暂无{label}资产</p>
            <p className="mt-1 text-xs text-gray-500">可从左侧“导入资产”快速沉淀到剧集共享池</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {assets.map((asset) => (
              <motion.div
                key={asset.id}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.4, ease: [0.25, 1, 0.5, 1] },
                  },
                }}
              >
                <AssetCard asset={asset} type={tab} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Episode Content Panel ──

function EpisodeContentPanel({
  episode,
  onOpenEditor,
}: {
  episode: Project;
  onOpenEditor: () => void;
}) {
  const frames = episode.frames || [];

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/10 px-8 pt-6 pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="rounded-lg bg-[color:var(--admin-primary-soft)] px-2.5 py-1 text-xs font-mono font-bold text-[color:var(--admin-primary)]">
              EP{episode.episode_number || "?"}
            </span>
            <h2 className="text-xl font-display font-bold text-gray-200">
              {episode.title}
            </h2>
          </div>
          <p className="text-xs text-gray-400">
            {frames.length} 分镜
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onOpenEditor}
          className="studio-button studio-button-primary flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
        >
          <Play size={14} />
          进入编辑器
          <ChevronRight size={14} />
        </motion.button>
      </div>

      {/* Frames preview */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5"
            >
              <Play size={28} className="text-gray-500" />
            </motion.div>
            <p className="text-sm font-medium text-gray-300">暂无分镜</p>
            <p className="mt-1 text-xs text-gray-400">进入编辑器开始创作</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {frames.map((frame, i) => (
              <motion.div
                key={frame.id}
                variants={{
                  hidden: { opacity: 0, y: 16, scale: 0.97 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { duration: 0.3, ease: [0.25, 1, 0.5, 1] },
                  },
                }}
                whileHover={{ y: -2 }}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-sm transition-shadow hover:bg-white/10"
                onClick={onOpenEditor}
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-white/10">
                  {frame.rendered_image_url ? (
                    <img
                      src={frame.rendered_image_url}
                      alt={`分镜 ${i + 1}`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="text-xs font-mono text-gray-500">
                      #{i + 1}
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 transition-colors duration-200 group-hover:bg-slate-900/35">
                    <Play
                      size={20}
                      className="text-white opacity-0 group-hover:opacity-80 transition-opacity duration-200"
                    />
                  </div>
                </div>
                <div className="p-2.5">
                  <p className="truncate text-xs text-gray-400">
                    {frame.scene_description || `分镜 ${i + 1}`}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
