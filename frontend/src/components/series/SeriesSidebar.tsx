"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Boxes,
  Sun,
  Moon,
  Plus,
  Download,
} from "lucide-react";
import clsx from "clsx";
import type { Series } from "@/store/projectStore";
import type { EpisodeBrief } from "@/lib/api";
import type { StudioTheme } from "@/components/studio/studioTheme";

// ── Types ──

export type SidebarItem =
  | { kind: "shared_assets" }
  | { kind: "episode"; episodeId: string };

interface SeriesSidebarProps {
  series: Series;
  episodes: EpisodeBrief[];
  activeItem: SidebarItem;
  onItemChange: (item: SidebarItem) => void;
  onBack: () => void;
  onOpenCreateEpisode: () => void;
  // Actions
  onOpenImportAssets: () => void;
  theme: StudioTheme;
  onThemeChange: (theme: StudioTheme) => void;
}

// ── Component ──

export default function SeriesSidebar({
  series,
  episodes,
  activeItem,
  onItemChange,
  onBack,
  onOpenCreateEpisode,
  onOpenImportAssets,
  theme,
  onThemeChange,
}: SeriesSidebarProps) {
  const sharedAssetsCount =
    (series.characters?.length ?? 0) +
    (series.scenes?.length ?? 0) +
    (series.props?.length ?? 0);

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
      {/* ── Header ── */}
      <div className="border-b border-white/10 p-5">
        <div className="space-y-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onBack}
              className="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-200"
              title="返回首页"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="truncate text-xs text-gray-500">DramaLab / 剧集控制台</span>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => onThemeChange("light")}
              aria-pressed={theme === "light"}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                theme === "light" ? "bg-white text-slate-950 shadow-sm" : "text-gray-400 hover:text-white"
              }`}
            >
              <Sun size={14} />
              浅色
            </button>
            <button
              type="button"
              onClick={() => onThemeChange("dark")}
              aria-pressed={theme === "dark"}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                theme === "dark" ? "bg-primary text-white shadow-sm" : "text-gray-400 hover:text-white"
              }`}
            >
              <Moon size={14} />
              深色
            </button>
          </div>
        </div>
      </div>

      {/* ── Asset navigation ── */}
      <div className="p-3 space-y-1">
        <button
          onClick={() => onItemChange({ kind: "shared_assets" })}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
            activeItem.kind === "shared_assets"
              ? "bg-white/10 text-gray-200"
              : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
          )}
        >
          {activeItem.kind === "shared_assets" && (
            <motion.div
              layoutId="series-active-pill"
              className="absolute left-0 w-1 h-full bg-primary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            />
          )}
          <Boxes
            size={18}
            className={clsx(
              "transition-colors",
              activeItem.kind === "shared_assets" ? "text-white" : "group-hover:text-gray-200"
            )}
          />
          <div className="flex-1 text-left leading-tight">
            <div className="text-sm font-semibold">共享资产</div>
            <div className="text-[11px] text-gray-500">角色 / 场景 / 道具</div>
          </div>
          <span
            className={clsx(
              "text-xs px-1.5 py-0.5 rounded-md font-mono",
              activeItem.kind === "shared_assets"
                ? "bg-white/10 text-gray-200"
                : "bg-white/5 text-gray-400"
            )}
          >
            {sharedAssetsCount}
          </span>
        </button>
      </div>

      {/* ── Episode list ── */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-gray-300">集数</span>
            <span className="text-[10px] font-mono text-gray-500">{episodes.length}</span>
          </div>
          <button
            type="button"
            onClick={onOpenCreateEpisode}
            className="studio-button studio-button-primary w-full !h-9 !rounded-xl !px-4 text-[12px] font-semibold"
          >
            <Plus size={14} />
            添加集数
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
                  {ep.frame_count || 0}
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
