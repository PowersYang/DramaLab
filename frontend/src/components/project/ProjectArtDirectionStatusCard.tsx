"use client";

import Link from "next/link";
import { RefreshCcw, Sparkles, Wand2 } from "lucide-react";

import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";

function sourceLabel(source?: string) {
  if (source === "project_override") return "项目覆写";
  if (source === "series_default") return "继承剧集";
  return "独立项目";
}

export default function ProjectArtDirectionStatusCard({
  onOpenOverride,
}: {
  onOpenOverride: () => void;
}) {
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateProject = useProjectStore((state) => state.updateProject);

  if (!currentProject) {
    return null;
  }

  const resolved = currentProject.art_direction_resolved || currentProject.art_direction;
  const isSeriesProject = Boolean(currentProject.series_id);
  const isOverride = currentProject.art_direction_source === "project_override";

  const handleReset = async () => {
    if (!currentProject.id) return;
    const updated = await api.clearProjectArtDirectionOverride(currentProject.id);
    updateProject(currentProject.id, updated);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 shadow-[0_18px_42px_rgba(2,6,23,0.16)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
            <Sparkles size={12} />
            美术来源
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[color:var(--admin-primary-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--admin-primary)]">
              {sourceLabel(currentProject.art_direction_source)}
            </span>
            {isOverride ? (
              <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                已偏离剧集设定
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-gray-300">
            当前生效风格：{resolved?.style_config?.name || resolved?.selected_style_id || "未设置"}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            项目制作页不再承载主设定。剧集统一定标准，项目只在确有需要时做显式覆写。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isSeriesProject ? (
            <Link
              href={`/studio/series/${currentProject.series_id}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-100"
            >
              <Wand2 size={16} />
              查看剧集设定
            </Link>
          ) : null}
          {isSeriesProject ? (
            <button
              type="button"
              onClick={onOpenOverride}
              className="inline-flex items-center gap-2 rounded-2xl bg-[color:var(--admin-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              <Wand2 size={16} />
              {isOverride ? "编辑项目覆写" : "创建项目覆写"}
            </button>
          ) : null}
          {isOverride ? (
            <button
              type="button"
              onClick={() => void handleReset()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-100"
            >
              <RefreshCcw size={16} />
              恢复继承
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
