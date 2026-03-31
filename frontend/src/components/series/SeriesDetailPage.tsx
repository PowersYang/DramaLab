"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Play, ChevronRight, Package, FolderKanban, Film, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Series, Character, Scene, Prop, Project } from "@/store/projectStore";
import AssetCard from "@/components/common/AssetCard";
import SeriesSidebar, { type SidebarItem } from "./SeriesSidebar";
import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";

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
  const [episodes, setEpisodes] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<SidebarItem>({ kind: "asset", tab: "characters" });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [newEpisodeTitle, setNewEpisodeTitle] = useState("");
  const [isCreatingEpisode, setIsCreatingEpisode] = useState(false);
  const [showImportAssets, setShowImportAssets] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [seriesData, episodesData] = await Promise.all([
          api.getSeries(seriesId),
          api.getSeriesEpisodes(seriesId),
        ]);
        setSeries(seriesData);
        setEpisodes(episodesData);
        setEditTitle(seriesData.title);
      } catch (error) {
        console.error("Failed to fetch series data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
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

  const handleAddEpisode = async () => {
    if (!newEpisodeTitle.trim()) return;
    setIsCreatingEpisode(true);
    try {
      const nextEpNum = episodes.length + 1;
      await api.createEpisodeForSeries(seriesId, newEpisodeTitle.trim(), nextEpNum);
      const updatedEpisodes = await api.getSeriesEpisodes(seriesId);
      setEpisodes(updatedEpisodes);
      setNewEpisodeTitle("");
      setShowAddEpisode(false);
    } catch (error) {
      console.error("Failed to add episode:", error);
    } finally {
      setIsCreatingEpisode(false);
    }
  };

  const handleAddEpisodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddEpisode();
    if (e.key === "Escape") setShowAddEpisode(false);
  };

  const handleOpenEpisode = (episodeId: string) => {
    router.push(`/studio/projects/${episodeId}?seriesId=${seriesId}`);
  };

  const refreshSeriesData = async () => {
    try {
      const [seriesData, episodesData] = await Promise.all([
        api.getSeries(seriesId),
        api.getSeriesEpisodes(seriesId),
      ]);
      setSeries(seriesData);
      setEpisodes(episodesData);
    } catch (error) {
      console.error("Failed to refresh series data:", error);
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
          <p className="text-gray-400 mb-4">系列未找到</p>
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

  const selectedEpisode =
    activeItem.kind === "episode"
      ? episodes.find((ep) => ep.id === activeItem.episodeId)
      : null;
  const summaryItems = [
    {
      label: "共享角色",
      value: series.characters?.length ?? 0,
      note: "系列级角色资产可在各集间复用",
      icon: Sparkles,
    },
    {
      label: "共享场景",
      value: series.scenes?.length ?? 0,
      note: "场景资产沉淀在系列主账本中",
      icon: FolderKanban,
    },
    {
      label: "共享道具",
      value: series.props?.length ?? 0,
      note: "道具与风格配置统一归档管理",
      icon: Package,
    },
    {
      label: "剧集数量",
      value: episodes.length,
      note: "系列下可直接进入单集创作编辑器",
      icon: Film,
    },
  ];

  return (
    <main data-studio-theme="light" className="studio-theme-root flex h-screen w-screen overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <SeriesSidebar
        series={series}
        episodes={episodes}
        activeItem={activeItem}
        onItemChange={setActiveItem}
        onBack={handleBackToHome}
        isEditingTitle={isEditingTitle}
        editTitle={editTitle}
        onEditTitleChange={setEditTitle}
        onTitleDoubleClick={() => setIsEditingTitle(true)}
        onTitleSave={handleTitleSave}
        onTitleKeyDown={handleTitleKeyDown}
        showAddEpisode={showAddEpisode}
        newEpisodeTitle={newEpisodeTitle}
        isCreatingEpisode={isCreatingEpisode}
        onShowAddEpisode={setShowAddEpisode}
        onNewEpisodeTitleChange={setNewEpisodeTitle}
        onAddEpisode={handleAddEpisode}
        onAddEpisodeKeyDown={handleAddEpisodeKeyDown}
        onOpenImportAssets={() => setShowImportAssets(true)}
      />

      {/* ── Content Area ── */}
      <div className="flex-1 overflow-hidden px-5 py-5 lg:px-8">
        <div className="flex h-full flex-col gap-6 overflow-hidden">
          {/* ── Header: Compact & Elegant ── */}
          <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between px-1">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="h-1 w-8 rounded-full bg-indigo-500/80" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-500/70">Series Console</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {series.title}
              </h1>
              <p className="mt-2 text-sm text-slate-500 max-w-2xl">
                管理系列共享资产、分集推进和复用规则。
              </p>
            </div>
            
            <div className="flex items-center gap-6 rounded-2xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
              {summaryItems.slice(0, 3).map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex flex-col items-center gap-1 px-4 first:pl-0 last:pr-0 border-r border-slate-100 last:border-0">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Icon size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
                    </div>
                    <span className="text-xl font-bold text-slate-900">{item.value}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Main Content Area ── */}
          <section className="flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-300">
            <AnimatePresence mode="wait">
              {activeItem.kind === "asset" ? (
                <AssetContentPanel
                  key={`asset-${activeItem.tab}`}
                  tab={activeItem.tab}
                  assets={getAssets(activeItem.tab)}
                  label={ASSET_LABELS[activeItem.tab]}
                />
              ) : selectedEpisode ? (
                <EpisodeContentPanel
                  key={`episode-${selectedEpisode.id}`}
                  episode={selectedEpisode}
                  onOpenEditor={() => handleOpenEpisode(selectedEpisode.id)}
                />
              ) : null}
            </AnimatePresence>
          </section>
        </div>
      </div>

      {/* ── Modals ── */}
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

// ── Asset Content Panel ──

function AssetContentPanel({
  tab,
  assets,
  label,
}: {
  tab: AssetTab;
  assets: (Character | Scene | Prop)[];
  label: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={contentTransition}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-8 pt-8 pb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-3">
            {label}资产
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
              {assets.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            系列级共享资源，可在所有剧集中复用
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-10 scrollbar-hide">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50">
              <ImageIcon size={28} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium">暂无{label}资产</p>
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
      <div className="flex items-start justify-between border-b border-slate-200 px-8 pt-6 pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="rounded-lg bg-[color:var(--admin-primary-soft)] px-2.5 py-1 text-xs font-mono font-bold text-[color:var(--admin-primary)]">
              EP{episode.episode_number || "?"}
            </span>
            <h2 className="text-xl font-display font-bold text-slate-900">
              {episode.title}
            </h2>
          </div>
          <p className="text-xs text-slate-500">
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
          <div className="flex flex-col items-center justify-center py-24 text-slate-500">
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50"
            >
              <Play size={28} className="text-slate-400" />
            </motion.div>
            <p className="text-sm font-medium">暂无分镜</p>
            <p className="mt-1 text-xs text-slate-500">进入编辑器开始创作</p>
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
                className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                onClick={onOpenEditor}
              >
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-slate-100">
                  {frame.rendered_image_url ? (
                    <img
                      src={frame.rendered_image_url}
                      alt={`分镜 ${i + 1}`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="text-xs font-mono text-slate-400">
                      #{i + 1}
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 transition-colors duration-200 group-hover:bg-slate-900/30">
                    <Play
                      size={20}
                      className="text-white opacity-0 group-hover:opacity-80 transition-opacity duration-200"
                    />
                  </div>
                </div>
                <div className="p-2.5">
                  <p className="truncate text-xs text-slate-500">
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
