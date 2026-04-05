"use client";

import ArtDirectionEditorCard from "@/components/art-direction/ArtDirectionEditorCard";
import { api } from "@/lib/api";
import type { Series } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";

export default function SeriesArtDirectionEditor({
  series,
  onUpdated,
}: {
  series: Series;
  onUpdated: (nextSeries: Series) => void;
}) {
  return (
    <ArtDirectionEditorCard
      title="美术设定"
      initialArtDirection={series.art_direction}
      actionLabel="保存美术设定"
      onGenerateAiRecommendations={async () => {
        const episodes = await api.getSeriesEpisodes(series.id);
        const bestEpisode = (Array.isArray(episodes) ? episodes : [])
          .map((episode) => {
            const record = episode as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id : "";
            const rawText = record.original_text ?? record.originalText ?? record.text ?? "";
            const text = typeof rawText === "string" ? rawText : "";
            return { id, text };
          })
          .filter((episode) => episode.id && episode.text.trim().length > 0)
          .sort((a, b) => b.text.length - a.text.length)[0];

        if (!bestEpisode) {
          throw new Error("该剧集下还没有可用于分析的分集文本");
        }

        const receipt = await api.analyzeScriptForStyles(bestEpisode.id, bestEpisode.text);
        useTaskStore.getState().enqueueReceipts(bestEpisode.id, [receipt]);
        const job = await useTaskStore.getState().waitForJob(receipt.job_id, { intervalMs: 2000 });
        if (job.status !== "succeeded") {
          throw new Error(job.error_message || "风格分析失败");
        }

        const latest = await api.getSeries(series.id);
        onUpdated(latest);
        return latest.art_direction?.ai_recommendations || [];
      }}
      onSave={async (selectedStyleId, styleConfig) => {
        const updated = await api.updateSeriesArtDirection(
          series.id,
          selectedStyleId,
          styleConfig,
          series.art_direction?.ai_recommendations || [],
        );
        onUpdated(updated);
      }}
    />
  );
}
