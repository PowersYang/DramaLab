"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  Check,
  Inbox,
  Loader2,
  MapPin,
  Package,
  Plus,
  Sparkles,
  User,
  Users,
  Wand2,
  X,
} from "lucide-react";

import AssetTypeTabs from "@/components/common/AssetTypeTabs";
import StudioAssetCard from "@/components/common/StudioAssetCard";
import BillingActionButton from "@/components/billing/BillingActionButton";
import SeriesAssetWorkbenchModal from "@/components/series/SeriesAssetWorkbenchModal";
import { useStudioToast } from "@/components/studio/ui/StudioOverlays";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { api } from "@/lib/api";
import type { Character, Prop, Scene, Series } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";

type AssetTab = "characters" | "scenes" | "props";
type AssetEntityType = "character" | "scene" | "prop";
type ExtractStep = "input" | "loading" | "preview";
type PanelTheme = "light" | "dark";

type DraftAssetInput = {
  name: string;
  description?: string;
  age?: string;
  gender?: string;
  clothing?: string;
  time_of_day?: string;
  lighting_mood?: string;
};

type PreviewGroups = {
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
};

type AssetGeneratingEntry = {
  assetId: string;
  generationType: string;
  batchSize: number;
  status?: string;
};

const ASSET_LABELS: Record<AssetTab, string> = {
  characters: "角色",
  scenes: "场景",
  props: "道具",
};

const PANEL_TRANSITION = {
  duration: 0.25,
  ease: [0.25, 1, 0.5, 1] as const,
};

const EMPTY_GROUPS: PreviewGroups = {
  characters: [],
  scenes: [],
  props: [],
};
const EMPTY_TASK_BUCKET_IDS: string[] = [];
const EMPTY_GENERATING_ENTRIES: AssetGeneratingEntry[] = [];

const SERIES_ASSET_EXTRACT_TASK_TYPE = "series.assets.extract";
const PROJECT_REPARSE_TASK_TYPE = "project.reparse";
const SURFACE_BUTTON_CLASS = "studio-action-button";
const PRIMARY_ACTION_CLASS = "studio-action-button studio-action-button-primary";
const ACTIVE_TASK_STATUSES = new Set(["queued", "claimed", "running", "retry_waiting", "cancel_requested"]);

const normalizeName = (value: string | undefined | null) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("zh-CN");

const buildClientId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const buildEmptyCharacter = (data: DraftAssetInput): Character => ({
  id: buildClientId(),
  name: data.name.trim(),
  description: data.description?.trim() || "",
  age: data.age?.trim() || undefined,
  gender: data.gender?.trim() || undefined,
  clothing: data.clothing?.trim() || undefined,
  aliases: [],
  merge_status: "active",
});

const buildEmptyScene = (data: DraftAssetInput): Scene => ({
  id: buildClientId(),
  name: data.name.trim(),
  description: data.description?.trim() || "",
  time_of_day: data.time_of_day?.trim() || undefined,
  lighting_mood: data.lighting_mood?.trim() || undefined,
});

const buildEmptyProp = (data: DraftAssetInput): Prop => ({
  id: buildClientId(),
  name: data.name.trim(),
  description: data.description?.trim() || "",
});

function appendUniqueAssets<T extends { name: string }>(existing: T[], incoming: T[]) {
  const seen = new Set(existing.map((item) => normalizeName(item.name)));
  const accepted: T[] = [];

  for (const item of incoming) {
    const normalized = normalizeName(item.name);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    accepted.push(item);
  }

  return {
    merged: [...existing, ...accepted],
    importedCount: accepted.length,
    skippedCount: incoming.length - accepted.length,
  };
}

function dedupeGeneratingEntries(entries: AssetGeneratingEntry[]) {
  return Array.from(new Map(entries.map((entry) => [`${entry.assetId}:${entry.generationType}`, entry])).values());
}

function buildSelectedMap(groups: PreviewGroups): Record<string, boolean> {
  return Object.fromEntries(
    [...groups.characters, ...groups.scenes, ...groups.props].map((item) => [item.id, true]),
  );
}

export default function SeriesAssetStudioPanel({
  series,
  tab,
  theme = "light",
  onTabChange,
  onSeriesUpdated,
}: {
  series: Series;
  tab: AssetTab;
  theme?: PanelTheme;
  onTabChange: (tab: AssetTab) => void;
  onSeriesUpdated: (series: Series) => void;
}) {
  const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
  const waitForJob = useTaskStore((state) => state.waitForJob);
  const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
  const jobsById = useTaskStore((state) => state.jobsById);
  const taskBucketIds = useTaskStore((state) => state.jobIdsByProject[series.id] ?? EMPTY_TASK_BUCKET_IDS);
  const { account, getTaskPrice, canAffordTask } = useBillingGuard();
  const toast = useStudioToast();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogType, setCreateDialogType] = useState<AssetEntityType>("character");
  const [isExtractDialogOpen, setIsExtractDialogOpen] = useState(false);
  const [extractStep, setExtractStep] = useState<ExtractStep>("input");
  const [extractInput, setExtractInput] = useState("");
  const [previewGroups, setPreviewGroups] = useState<PreviewGroups>(EMPTY_GROUPS);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Record<string, boolean>>({});
  const [pendingReviewGroups, setPendingReviewGroups] = useState<PreviewGroups>(EMPTY_GROUPS);
  const [selectedPendingIds, setSelectedPendingIds] = useState<Record<string, boolean>>({});
  const [isSubmittingExtract, setIsSubmittingExtract] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isApplyingPending, setIsApplyingPending] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isPendingInboxOpen, setIsPendingInboxOpen] = useState(false);
  const [optimisticGeneratingEntries, setOptimisticGeneratingEntries] = useState<AssetGeneratingEntry[]>([]);

  const assets = useMemo(() => {
    const rawAssets = tab === "characters" ? series.characters : tab === "scenes" ? series.scenes : series.props;
    if (!rawAssets) return [];
    return [...rawAssets].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (timeA !== timeB) {
        return timeA - timeB; // Sort by creation time ascending
      }
      // Fallback to name or id for stable sorting when created_at is identical
      const nameA = a.name || "";
      const nameB = b.name || "";
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }, [tab, series.characters, series.scenes, series.props]);
  const label = ASSET_LABELS[tab];
  const extractTaskPrice = getTaskPrice(SERIES_ASSET_EXTRACT_TASK_TYPE) || getTaskPrice(PROJECT_REPARSE_TASK_TYPE);
  const extractTaskAffordable = canAffordTask(SERIES_ASSET_EXTRACT_TASK_TYPE) || canAffordTask(PROJECT_REPARSE_TASK_TYPE);
  const resolvedExtractTaskPrice = extractTaskPrice > 0 ? extractTaskPrice : null;

  const previewCounts = useMemo(
    () => ({
      characters: previewGroups.characters.filter((item) => selectedPreviewIds[item.id] !== false).length,
      scenes: previewGroups.scenes.filter((item) => selectedPreviewIds[item.id] !== false).length,
      props: previewGroups.props.filter((item) => selectedPreviewIds[item.id] !== false).length,
    }),
    [previewGroups, selectedPreviewIds],
  );
  const pendingCounts = useMemo(
    () => ({
      characters: pendingReviewGroups.characters.filter((item) => selectedPendingIds[item.id] !== false).length,
      scenes: pendingReviewGroups.scenes.filter((item) => selectedPendingIds[item.id] !== false).length,
      props: pendingReviewGroups.props.filter((item) => selectedPendingIds[item.id] !== false).length,
    }),
    [pendingReviewGroups, selectedPendingIds],
  );
  const pendingTotalCount = pendingReviewGroups.characters.length + pendingReviewGroups.scenes.length + pendingReviewGroups.props.length;

  const selectedAsset = useMemo(() => {
    if (!selectedAssetId) {
      return null;
    }
    return assets.find((item) => item.id === selectedAssetId) || null;
  }, [assets, selectedAssetId]);

  const backendGeneratingEntries = useMemo(() => {
    // 中文注释：系列资产“生成中”以后端任务状态为真源；只有活跃任务才会继续占用生成态。
    return dedupeGeneratingEntries(
      taskBucketIds
        .map((jobId) => jobsById[jobId])
        .filter((job) => {
          return (
            !!job
            && (job.task_type === "asset.generate" || job.task_type === "series.asset.generate" || job.task_type === "asset.motion_ref.generate")
            && !!job.resource_id
            && ACTIVE_TASK_STATUSES.has(job.status)
          );
        })
        .map((job) => {
          const generationType = job.task_type === "asset.motion_ref.generate"
            ? (job.payload_json?.asset_type === "head_shot" ? "video_head_shot" : "video_full_body")
            : String(job.payload_json?.generation_type || "all");
          return {
            assetId: job.resource_id as string,
            generationType,
            batchSize: Number(job.payload_json?.batch_size || 1),
            status: job.status,
          };
        }),
    );
  }, [jobsById, taskBucketIds]);

  const combinedGeneratingEntries = useMemo(() => {
    // 中文注释：先用本地即时态秒回用户操作，再由 taskStore 中的后端活跃任务态接管，避免关闭弹窗后状态丢失。
    return dedupeGeneratingEntries([...optimisticGeneratingEntries, ...backendGeneratingEntries]);
  }, [backendGeneratingEntries, optimisticGeneratingEntries]);

  const generatingEntriesByAssetId = useMemo(() => {
    // 中文注释：把生成态先按资产分组为稳定引用，避免子组件因为收到新的空数组/等价数组而重复触发副作用。
    const grouped = new Map<string, AssetGeneratingEntry[]>();
    for (const entry of combinedGeneratingEntries) {
      const bucket = grouped.get(entry.assetId);
      if (bucket) {
        bucket.push(entry);
      } else {
        grouped.set(entry.assetId, [entry]);
      }
    }
    return grouped;
  }, [combinedGeneratingEntries]);

  const handleGeneratingStateChange = ({ assetId, generationType, batchSize, isGenerating }: Omit<AssetGeneratingEntry, "status"> & { isGenerating: boolean }) => {
    setOptimisticGeneratingEntries((current) => {
      const next = current.filter((entry) => !(entry.assetId === assetId && entry.generationType === generationType));
      return isGenerating ? [...next, { assetId, generationType, batchSize, status: "queued" }] : next;
    });
  };

  const getAssetGeneratingEntries = (assetId: string) => generatingEntriesByAssetId.get(assetId) ?? EMPTY_GENERATING_ENTRIES;

  const selectedAssetGeneratingTypes = useMemo(() => {
    if (!selectedAsset) {
      return [];
    }
    return getAssetGeneratingEntries(selectedAsset.id).map((entry) => ({
      type: entry.generationType,
      batchSize: entry.batchSize,
      status: entry.status,
    }));
  }, [selectedAsset, generatingEntriesByAssetId]);

  useEffect(() => {
    let disposed = false;

    const hydrateSeriesJobs = async () => {
      try {
        await fetchProjectJobs(undefined, Array.from(ACTIVE_TASK_STATUSES), { seriesId: series.id, limit: 200 });
      } catch (error) {
        if (!disposed) {
          console.error("Failed to hydrate series asset jobs:", error);
        }
      }
    };

    void hydrateSeriesJobs();

    return () => {
      disposed = true;
    };
  }, [fetchProjectJobs, series.id]);

  useEffect(() => {
    if (backendGeneratingEntries.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchProjectJobs(undefined, Array.from(ACTIVE_TASK_STATUSES), { seriesId: series.id, limit: 200 }).catch((error) => {
        console.error("Failed to refresh active series asset jobs:", error);
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [backendGeneratingEntries.length, fetchProjectJobs, series.id]);

  useEffect(() => {
    let disposed = false;
    const hydratePendingInbox = async () => {
      try {
        const inbox = await api.getSeriesAssetInbox(series.id);
        if (disposed) {
          return;
        }
        const nextGroups: PreviewGroups = {
          characters: inbox.characters || [],
          scenes: inbox.scenes || [],
          props: inbox.props || [],
        };
        setPendingReviewGroups(nextGroups);
        setSelectedPendingIds(buildSelectedMap(nextGroups));
      } catch (error) {
        if (!disposed) {
          console.error("Failed to hydrate series asset inbox:", error);
        }
      }
    };
    void hydratePendingInbox();
    return () => {
      disposed = true;
    };
  }, [series.id]);

  const resetExtractDialog = () => {
    setExtractStep("input");
    setExtractInput("");
    setPreviewGroups(EMPTY_GROUPS);
    setSelectedPreviewIds({});
    setIsSubmittingExtract(false);
    setIsImporting(false);
    setExtractError(null);
  };

  const closeExtractDialog = () => {
    setIsExtractDialogOpen(false);
    resetExtractDialog();
  };

  const handleCreateAsset = async (type: AssetEntityType, data: DraftAssetInput) => {
    // 中文注释：剧集资产统一通过批量同步接口落库，确保手工新增和自动导入共用同一真源。
    const nextCharacters = [...series.characters];
    const nextScenes = [...series.scenes];
    const nextProps = [...series.props];

    if (type === "character") {
      nextCharacters.push(buildEmptyCharacter(data));
    } else if (type === "scene") {
      nextScenes.push(buildEmptyScene(data));
    } else {
      nextProps.push(buildEmptyProp(data));
    }

    const updatedSeries = await api.syncSeriesAssets(series.id, {
      expected_version: series.version ?? 1,
      characters: nextCharacters,
      scenes: nextScenes,
      props: nextProps,
    });
    onSeriesUpdated(updatedSeries);
    toast.success(`已新增${type === "character" ? "角色" : type === "scene" ? "场景" : "道具"}资产「${data.name.trim()}」`);
    setIsCreateDialogOpen(false);
  };

  const handleDeleteAsset = async (assetId: string) => {
    const deletingAsset = assets.find((item) => item.id === assetId);
    if (!deletingAsset) {
      return;
    }
    if (!confirm(`确定要删除${label}资产「${deletingAsset.name}」吗？`)) {
      return;
    }

    try {
      // 中文注释：系列资产删除和新增保持同一条批量同步链路，避免写出第二套旁路删除接口导致状态漂移。
      const updatedSeries = await api.syncSeriesAssets(series.id, {
        expected_version: series.version ?? 1,
        characters: tab === "characters" ? series.characters.filter((item) => item.id !== assetId) : series.characters,
        scenes: tab === "scenes" ? series.scenes.filter((item) => item.id !== assetId) : series.scenes,
        props: tab === "props" ? series.props.filter((item) => item.id !== assetId) : series.props,
      });
      onSeriesUpdated(updatedSeries);
      if (selectedAssetId === assetId) {
        setSelectedAssetId(null);
      }
      toast.success(`已删除${label}资产「${deletingAsset.name}」`);
    } catch (error) {
      console.error("Failed to delete series asset:", error);
      alert(error instanceof Error ? error.message : "删除资产失败");
    }
  };

  const handleStartExtract = async () => {
    if (!extractInput.trim()) {
      setExtractError("请先输入剧本或资产文本。");
      return;
    }

    setExtractError(null);
    setIsSubmittingExtract(true);
    setExtractStep("loading");

    try {
      // 中文注释：系列资产识别只走正式的系列任务链路；如果失败，直接暴露新链路错误，便于定位后端问题。
      const receipt = await api.extractSeriesAssets(series.id, extractInput.trim());
      enqueueReceipts(series.id, [receipt]);
      const job = await waitForJob(receipt.job_id, { intervalMs: 2000, maxAttempts: 240 });
      if (job.status !== "succeeded") {
        throw new Error(job.error_message || "自动识别资产失败");
      }
      const nextGroups: PreviewGroups = {
        characters: job.result_json?.characters || [],
        scenes: job.result_json?.scenes || [],
        props: job.result_json?.props || [],
      };

      const extractedCount = nextGroups.characters.length + nextGroups.scenes.length + nextGroups.props.length;
      if (extractedCount === 0) {
        setExtractStep("input");
        setExtractError("暂未识别到任何角色、场景或道具，请尝试粘贴更完整的剧本内容，或直接输入更明确的角色设定列表。");
        return;
      }
      setPreviewGroups(nextGroups);
      setSelectedPreviewIds(
        Object.fromEntries(
          [...nextGroups.characters, ...nextGroups.scenes, ...nextGroups.props].map((item) => [item.id, true]),
        ),
      );
      setExtractStep("preview");
    } catch (error) {
      console.error("Failed to extract series assets:", error);
      setExtractStep("input");
      setExtractError(error instanceof Error ? error.message : "自动识别资产失败");
    } finally {
      setIsSubmittingExtract(false);
    }
  };

  const handleConfirmImport = async () => {
    setIsImporting(true);
    try {
      const selectedCharacters = previewGroups.characters.filter((item) => selectedPreviewIds[item.id] !== false);
      const selectedScenes = previewGroups.scenes.filter((item) => selectedPreviewIds[item.id] !== false);
      const selectedProps = previewGroups.props.filter((item) => selectedPreviewIds[item.id] !== false);
      const selectedCount = selectedCharacters.length + selectedScenes.length + selectedProps.length;
      if (selectedCount === 0) {
        alert("请至少选择 1 个候选资产再加入收件箱。");
        return;
      }

      // 中文注释：待确认收件箱以后端真源为准，避免刷新页面后本地临时态丢失。
      const inbox = await api.upsertSeriesAssetInbox(series.id, {
        mode: "append",
        characters: selectedCharacters,
        scenes: selectedScenes,
        props: selectedProps,
      });
      const nextGroups: PreviewGroups = {
        characters: inbox.characters || [],
        scenes: inbox.scenes || [],
        props: inbox.props || [],
      };
      setPendingReviewGroups(nextGroups);
      setSelectedPendingIds(buildSelectedMap(nextGroups));
      closeExtractDialog();
      toast.success(`已加入待确认收件箱 ${selectedCount} 项，请在收件箱中确认后再合并到剧集资产库。`);
    } catch (error) {
      console.error("Failed to append assets into inbox:", error);
      alert(error instanceof Error ? error.message : "加入待确认收件箱失败");
    } finally {
      setIsImporting(false);
    }
  };

  const handleApplyPendingReview = async () => {
    setIsApplyingPending(true);
    try {
      const selectedCharacters = pendingReviewGroups.characters.filter((item) => selectedPendingIds[item.id] !== false);
      const selectedScenes = pendingReviewGroups.scenes.filter((item) => selectedPendingIds[item.id] !== false);
      const selectedProps = pendingReviewGroups.props.filter((item) => selectedPendingIds[item.id] !== false);
      const selectedCount = selectedCharacters.length + selectedScenes.length + selectedProps.length;
      if (selectedCount === 0) {
        alert("请至少勾选 1 个候选资产再确认合并。");
        return;
      }

      const mergedCharacters = appendUniqueAssets(series.characters, selectedCharacters);
      const mergedScenes = appendUniqueAssets(series.scenes, selectedScenes);
      const mergedProps = appendUniqueAssets(series.props, selectedProps);
      const updatedSeries = await api.syncSeriesAssets(series.id, {
        expected_version: series.version ?? 1,
        characters: mergedCharacters.merged,
        scenes: mergedScenes.merged,
        props: mergedProps.merged,
      });
      onSeriesUpdated(updatedSeries);

      const inbox = await api.removeSeriesAssetInboxItems(series.id, {
        character_ids: selectedCharacters.map((item) => item.id),
        scene_ids: selectedScenes.map((item) => item.id),
        prop_ids: selectedProps.map((item) => item.id),
      });
      const nextGroups: PreviewGroups = {
        characters: inbox.characters || [],
        scenes: inbox.scenes || [],
        props: inbox.props || [],
      };
      setPendingReviewGroups(nextGroups);
      setSelectedPendingIds(buildSelectedMap(nextGroups));
      const importedCount =
        mergedCharacters.importedCount + mergedScenes.importedCount + mergedProps.importedCount;
      const skippedCount =
        mergedCharacters.skippedCount + mergedScenes.skippedCount + mergedProps.skippedCount;
      if ((nextGroups.characters.length + nextGroups.scenes.length + nextGroups.props.length) === 0) {
        setIsPendingInboxOpen(false);
      }
      toast.success(
        skippedCount > 0
          ? `已确认并合并 ${importedCount} 项，另有 ${skippedCount} 项同名候选自动并入已有资产。`
          : `已确认并合并 ${importedCount} 项到剧集资产库。`,
      );
    } catch (error) {
      console.error("Failed to apply pending review assets:", error);
      alert(error instanceof Error ? error.message : "确认收件箱候选失败");
    } finally {
      setIsApplyingPending(false);
    }
  };

  const handleDropUncheckedPending = async () => {
    const uncheckedIds = new Set(
      [...pendingReviewGroups.characters, ...pendingReviewGroups.scenes, ...pendingReviewGroups.props]
        .filter((item) => selectedPendingIds[item.id] === false)
        .map((item) => item.id),
    );
    if (uncheckedIds.size === 0) {
      return;
    }
    try {
      const inbox = await api.removeSeriesAssetInboxItems(series.id, {
        character_ids: pendingReviewGroups.characters.filter((item) => uncheckedIds.has(item.id)).map((item) => item.id),
        scene_ids: pendingReviewGroups.scenes.filter((item) => uncheckedIds.has(item.id)).map((item) => item.id),
        prop_ids: pendingReviewGroups.props.filter((item) => uncheckedIds.has(item.id)).map((item) => item.id),
      });
      const nextGroups: PreviewGroups = {
        characters: inbox.characters || [],
        scenes: inbox.scenes || [],
        props: inbox.props || [],
      };
      setPendingReviewGroups(nextGroups);
      setSelectedPendingIds(buildSelectedMap(nextGroups));
      toast.success(`已移除 ${uncheckedIds.size} 个未勾选候选。`);
    } catch (error) {
      console.error("Failed to remove unchecked inbox candidates:", error);
      alert(error instanceof Error ? error.message : "移除未勾选候选失败");
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={PANEL_TRANSITION}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-white/10 px-8 pb-5 pt-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="h-1 w-7 rounded-full bg-primary/80" />
                <h2 className="text-xl font-bold text-gray-200">资产制作</h2>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-gray-300">
                  {series.characters.length + series.scenes.length + series.props.length}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPendingInboxOpen(true)}
                className={`${SURFACE_BUTTON_CLASS} studio-action-button-ghost`}
              >
                <Inbox size={16} />
                待确认收件箱
                {pendingTotalCount > 0 ? (
                  <span className="rounded-full bg-[color:var(--video-workspace-warning-soft)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--studio-shell-warning)]">
                    {pendingTotalCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setIsExtractDialogOpen(true)}
                className={`${SURFACE_BUTTON_CLASS} studio-action-button-warm`}
              >
                <Wand2 size={16} />
                自动识别资产
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateDialogType(tab === "characters" ? "character" : tab === "scenes" ? "scene" : "prop");
                  setIsCreateDialogOpen(true);
                }}
                className={`${SURFACE_BUTTON_CLASS} studio-action-button-accent`}
              >
                <Plus size={16} />
                新增资产
              </button>
            </div>
          </div>

          <div className="mt-5">
            <AssetTypeTabs
              layoutIdPrefix="series-asset-studio"
              value={tab}
              onChange={onTabChange}
              items={[
                { id: "characters", label: "角色", icon: <Users size={14} />, count: series.characters.length },
                { id: "scenes", label: "场景", icon: <MapPin size={14} />, count: series.scenes.length },
                { id: "props", label: "道具", icon: <Package size={14} />, count: series.props.length },
              ]}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-10 pt-7 scrollbar-hide">
          {pendingTotalCount > 0 ? (
            <div className="video-card mb-6 rounded-[24px] border border-[color:color-mix(in_srgb,var(--studio-shell-warning)_24%,var(--video-workspace-border))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--video-workspace-warning-soft)_86%,transparent),color-mix(in_srgb,var(--video-workspace-panel)_96%,transparent))] px-5 py-4 shadow-[var(--video-workspace-shadow-soft)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--studio-text-strong)]">
                    <Inbox size={15} className="text-[color:var(--studio-shell-warning)]" />
                    收件箱里还有 {pendingTotalCount} 项待人工确认
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--studio-text-faint)]">
                    角色 {pendingReviewGroups.characters.length} · 场景 {pendingReviewGroups.scenes.length} · 道具 {pendingReviewGroups.props.length}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPendingInboxOpen(true)}
                  className="studio-action-button studio-action-button-success"
                >
                  <Check size={15} />
                  去确认并合并
                </button>
              </div>
            </div>
          ) : null}
          {assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-28 text-gray-400">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
                <Boxes size={28} className="text-gray-500" />
              </div>
              <p className="text-sm font-medium text-gray-200">暂无{label}资产</p>
              <p className="mt-1 text-xs text-gray-500">可直接新增，或先用自动识别资产批量导入。</p>
            </div>
          ) : (
            <motion.div
              className="grid gap-6 md:grid-cols-3 xl:grid-cols-5"
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
            >
              {assets.map((asset) => (
                <motion.div
                  key={asset.id}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.35, ease: [0.25, 1, 0.5, 1] },
                    },
                  }}
                >
                  <StudioAssetCard
                    asset={asset}
                    type={tab}
                    isGenerating={getAssetGeneratingEntries(asset.id).length > 0}
                    generationLabel={
                      getAssetGeneratingEntries(asset.id).some((entry) => entry.status === "running")
                        ? "生成中"
                        : "排队中"
                    }
                    onClick={() => setSelectedAssetId(asset.id)}
                    onDelete={() => {
                      void handleDeleteAsset(asset.id);
                    }}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {isCreateDialogOpen ? (
          <SeriesCreateAssetDialog
            initialType={createDialogType}
            onClose={() => setIsCreateDialogOpen(false)}
            onCreate={handleCreateAsset}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {selectedAsset ? (
          <SeriesAssetWorkbenchModal
            series={series}
            asset={selectedAsset}
            assetType={tab === "characters" ? "character" : tab === "scenes" ? "scene" : "prop"}
            generatingTypes={selectedAssetGeneratingTypes}
            onGeneratingStateChange={handleGeneratingStateChange}
            onClose={() => setSelectedAssetId(null)}
            onSeriesUpdated={onSeriesUpdated}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isExtractDialogOpen ? (
          <SeriesAutoExtractDialog
            theme={theme}
            inputValue={extractInput}
            step={extractStep}
            previewGroups={previewGroups}
            selectedIds={selectedPreviewIds}
            previewCounts={previewCounts}
            isSubmitting={isSubmittingExtract}
            isImporting={isImporting}
            extractError={extractError}
            extractTaskPrice={resolvedExtractTaskPrice}
            extractTaskAffordable={extractTaskAffordable}
            balanceCredits={account?.balance_credits}
            onClose={closeExtractDialog}
            onBack={() => setExtractStep("input")}
            onStart={handleStartExtract}
            onConfirmImport={handleConfirmImport}
            onInputChange={(value) => {
              setExtractInput(value);
              if (extractError) {
                setExtractError(null);
              }
            }}
            onToggleItem={(itemId) =>
              setSelectedPreviewIds((prev) => ({ ...prev, [itemId]: prev[itemId] === false }))
            }
            onToggleGroup={(groupKey, checked) => {
              const group = previewGroups[groupKey];
              setSelectedPreviewIds((prev) => ({
                ...prev,
                ...Object.fromEntries(group.map((item) => [item.id, checked])),
              }));
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isPendingInboxOpen ? (
          <SeriesPendingInboxDialog
            theme={theme}
            pendingGroups={pendingReviewGroups}
            selectedIds={selectedPendingIds}
            pendingCounts={pendingCounts}
            isApplying={isApplyingPending}
            onClose={() => setIsPendingInboxOpen(false)}
            onConfirmApply={handleApplyPendingReview}
            onDropUnchecked={handleDropUncheckedPending}
            onToggleItem={(itemId) =>
              setSelectedPendingIds((prev) => ({ ...prev, [itemId]: prev[itemId] === false }))
            }
            onToggleGroup={(groupKey, checked) => {
              const group = pendingReviewGroups[groupKey];
              setSelectedPendingIds((prev) => ({
                ...prev,
                ...Object.fromEntries(group.map((item) => [item.id, checked])),
              }));
            }}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function SeriesAutoExtractDialog({
  theme,
  inputValue,
  onInputChange,
  step,
  previewGroups,
  selectedIds,
  previewCounts,
  isSubmitting,
  isImporting,
  extractError,
  extractTaskPrice,
  extractTaskAffordable,
  balanceCredits,
  onClose,
  onBack,
  onStart,
  onConfirmImport,
  onToggleItem,
  onToggleGroup,
}: {
  theme: PanelTheme;
  inputValue: string;
  onInputChange: (value: string) => void;
  step: ExtractStep;
  previewGroups: PreviewGroups;
  selectedIds: Record<string, boolean>;
  previewCounts: Record<keyof PreviewGroups, number>;
  isSubmitting: boolean;
  isImporting: boolean;
  extractError: string | null;
  extractTaskPrice: number | null;
  extractTaskAffordable: boolean;
  balanceCredits?: number;
  onClose: () => void;
  onBack: () => void;
  onStart: () => void;
  onConfirmImport: () => void;
  onToggleItem: (itemId: string) => void;
  onToggleGroup: (groupKey: keyof PreviewGroups, checked: boolean) => void;
}) {
  const totalSelected = previewCounts.characters + previewCounts.scenes + previewCounts.props;

  return (
    <div data-studio-theme={theme} className="studio-theme-root studio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-[color:var(--video-workspace-border-strong)] bg-[color:var(--video-workspace-panel-strong)] text-[color:var(--studio-text-strong)] shadow-[var(--video-workspace-shadow)]"
      >
        <div className="studio-panel-header border-b border-[color:var(--video-workspace-border)] px-8 py-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:color-mix(in_srgb,var(--studio-shell-warning)_24%,var(--video-workspace-border))] bg-[color:var(--video-workspace-warning-soft)] text-[color:var(--studio-shell-warning)]">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[color:var(--studio-text-strong)]">自动识别资产</h2>
                  <p className="mt-1 text-xs text-[color:var(--studio-text-faint)]">
                    粘贴剧本正文或角色批量信息，系统会自动拆分为角色、场景和道具供你确认导入。
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="studio-icon-button h-10 w-10"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {step === "input" ? (
            <div className="flex h-full flex-col px-8 py-7">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="video-card flex min-h-0 flex-1 flex-col rounded-[28px] p-6">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[color:var(--studio-text-strong)]">
                    <Wand2 size={16} className="text-[color:var(--studio-shell-warning)]" />
                    输入待识别文本
                  </div>
                  {extractError ? (
                    <div className="mb-4 rounded-2xl border border-[color:color-mix(in_srgb,#b43838_34%,var(--video-workspace-border))] bg-[color:var(--video-workspace-danger-soft)] px-4 py-3 text-sm leading-6 text-[#b43838]">
                      {extractError}
                    </div>
                  ) : null}
                  <div className="min-h-0 flex-1 overflow-hidden rounded-[24px]">
                    <textarea
                      value={inputValue}
                      onChange={(event) => onInputChange(event.target.value)}
                      placeholder="例如：粘贴完整剧本，或按行输入角色设定、场景说明、重要道具信息。"
                      className="video-textarea h-full min-h-0 w-full resize-none rounded-[24px] px-5 py-4 text-sm leading-7"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === "loading" ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-2xl" />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--studio-shell-warning)_24%,var(--video-workspace-border))] bg-[color:var(--video-workspace-warning-soft)]">
                  <Loader2 size={30} className="animate-spin text-[color:var(--studio-shell-warning)]" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[color:var(--studio-text-strong)]">正在识别角色、场景与道具</h3>
                <p className="mt-2 text-sm text-[color:var(--studio-text-faint)]">识别完成后会自动切换到预览分组，你可以筛选后再导入资产池。</p>
              </div>
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="flex h-full flex-col overflow-hidden px-8 py-7">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-[color:var(--studio-text-strong)]">识别结果预览</h3>
                  <p className="mt-1 text-sm text-[color:var(--studio-text-faint)]">默认已全选，可取消不需要的项后加入待确认收件箱。</p>
                </div>
                <div className="studio-action-button studio-action-button-success rounded-2xl px-4 py-2 text-sm">
                  已选择 {totalSelected} 个资产
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-3">
                <PreviewGroupColumn
                  title="角色"
                  icon={<User size={16} />}
                  count={previewCounts.characters}
                  items={previewGroups.characters}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("characters", checked)}
                />
                <PreviewGroupColumn
                  title="场景"
                  icon={<MapPin size={16} />}
                  count={previewCounts.scenes}
                  items={previewGroups.scenes}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("scenes", checked)}
                />
                <PreviewGroupColumn
                  title="道具"
                  icon={<Package size={16} />}
                  count={previewCounts.props}
                  items={previewGroups.props}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("props", checked)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="studio-panel-subheader relative z-20 flex items-center justify-between gap-4 overflow-visible border-t border-[color:var(--video-workspace-border)] px-8 py-5">
          <div className="text-xs text-[color:var(--studio-text-faint)]">
            {step === "preview" ? "此步骤只会加入待确认收件箱，不会直接写入剧集资产主档。" : "识别完成前不会改动当前剧集的任何资产。"}
          </div>
          <div className="flex items-center gap-3">
            {step === "preview" ? (
              <button
                type="button"
                onClick={onBack}
                className="studio-action-button studio-action-button-ghost"
              >
                返回修改
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="studio-action-button studio-action-button-ghost"
            >
              取消
            </button>
            {step === "input" ? (
              <div className="flex flex-col items-end gap-2">
                <BillingActionButton
                  type="button"
                  disabled={isSubmitting || !extractTaskAffordable}
                  onClick={onStart}
                  priceCredits={extractTaskPrice}
                  balanceCredits={balanceCredits}
                  className={PRIMARY_ACTION_CLASS}
                  wrapperClassName="z-30"
                  tooltipText={
                    extractTaskPrice == null
                      ? "按剧本处理页的实体提取规则计费"
                      : `预计消耗${extractTaskPrice}算力豆${!extractTaskAffordable ? "，当前余额不足" : ""}`
                  }
                  tooltipClassName="z-40"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {isSubmitting ? "识别中..." : "开始识别"}
                </BillingActionButton>
              </div>
            ) : null}
            {step === "preview" ? (
              <button
                type="button"
                disabled={isImporting}
                onClick={onConfirmImport}
                className="studio-action-button studio-action-button-success"
              >
                {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                加入待确认收件箱
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function SeriesPendingInboxDialog({
  theme,
  pendingGroups,
  selectedIds,
  pendingCounts,
  isApplying,
  onClose,
  onConfirmApply,
  onDropUnchecked,
  onToggleItem,
  onToggleGroup,
}: {
  theme: PanelTheme;
  pendingGroups: PreviewGroups;
  selectedIds: Record<string, boolean>;
  pendingCounts: Record<keyof PreviewGroups, number>;
  isApplying: boolean;
  onClose: () => void;
  onConfirmApply: () => void;
  onDropUnchecked: () => void;
  onToggleItem: (itemId: string) => void;
  onToggleGroup: (groupKey: keyof PreviewGroups, checked: boolean) => void;
}) {
  const totalCount = pendingGroups.characters.length + pendingGroups.scenes.length + pendingGroups.props.length;
  const totalSelected = pendingCounts.characters + pendingCounts.scenes + pendingCounts.props;
  const uncheckedCount = totalCount - totalSelected;

  return (
    <div data-studio-theme={theme} className="studio-theme-root studio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        className="flex h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-[color:var(--video-workspace-border-strong)] bg-[color:var(--video-workspace-panel-strong)] text-[color:var(--studio-text-strong)] shadow-[var(--video-workspace-shadow)]"
      >
        <div className="studio-panel-header border-b border-[color:var(--video-workspace-border)] px-8 py-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:color-mix(in_srgb,var(--studio-shell-warning)_24%,var(--video-workspace-border))] bg-[color:var(--video-workspace-warning-soft)] text-[color:var(--studio-shell-warning)]">
                  <Inbox size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[color:var(--studio-text-strong)]">待确认资产收件箱</h2>
                  <p className="mt-1 text-xs text-[color:var(--studio-text-faint)]">
                    分集提取结果先进入收件箱，只有确认后才会合并到剧集资产主档并对全剧生效。
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="studio-icon-button h-10 w-10"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-7">
          {totalCount === 0 ? (
            <div className="video-card flex min-h-0 flex-1 flex-col items-center justify-center rounded-[28px] border border-dashed border-[color:var(--video-workspace-border)]">
              <Inbox size={30} className="text-[color:var(--studio-text-faint)]" />
              <p className="mt-4 text-sm font-medium text-[color:var(--studio-text-strong)]">收件箱暂时为空</p>
              <p className="mt-1 text-xs text-[color:var(--studio-text-faint)]">你可以先使用“自动识别资产”把分集提取结果加入收件箱。</p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[color:var(--studio-text-strong)]">候选资产审核</h3>
                  <p className="mt-1 text-sm text-[color:var(--studio-text-faint)]">已勾选 {totalSelected} 项，将在确认后进入剧集共享资产。</p>
                </div>
                <div className="studio-action-button studio-action-button-success rounded-2xl px-4 py-2 text-sm">
                  总计 {totalCount} 项
                </div>
              </div>

              <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-3">
                <PreviewGroupColumn
                  title="角色"
                  icon={<User size={16} />}
                  count={pendingCounts.characters}
                  items={pendingGroups.characters}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("characters", checked)}
                />
                <PreviewGroupColumn
                  title="场景"
                  icon={<MapPin size={16} />}
                  count={pendingCounts.scenes}
                  items={pendingGroups.scenes}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("scenes", checked)}
                />
                <PreviewGroupColumn
                  title="道具"
                  icon={<Package size={16} />}
                  count={pendingCounts.props}
                  items={pendingGroups.props}
                  selectedIds={selectedIds}
                  onToggleItem={onToggleItem}
                  onToggleAll={(checked) => onToggleGroup("props", checked)}
                />
              </div>
            </>
          )}
        </div>

        <div className="studio-panel-subheader relative z-20 flex items-center justify-between gap-4 overflow-visible border-t border-[color:var(--video-workspace-border)] px-8 py-5">
          <div className="text-xs text-[color:var(--studio-text-faint)]">
            {totalCount === 0 ? "收件箱为空，关闭后可返回资产制作台。" : "仅已勾选候选会并入剧集资产库，未勾选项可继续保留或移除。"}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="studio-action-button studio-action-button-ghost"
            >
              关闭
            </button>
            {uncheckedCount > 0 ? (
              <button
                type="button"
                onClick={onDropUnchecked}
                className="studio-action-button studio-action-button-ghost"
              >
                移除未勾选项 ({uncheckedCount})
              </button>
            ) : null}
            <button
              type="button"
              disabled={isApplying || totalCount === 0}
              onClick={onConfirmApply}
              className="studio-action-button studio-action-button-success disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplying ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              确认并合并到剧集资产
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PreviewGroupColumn({
  title,
  icon,
  count,
  items,
  selectedIds,
  onToggleItem,
  onToggleAll,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  items: Array<Character | Scene | Prop>;
  selectedIds: Record<string, boolean>;
  onToggleItem: (itemId: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const allChecked = items.length > 0 && items.every((item) => selectedIds[item.id] !== false);

  return (
    <div className="video-card flex min-h-0 flex-col overflow-hidden rounded-[28px]">
      <div className="border-b border-[color:var(--video-workspace-border)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[color:var(--studio-text-strong)]">
            <span className="video-card-soft inline-flex h-8 w-8 items-center justify-center rounded-2xl text-[color:var(--studio-text-soft)]">
              {icon}
            </span>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-[color:var(--studio-text-faint)]">已选择 {count} 项</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onToggleAll(!allChecked)}
            className="studio-action-button studio-action-button-ghost rounded-xl px-3 py-1.5 text-xs"
          >
            {allChecked ? "清空" : "全选"}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--video-workspace-border)] px-4 py-8 text-center text-sm text-[color:var(--studio-text-faint)]">
            暂未识别到{title}
          </div>
        ) : null}
        {items.map((item) => {
          const checked = selectedIds[item.id] !== false;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggleItem(item.id)}
              className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                checked
                  ? "border-[color:rgba(36,106,79,0.24)] bg-[color:var(--video-workspace-success-soft)] shadow-[var(--video-workspace-shadow-soft)]"
                  : "border-[color:var(--video-workspace-border)] bg-[color:color-mix(in_srgb,var(--video-workspace-panel-soft)_88%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--video-workspace-panel)_92%,transparent)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md border ${
                    checked
                      ? "border-[color:rgba(36,106,79,0.24)] bg-[color:var(--video-workspace-success-soft)] text-[#246a4f]"
                      : "border-[color:var(--video-workspace-border)] bg-[color:color-mix(in_srgb,var(--video-workspace-panel-soft)_88%,transparent)] text-transparent"
                  }`}
                >
                  <Check size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[color:var(--studio-text-strong)]">{item.name}</div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-[color:var(--studio-text-faint)]">
                    {item.description || "暂无描述"}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SeriesCreateAssetDialog({
  initialType,
  onClose,
  onCreate,
}: {
  initialType: AssetEntityType;
  onClose: () => void;
  onCreate: (type: AssetEntityType, data: DraftAssetInput) => void | Promise<void>;
}) {
  const [activeType, setActiveType] = useState<AssetEntityType>(initialType);
  const [characterForm, setCharacterForm] = useState({
    name: "",
    description: "",
    age: "",
    gender: "",
    clothing: "",
  });
  const [sceneForm, setSceneForm] = useState({
    name: "",
    description: "",
    time_of_day: "",
    lighting_mood: "",
  });
  const [propForm, setPropForm] = useState({
    name: "",
    description: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const currentName =
      activeType === "character"
        ? characterForm.name
        : activeType === "scene"
          ? sceneForm.name
          : propForm.name;

    if (!currentName.trim()) {
      alert("请先填写名称");
      return;
    }

    setIsSubmitting(true);
    try {
      if (activeType === "character") {
        await onCreate("character", characterForm);
      } else if (activeType === "scene") {
        await onCreate("scene", sceneForm);
      } else {
        await onCreate("prop", propForm);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const typeLabel = activeType === "character" ? "角色" : activeType === "scene" ? "场景" : "道具";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 14 }}
        className="w-full max-w-xl overflow-hidden rounded-[30px] border border-white/10 bg-[#081120] shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
      >
        <div className="border-b border-white/10 bg-white/[0.03] px-7 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-sky-100">
                  <Plus size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">新增资产</h2>
                  <p className="mt-1 text-xs text-slate-400">延续资产制作台的表单结构，录入后会直接进入当前剧集资产池。</p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="studio-icon-button h-10 w-10"
            >
              <X size={18} />
            </button>
          </div>

          <div className="video-segmented mt-5 flex items-center gap-1 rounded-2xl p-1">
            <button
              type="button"
              onClick={() => setActiveType("character")}
              className={`video-segmented-button flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                activeType === "character" ? "video-segmented-button-active" : ""
              }`}
            >
              角色
            </button>
            <button
              type="button"
              onClick={() => setActiveType("scene")}
              className={`video-segmented-button flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                activeType === "scene" ? "video-segmented-button-active" : ""
              }`}
            >
              场景
            </button>
            <button
              type="button"
              onClick={() => setActiveType("prop")}
              className={`video-segmented-button flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                activeType === "prop" ? "video-segmented-button-active" : ""
              }`}
            >
              道具
            </button>
          </div>
        </div>

        <div className="space-y-5 px-7 py-6">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">名称 *</label>
            <input
              type="text"
              value={
                activeType === "character"
                  ? characterForm.name
                  : activeType === "scene"
                    ? sceneForm.name
                    : propForm.name
              }
              onChange={(event) => {
                const nextValue = event.target.value;
                if (activeType === "character") {
                  setCharacterForm((prev) => ({ ...prev, name: nextValue }));
                } else if (activeType === "scene") {
                  setSceneForm((prev) => ({ ...prev, name: nextValue }));
                } else {
                  setPropForm((prev) => ({ ...prev, name: nextValue }));
                }
              }}
              placeholder={`请输入${typeLabel}名称`}
              className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">描述</label>
            <textarea
              rows={4}
              value={
                activeType === "character"
                  ? characterForm.description
                  : activeType === "scene"
                    ? sceneForm.description
                    : propForm.description
              }
              onChange={(event) => {
                const nextValue = event.target.value;
                if (activeType === "character") {
                  setCharacterForm((prev) => ({ ...prev, description: nextValue }));
                } else if (activeType === "scene") {
                  setSceneForm((prev) => ({ ...prev, description: nextValue }));
                } else {
                  setPropForm((prev) => ({ ...prev, description: nextValue }));
                }
              }}
              placeholder={`请输入${typeLabel}描述`}
              className="w-full resize-none rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
            />
          </div>

          {activeType === "character" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-xs text-slate-500">年龄</label>
                <input
                  value={characterForm.age}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, age: event.target.value }))}
                  placeholder="例如：18"
                  className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-500">性别</label>
                <input
                  value={characterForm.gender}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, gender: event.target.value }))}
                  placeholder="例如：女"
                  className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-2 block text-xs text-slate-500">服装</label>
                <input
                  value={characterForm.clothing}
                  onChange={(event) => setCharacterForm((prev) => ({ ...prev, clothing: event.target.value }))}
                  placeholder="例如：黑色风衣、银饰"
                  className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
                />
              </div>
            </div>
          ) : null}

          {activeType === "scene" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-xs text-slate-500">时间段</label>
                <input
                  value={sceneForm.time_of_day}
                  onChange={(event) => setSceneForm((prev) => ({ ...prev, time_of_day: event.target.value }))}
                  placeholder="例如：夜晚"
                  className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-slate-500">光照氛围</label>
                <input
                  value={sceneForm.lighting_mood}
                  onChange={(event) => setSceneForm((prev) => ({ ...prev, lighting_mood: event.target.value }))}
                  placeholder="例如：冷蓝霓虹"
                  className="w-full rounded-2xl border border-white/10 bg-[#050b16] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-sky-300/30"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-white/[0.03] px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-100 transition-colors hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            创建资产
          </button>
        </div>
      </motion.div>
    </div>
  );
}
