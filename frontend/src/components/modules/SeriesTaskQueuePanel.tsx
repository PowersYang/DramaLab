"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, Tag } from "lucide-react";

import type { TaskJob } from "@/lib/api";
import { formatTaskModelSummary, getTaskModelInfo } from "@/lib/taskModelInfo";
import type { Series } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";

type QueueFilter = "all" | "processing" | "completed" | "failed";

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"] as const;
const FAILED_STATUSES = ["failed", "timed_out"] as const;
const COMPLETED_STATUSES = ["succeeded", "cancelled"] as const;

const ASSET_TASK_TYPES = ["asset.generate", "asset.generate_batch", "asset.motion_ref.generate"] as const;

const TASK_TYPE_LABELS: Record<string, string> = {
  "asset.generate": "资产生成",
  "asset.generate_batch": "批量资产生成",
  "asset.motion_ref.generate": "资产动作参考生成",
};

interface QueueJobDisplayInfo {
  title: string;
  subtitle: string;
  badges: string[];
  detail: string | null;
  accentClassName: string;
}

export default function SeriesTaskQueuePanel({ series }: { series: Series }) {
  const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
  const jobsById = useTaskStore((state) => state.jobsById);
  const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const previousActiveJobIdsRef = useRef<string[]>([]);

  const filteredJobs = useMemo(() => {
    const taskTypes = new Set(ASSET_TASK_TYPES);
    return (jobIdsByProject[series.id] || [])
      .map((jobId) => jobsById[jobId])
      .filter((job): job is TaskJob => !!job && taskTypes.has(job.task_type as typeof ASSET_TASK_TYPES[number]))
      .sort((a, b) => {
        const timeA = new Date(String(a.created_at)).getTime();
        const timeB = new Date(String(b.created_at)).getTime();
        return timeB - timeA;
      });
  }, [jobIdsByProject, jobsById, series.id]);

  const activeJobIds = useMemo(
    () => filteredJobs
      .filter((job) => ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]))
      .map((job) => job.id),
    [filteredJobs],
  );

  useEffect(() => {
    previousActiveJobIdsRef.current = [];
  }, [series.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchProjectJobs(undefined, undefined, { seriesId: series.id }).catch((error) => {
      if (!cancelled) {
        console.error("Failed to fetch series task queue:", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchProjectJobs, series.id]);

  useEffect(() => {
    if (activeJobIds.length === 0) {
      previousActiveJobIdsRef.current = activeJobIds;
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollActiveJobs = async () => {
      try {
        await fetchProjectJobs(undefined, [...ACTIVE_STATUSES], { seriesId: series.id });
      } catch (error) {
        console.error("Failed to poll series task queue:", error);
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(pollActiveJobs, 3000);
        }
      }
    };

    timeoutId = window.setTimeout(pollActiveJobs, 3000);
    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeJobIds, fetchProjectJobs, series.id]);

  useEffect(() => {
    const previousIds = previousActiveJobIdsRef.current;
    const activeIdSet = new Set(activeJobIds);
    const finishedJobIds = previousIds.filter((jobId) => !activeIdSet.has(jobId));
    previousActiveJobIdsRef.current = activeJobIds;

    if (finishedJobIds.length === 0) {
      return;
    }

    let cancelled = false;
    void fetchProjectJobs(undefined, undefined, { seriesId: series.id }).catch((error) => {
      if (!cancelled) {
        console.error("Failed to refresh series task queue:", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeJobIds, fetchProjectJobs, series.id]);

  const visibleJobs = filteredJobs.filter((job) => {
    if (filter === "all") return true;
    if (filter === "processing") return ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]);
    if (filter === "completed") return COMPLETED_STATUSES.includes(job.status as typeof COMPLETED_STATUSES[number]);
    return FAILED_STATUSES.includes(job.status as typeof FAILED_STATUSES[number]);
  });

  return (
    <div className="studio-inspector h-full flex flex-col text-[color:var(--studio-text-soft)]">
      <div className="border-b border-white/10">
        <div className="p-4">
          <div className="studio-panel-chip-rail flex gap-1 rounded-xl p-1">
            {[
              { id: "all", label: "全部" },
              { id: "processing", label: "进行中" },
              { id: "completed", label: "已完成" },
              { id: "failed", label: "失败" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as QueueFilter)}
                className={`flex-1 py-1.5 text-xs rounded-lg transition-colors font-semibold ${filter === tab.id
                  ? "bg-[color:var(--studio-surface-20)] text-[color:var(--studio-shell-accent-strong)] shadow-sm ring-1 ring-[color:var(--studio-shell-accent-soft)]"
                  : "text-[color:var(--studio-text-muted)] hover:bg-[color:var(--studio-surface-10)] hover:text-[color:var(--studio-text-strong)]"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence mode="popLayout">
          {visibleJobs.map((job) => (
            <QueueJobCard key={job.id} job={job} series={series} />
          ))}
        </AnimatePresence>

        {visibleJobs.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-500">暂无任务</div>
        )}
      </div>
    </div>
  );
}

function QueueJobCard({ job, series }: { job: TaskJob; series: Series }) {
  const cancelJob = useTaskStore((state) => state.cancelJob);
  const retryJob = useTaskStore((state) => state.retryJob);
  const isActive = ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]);
  const isFailed = FAILED_STATUSES.includes(job.status as typeof FAILED_STATUSES[number]);
  const isCompleted = COMPLETED_STATUSES.includes(job.status as typeof COMPLETED_STATUSES[number]);
  const statusLabel = getStatusLabel(job.status);
  const displayInfo = buildJobDisplayInfo(job, series);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`rounded-2xl border p-3.5 shadow-[0_12px_36px_rgba(15,23,42,0.08)] transition-colors backdrop-blur-sm ${isFailed
        ? "border-white/20 bg-[color:var(--studio-shell-danger-soft)] ring-1 ring-[color:var(--studio-shell-danger-soft)]"
        : "border-white/10 bg-white/10"
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            {isActive && <Loader2 size={14} className="animate-spin text-primary" />}
            {isFailed && <AlertCircle size={14} className="text-rose-600" />}
            {isCompleted && <CheckCircle2 size={14} className="text-emerald-600" />}
            <span className="text-xs font-mono text-[color:var(--studio-text-muted)]">#{job.id.slice(0, 8)}</span>
            <span className={`h-2 w-2 rounded-full ${displayInfo.accentClassName}`} />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-5 text-[color:var(--studio-text-strong)]">{displayInfo.title}</p>
              {displayInfo.subtitle && (
                <p className="mt-1 text-xs text-[color:var(--studio-text-muted)]">{displayInfo.subtitle}</p>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${getStatusClassName(job.status)}`}>
              {statusLabel}
            </span>
          </div>

          {displayInfo.badges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {displayInfo.badges.map((badge) => (
                <span
                  key={`${job.id}-${badge}`}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-[color:var(--studio-text-muted)]"
                >
                  <Tag size={10} className="text-[color:var(--studio-text-faint)]" />
                  {badge}
                </span>
              ))}
            </div>
          )}

          {displayInfo.detail && (
            <p className="mt-3 text-xs leading-5 text-[color:var(--studio-text-muted)]">{displayInfo.detail}</p>
          )}

          <p className="mt-3 text-[11px] text-[color:var(--studio-text-faint)]">
            创建于 {formatTimestamp(job.created_at)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isActive && (
            <button
              onClick={() => void cancelJob(job.id)}
              className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-[color:var(--studio-text-soft)] transition-colors hover:bg-white/20 hover:text-[color:var(--studio-text-strong)]"
            >
              取消
            </button>
          )}
          {isFailed && job.attempt_count < job.max_attempts && (
            <button
              onClick={() => void retryJob(job.id)}
              className="rounded-lg border border-white/10 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-[color:var(--studio-text-soft)] transition-colors hover:bg-white/20 hover:text-[color:var(--studio-text-strong)]"
            >
              重试
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function getStatusLabel(status: TaskJob["status"]): string {
  if (status === "queued") return "排队中";
  if (status === "claimed") return "已领取，等待执行";
  if (status === "running") return "执行中";
  if (status === "retry_waiting") return "等待重试";
  if (status === "cancel_requested") return "取消中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "执行失败";
  if (status === "cancelled") return "已取消";
  if (status === "timed_out") return "执行超时";
  return status;
}

function getStatusClassName(status: TaskJob["status"]): string {
  if (ACTIVE_STATUSES.includes(status as typeof ACTIVE_STATUSES[number])) {
    return "bg-[color:var(--studio-shell-accent-soft)] text-[color:var(--studio-shell-accent-strong)]";
  }
  if (FAILED_STATUSES.includes(status as typeof FAILED_STATUSES[number])) {
    return "bg-[color:var(--studio-shell-danger-soft)] text-[color:var(--studio-text-strong)]";
  }
  if (status === "succeeded") {
    return "bg-[color:var(--video-workspace-success-soft)] text-[color:var(--studio-text-strong)]";
  }
  return "bg-white/10 text-[color:var(--studio-text-muted)]";
}

function formatTimestamp(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildJobDisplayInfo(job: TaskJob, series: Series): QueueJobDisplayInfo {
  const assetType = normalizeAssetType(String(job.resource_type || job.payload_json?.asset_type || ""));
  const assetId = String(job.resource_id || job.payload_json?.asset_id || "");
  const asset = findAsset(series, assetType, assetId);
  const assetTypeLabel = getAssetTypeLabel(assetType);
  const assetName = asset?.name || `未命名${assetTypeLabel}`;
  const generationLabel = getAssetGenerationLabel(job);
  const taskLabel = TASK_TYPE_LABELS[job.task_type] || "资产任务";
  const badges = [assetTypeLabel, generationLabel].filter(Boolean);
  const modelSummary = formatTaskModelSummary(job);
  const fallbackReason = getTaskModelInfo(job).fallbackReason;
  const detailParts = [asset?.description || null, modelSummary, fallbackReason, formatAttemptDetail(job)].filter(Boolean);

  return {
    title: `${assetName} · ${generationLabel}`,
    subtitle: `${taskLabel} · ${assetTypeLabel}`,
    badges,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    accentClassName: "bg-sky-400",
  };
}

function formatAttemptDetail(job: TaskJob): string | null {
  if (job.attempt_count <= 0) {
    return null;
  }
  if (job.attempt_count > job.max_attempts) {
    return `已尝试 ${job.attempt_count} 次（上限 ${job.max_attempts}）`;
  }
  return `已尝试 ${job.attempt_count}/${job.max_attempts} 次`;
}

function normalizeAssetType(value: string): "character" | "scene" | "prop" | null {
  if (value === "character" || value === "scene" || value === "prop") {
    return value;
  }
  if (value === "full_body" || value === "head_shot" || value === "headshot") {
    return "character";
  }
  return null;
}

function findAsset(series: Series, assetType: "character" | "scene" | "prop" | null, assetId?: string) {
  if (!assetType || !assetId) {
    return null;
  }
  if (assetType === "character") {
    return series.characters?.find((item) => item.id === assetId) || null;
  }
  if (assetType === "scene") {
    return series.scenes?.find((item) => item.id === assetId) || null;
  }
  return series.props?.find((item) => item.id === assetId) || null;
}

function getAssetTypeLabel(assetType: "character" | "scene" | "prop" | null): string {
  if (assetType === "character") return "角色";
  if (assetType === "scene") return "场景";
  if (assetType === "prop") return "道具";
  return "资产";
}

function getAssetGenerationLabel(job: TaskJob): string {
  if (job.task_type === "asset.motion_ref.generate") {
    return getMotionAssetLabel(String(job.payload_json?.asset_type || job.resource_type || ""));
  }

  const generationType = String(job.payload_json?.generation_type || "");
  if (generationType === "all") return "整套图像";
  if (generationType === "full_body") return "全身图";
  if (generationType === "three_view") return "三视图";
  if (generationType === "headshot" || generationType === "head_shot") return "头像";
  return "图像生成";
}

function getMotionAssetLabel(assetType: string): string {
  if (assetType === "full_body") return "全身动作参考";
  if (assetType === "head_shot" || assetType === "headshot") return "头像动作参考";
  if (assetType === "scene") return "场景动作参考";
  if (assetType === "prop") return "道具动作参考";
  return "动作参考";
}
