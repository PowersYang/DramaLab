"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Users,
  MapPin,
  Package,
  Plus,
  Download,
} from "lucide-react";
import clsx from "clsx";
import type { Series, Project } from "@/store/projectStore";

// ── Types ──

export type SidebarItem =
  | { kind: "asset"; tab: "characters" | "scenes" | "props" }
  | { kind: "episode"; episodeId: string };

interface SeriesSidebarProps {
  series: Series;
  episodes: Project[];
  activeItem: SidebarItem;
  onItemChange: (item: SidebarItem) => void;
  onBack: () => void;
  // Title editing
  isEditingTitle: boolean;
  editTitle: string;
  onEditTitleChange: (val: string) => void;
  onTitleDoubleClick: () => void;
  onTitleSave: () => void;
  onTitleKeyDown: (e: React.KeyboardEvent) => void;
  // Add episode
  showAddEpisode: boolean;
  newEpisodeTitle: string;
  isCreatingEpisode: boolean;
  onShowAddEpisode: (show: boolean) => void;
  onNewEpisodeTitleChange: (val: string) => void;
  onAddEpisode: () => void;
  onAddEpisodeKeyDown: (e: React.KeyboardEvent) => void;
  // Actions
  onOpenImportAssets: () => void;
}

// ── Asset nav config ──

const ASSET_TABS = [
  { tab: "characters" as const, label: "角色", icon: Users },
  { tab: "scenes" as const, label: "场景", icon: MapPin },
  { tab: "props" as const, label: "道具", icon: Package },
] as const;

// ── Component ──

export default function SeriesSidebar({
  series,
  episodes,
  activeItem,
  onItemChange,
  onBack,
  isEditingTitle,
  editTitle,
  onEditTitleChange,
  onTitleDoubleClick,
  onTitleSave,
  onTitleKeyDown,
  showAddEpisode,
  newEpisodeTitle,
  isCreatingEpisode,
  onShowAddEpisode,
  onNewEpisodeTitleChange,
  onAddEpisode,
  onAddEpisodeKeyDown,
  onOpenImportAssets,
}: SeriesSidebarProps) {
  const getAssetCount = (tab: "characters" | "scenes" | "props") => {
    if (tab === "characters") return series.characters?.length || 0;
    if (tab === "scenes") return series.scenes?.length || 0;
    return series.props?.length || 0;
  };

  const sortedEpisodes = [...episodes].sort(
    (a, b) => (a.episode_number || 0) - (b.episode_number || 0)
  );

  return (
    <motion.aside
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
      className="flex h-full w-72 flex-shrink-0 flex-col border-r border-slate-200 bg-white/96 backdrop-blur-xl"
    >
      {/* ── Header: breadcrumb + editable title ── */}
      <div className="border-b border-slate-200 p-5">
        <div className="space-y-2">
          {/* Back row */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onBack}
              className="flex-shrink-0 text-slate-400 transition-colors hover:text-slate-900"
              title="返回首页"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="truncate text-xs text-slate-500">DramaLab / 系列控制台</span>
          </div>

          {/* Editable title */}
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onBlur={onTitleSave}
              onKeyDown={onTitleKeyDown}
              className="w-full border-b-2 border-primary bg-transparent text-base font-display font-bold text-slate-900 outline-none"
              autoFocus
            />
          ) : (
            <h1
              className="cursor-pointer truncate text-base font-display font-bold text-slate-900 transition-colors hover:text-primary"
              onDoubleClick={onTitleDoubleClick}
              title="双击编辑标题"
            >
              {series.title}
            </h1>
          )}

          {series.description && (
            <p className="truncate text-xs text-slate-500">{series.description}</p>
          )}
        </div>
      </div>

      {/* ── Asset navigation ── */}
      <div className="p-3 space-y-1">
        <div className="px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            共享资产
          </span>
        </div>
        {ASSET_TABS.map(({ tab, label, icon: Icon }) => {
          const isActive =
            activeItem.kind === "asset" && activeItem.tab === tab;
          const count = getAssetCount(tab);

          return (
            <button
              key={tab}
              onClick={() => onItemChange({ kind: "asset", tab })}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden",
                isActive
                  ? "bg-[color:var(--admin-primary-soft)] text-slate-900"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="series-active-pill"
                  className="absolute left-0 w-1 h-full bg-primary"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              )}
              <Icon
                size={18}
                className={clsx(
                  "transition-colors",
                  isActive ? "text-primary" : "group-hover:text-slate-900"
                )}
              />
              <span className="text-sm font-medium flex-1 text-left">
                {label}
              </span>
              <span
                className={clsx(
                  "text-xs px-1.5 py-0.5 rounded-md font-mono",
                  isActive
                    ? "bg-white text-primary"
                    : "bg-slate-100 text-slate-500"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Episode list ── */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200">
        <div className="px-6 py-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            集数 ({episodes.length})
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-1">
          {sortedEpisodes.map((ep) => {
            const isActive =
              activeItem.kind === "episode" &&
              activeItem.episodeId === ep.id;

            return (
              <button
                key={ep.id}
                onClick={() =>
                  onItemChange({ kind: "episode", episodeId: ep.id })
                }
                className={clsx(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden",
                  isActive
                    ? "bg-[color:var(--admin-primary-soft)] text-slate-900"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="series-active-pill"
                    className="absolute left-0 w-1 h-full bg-primary"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  />
                )}
                <span
                  className={clsx(
                    "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded",
                    isActive
                      ? "bg-white text-primary"
                      : "bg-slate-100 text-slate-500"
                  )}
                >
                  EP{ep.episode_number || "?"}
                </span>
                <span className="text-sm font-medium flex-1 text-left truncate">
                  {ep.title}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {ep.frames?.length || 0}
                </span>
                {isActive && (
                  <ChevronRight size={14} className="opacity-40" />
                )}
              </button>
            );
          })}

          {episodes.length === 0 && !showAddEpisode && (
            <div className="text-center py-6">
              <p className="text-xs text-slate-400">暂无集数</p>
            </div>
          )}
        </div>

        {/* Add episode area */}
        <div className="px-3 pb-3 pt-1">
          <AnimatePresence mode="wait">
            {showAddEpisode ? (
              <motion.div
                key="add-form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newEpisodeTitle}
                    onChange={(e) => onNewEpisodeTitleChange(e.target.value)}
                    placeholder="集数标题..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-primary focus:outline-none"
                    autoFocus
                    onKeyDown={onAddEpisodeKeyDown}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={onAddEpisode}
                      disabled={!newEpisodeTitle.trim() || isCreatingEpisode}
                      className="studio-button studio-button-primary flex-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {isCreatingEpisode ? "创建中..." : "确定"}
                    </button>
                    <button
                      onClick={() => {
                        onShowAddEpisode(false);
                        onNewEpisodeTitleChange("");
                      }}
                      className="rounded-lg px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.button
                key="add-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => onShowAddEpisode(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97]"
              >
                <Plus size={14} />
                添加集数
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Bottom tools ── */}
      <div className="space-y-1 border-t border-slate-200 p-3">
        <button
          onClick={onOpenImportAssets}
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Download size={16} className="transition-colors group-hover:text-green-600" />
          <span className="text-sm">导入资产</span>
        </button>
      </div>
    </motion.aside>
  );
}
