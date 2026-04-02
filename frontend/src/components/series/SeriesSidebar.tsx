"use client";

import { motion } from "framer-motion";
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
  onOpenCreateEpisode: () => void;
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
  onOpenCreateEpisode,
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
      className="flex h-full w-72 flex-shrink-0 flex-col border-r border-white/10 bg-white/5 backdrop-blur-xl"
    >
      {/* ── Header: breadcrumb + editable title ── */}
      <div className="border-b border-white/10 p-5">
        <div className="space-y-2">
          {/* Back row */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onBack}
              className="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-200"
              title="返回首页"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="truncate text-xs text-gray-500">DramaLab / 系列控制台</span>
          </div>

          {/* Editable title */}
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onBlur={onTitleSave}
              onKeyDown={onTitleKeyDown}
              className="w-full border-b-2 border-primary bg-transparent text-base font-display font-bold text-gray-200 outline-none"
              autoFocus
            />
          ) : (
            <h1
              className="cursor-pointer truncate text-base font-display font-bold text-gray-200 transition-colors hover:text-white"
              onDoubleClick={onTitleDoubleClick}
              title="双击编辑标题"
            >
              {series.title}
            </h1>
          )}

          {series.description && (
            <p className="truncate text-xs text-gray-400">{series.description}</p>
          )}
        </div>
      </div>

      {/* ── Asset navigation ── */}
      <div className="p-3 space-y-1">
        <div className="px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">
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
                  ? "bg-white/10 text-gray-200"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
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
                  isActive ? "text-white" : "group-hover:text-gray-200"
                )}
              />
              <span className="text-sm font-medium flex-1 text-left">
                {label}
              </span>
              <span
                className={clsx(
                  "text-xs px-1.5 py-0.5 rounded-md font-mono",
                  isActive
                    ? "bg-white/10 text-gray-200"
                    : "bg-white/5 text-gray-400"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Episode list ── */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">集数 ({episodes.length})</span>
          <button
            type="button"
            onClick={onOpenCreateEpisode}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-white/10"
          >
            <Plus size={13} />
            添加
          </button>
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
                    ? "bg-white/10 text-gray-200"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
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
                      ? "bg-white/10 text-gray-200"
                      : "bg-white/5 text-gray-400"
                  )}
                >
                  EP{ep.episode_number || "?"}
                </span>
                <span className="text-sm font-medium flex-1 text-left truncate">
                  {ep.title}
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  {ep.frames?.length || 0}
                </span>
                {isActive && (
                  <ChevronRight size={14} className="opacity-40" />
                )}
              </button>
            );
          })}

          {episodes.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-gray-500">暂无集数</p>
              <button
                type="button"
                onClick={onOpenCreateEpisode}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/10"
              >
                <Plus size={14} />
                先创建一集
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Bottom tools ── */}
      <div className="space-y-1 border-t border-white/10 p-3">
        <button
          onClick={onOpenImportAssets}
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
        >
          <Download size={16} className="transition-colors group-hover:text-white" />
          <span className="text-sm">导入资产</span>
        </button>
      </div>
    </motion.aside>
  );
}
