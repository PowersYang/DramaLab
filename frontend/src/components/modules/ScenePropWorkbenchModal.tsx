"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Box, Check, FileText, Image as ImageIcon, MapPin, Sparkles, Video, X, RefreshCw } from "lucide-react";

import BillingActionButton from "@/components/billing/BillingActionButton";
import { api, type AssetPromptState } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { getLatestVariantBatch } from "@/lib/variantBatches";
import type { Prop, Scene } from "@/store/projectStore";

type ScenePropAssetType = "scene" | "prop";

type ImageVariantLike = {
  id: string;
  url?: string | null;
  created_at?: string | number | null;
  prompt_used?: string | null;
  batch_id?: string | null;
};

type VideoVariantLike = {
  id: string;
  video_url?: string | null;
  created_at?: string | number | null;
};

interface ScenePropWorkbenchModalProps {
  asset: Scene | Prop;
  assetType: ScenePropAssetType;
  promptStateProjectId?: string;
  promptStateSeriesId?: string;
  onClose: () => void;
  onUpdateDescription: (description: string) => void | Promise<void>;
  onSelectVariant: (variantId: string) => void | Promise<void>;
  onDeleteVariant?: (variantId: string) => void | Promise<void>;
  onGenerateImage: (prompt: string, negativePrompt: string, batchSize: number) => void | Promise<void>;
  onGenerateVideo: (prompt: string, negativePrompt: string) => void | Promise<void>;
  isGeneratingImage?: boolean;
  isGeneratingVideo?: boolean;
  imagePriceCredits?: number | null;
  imageBalanceCredits?: number;
  imageAffordable?: boolean;
  videoPriceCredits?: number | null;
  videoBalanceCredits?: number;
  videoAffordable?: boolean;
  styleNegativePrompt?: string;
  videoGenerateEnabled?: boolean;
  videoDisabledReason?: string;
}

const parseVariantTime = (value: string | number | undefined | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const getAssetTypeLabel = (assetType: ScenePropAssetType) => (assetType === "scene" ? "场景" : "道具");

export default function ScenePropWorkbenchModal({
  asset,
  assetType,
  promptStateProjectId,
  promptStateSeriesId,
  onClose,
  onUpdateDescription,
  onSelectVariant,
  onDeleteVariant,
  onGenerateImage,
  onGenerateVideo,
  isGeneratingImage = false,
  isGeneratingVideo = false,
  imagePriceCredits = null,
  imageBalanceCredits = 0,
  imageAffordable = true,
  videoPriceCredits = null,
  videoBalanceCredits = 0,
  videoAffordable = true,
  styleNegativePrompt = "",
  videoGenerateEnabled = true,
  videoDisabledReason = "",
}: ScenePropWorkbenchModalProps) {
  const [description, setDescription] = useState(asset.description || "");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [activeMode, setActiveMode] = useState<"static" | "motion">("static");
  const [positivePrompt, setPositivePrompt] = useState("");
  const [motionPrompt, setMotionPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || "");
  const [batchSize, setBatchSize] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(asset.image_asset?.selected_id || null);
  const typeLabel = getAssetTypeLabel(assetType);
  const aspectClass = assetType === "scene" ? "aspect-video" : "aspect-square";

  const imageVariants = useMemo<ImageVariantLike[]>(
    () => (Array.isArray(asset.image_asset?.variants) ? (asset.image_asset.variants as ImageVariantLike[]) : []),
    [asset.image_asset?.variants],
  );
  const latestImageVariants = useMemo(() => getLatestVariantBatch(imageVariants), [imageVariants]);
  const previewImageVariants = latestImageVariants.length > 0 ? latestImageVariants : imageVariants;
  const visibleImageVariants = isGeneratingImage ? [] : previewImageVariants;
  const selectedVariant =
    imageVariants.find((variant) => variant.id === selectedVariantId)
    || imageVariants.find((variant) => variant.id === asset.image_asset?.selected_id)
    || imageVariants[0]
    || null;
  const selectedImageUrl = getAssetUrl(selectedVariant?.url || asset.image_url || "");
  const motionVideos = useMemo<VideoVariantLike[]>(
    () =>
      (Array.isArray(asset.video_assets) ? (asset.video_assets as VideoVariantLike[]) : [])
        .filter((video) => !!video?.video_url)
        .sort((left, right) => parseVariantTime(right.created_at) - parseVariantTime(left.created_at)),
    [asset.video_assets],
  );
  const hasSourceImage = Boolean(selectedImageUrl);
  const canGenerateVideo = videoGenerateEnabled && hasSourceImage && videoAffordable;
  const motionDisabledReason = !videoGenerateEnabled
    ? (videoDisabledReason || "当前入口暂未接入视频生成。")
    : !hasSourceImage
    ? "请先在静态模式选中一张图片。"
    : !videoAffordable
    ? "当前组织算力豆余额不足，无法提交视频任务。"
    : "";

  useEffect(() => {
    const selectedFromAsset =
      (asset.image_asset?.variants || []).find((variant) => variant.id === asset.image_asset?.selected_id)
      || asset.image_asset?.variants?.[0];
    const defaultPrompt =
      selectedFromAsset?.prompt_used
      || asset.video_prompt
      || (assetType === "scene"
        ? `电影级场景镜头：${asset.name}。${asset.description || "保持空间层次、氛围光和环境细节。"}`
        : `电影级道具特写：${asset.name}。${asset.description || "突出材质、轮廓与结构细节。"}`);
    setDescription(asset.description || "");
    setIsEditingDescription(false);
    setActiveMode("static");
    setSelectedVariantId(asset.image_asset?.selected_id || null);
    setPositivePrompt(defaultPrompt);
    setMotionPrompt(asset.video_prompt || defaultPrompt);
    setNegativePrompt(styleNegativePrompt || "");
  }, [asset.id, assetType]);

  useEffect(() => {
    const hasOwner = !!promptStateProjectId || !!promptStateSeriesId;
    if (!hasOwner || typeof api.getAssetPromptStates !== "function") {
      return;
    }
    let cancelled = false;
    const hydratePromptStates = async () => {
      try {
        const states = await api.getAssetPromptStates({
          assetId: asset.id,
          assetType,
          projectId: promptStateProjectId,
          seriesId: promptStateSeriesId,
        });
        if (cancelled) {
          return;
        }
        const stateMap = new Map(states.map((item: AssetPromptState) => [`${item.output_type}:${item.slot_type}`, item]));
        const imageState = stateMap.get("image:default");
        const motionState = stateMap.get("motion:default");
        if (imageState?.positive_prompt) {
          setPositivePrompt(imageState.positive_prompt);
        }
        if (motionState?.positive_prompt) {
          setMotionPrompt(motionState.positive_prompt);
        }
        if (imageState?.negative_prompt) {
          setNegativePrompt(imageState.negative_prompt);
        } else if (motionState?.negative_prompt) {
          setNegativePrompt(motionState.negative_prompt);
        }
      } catch (error) {
        console.error("Failed to hydrate scene/prop prompt states:", error);
      }
    };
    void hydratePromptStates();
    return () => {
      cancelled = true;
    };
  }, [asset.id, assetType, promptStateProjectId, promptStateSeriesId]);

  // 中文注释：列表变化后如果当前选中项已经失效，自动回退到后端 selected_id，避免左侧主图丢失。
  useEffect(() => {
    if (!selectedVariantId || !imageVariants.some((variant) => variant.id === selectedVariantId)) {
      setSelectedVariantId(asset.image_asset?.selected_id || null);
    }
  }, [asset.image_asset?.selected_id, imageVariants, selectedVariantId]);

  const handleSaveDescription = async () => {
    await onUpdateDescription(description);
    setIsEditingDescription(false);
  };

  const handleSelectVariant = async (variantId: string) => {
    setSelectedVariantId(variantId);
    try {
      await onSelectVariant(variantId);
    } catch {
      setSelectedVariantId(asset.image_asset?.selected_id || null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md md:p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="asset-workbench-shell asset-surface-strong flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-white/10 shadow-2xl"
      >
        <div className="flex h-20 items-center justify-between border-b border-white/5 bg-white/[0.02] px-8">
          <div className="flex items-center gap-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
              assetType === "scene"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "border-blue-500/20 bg-blue-500/10 text-blue-300"
            }`}>
              {assetType === "scene" ? <MapPin size={18} /> : <Box size={18} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">{asset.name}</h2>
                <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {typeLabel}工作台
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">项目页与剧集页复用同一弹窗组件。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2.5 text-gray-500 transition-all hover:bg-white/10 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 overflow-hidden xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="border-r border-white/5 bg-black/20 p-6">
            <div className="flex h-full flex-col gap-5">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <FileText size={14} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">素材描述</h3>
                  </div>
                  {!isEditingDescription && (
                    <button
                      type="button"
                      onClick={() => setIsEditingDescription(true)}
                      className="text-[11px] font-bold text-indigo-400 transition-colors hover:text-indigo-300"
                    >
                      修改
                    </button>
                  )}
                </div>
                {isEditingDescription ? (
                  <div className="space-y-3">
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-gray-200 outline-none transition-all focus:border-indigo-500/50"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDescription(asset.description || "");
                          setIsEditingDescription(false);
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-gray-500 transition-colors hover:text-gray-300"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void handleSaveDescription();
                        }}
                        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-indigo-500"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-gray-300">{description || "暂未填写描述"}</p>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                <div className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                主图预览
              </div>

              <div className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-black/40 ${aspectClass}`}>
                {selectedImageUrl ? (
                  <img
                    src={selectedImageUrl}
                    alt={`${typeLabel}主图`}
                    className="h-full w-full object-cover transition-transform duration-700 hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-semibold text-gray-500">
                    暂无可用主图
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="flex flex-col overflow-hidden bg-black/20">
            <div className="flex h-20 items-center justify-between border-b border-white/5 bg-black/20 px-8">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 p-1">
                <button
                  type="button"
                  onClick={() => setActiveMode("static")}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                    activeMode === "static" ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <ImageIcon size={14} />
                  静态
                </button>
                <button
                  type="button"
                  onClick={() => setActiveMode("motion")}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                    activeMode === "motion" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <Video size={14} />
                  动态
                </button>
              </div>

              <div className="flex items-center gap-3">
                {activeMode === "static" && (
                  <div className="flex items-center gap-2 mr-3">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mr-2">批量</span>
                    <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
                      {[1, 2, 3, 4].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setBatchSize(size)}
                          className={`w-10 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                            batchSize === size 
                              ? "bg-white/10 text-white" 
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeMode === "static" ? (
                  <BillingActionButton
                    type="button"
                    onClick={() => {
                      void onGenerateImage(positivePrompt, negativePrompt, batchSize);
                    }}
                    disabled={isGeneratingImage || !imageAffordable}
                    priceCredits={imagePriceCredits}
                    balanceCredits={imageBalanceCredits}
                    className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all ${
                      isGeneratingImage || !imageAffordable
                        ? "cursor-not-allowed border border-white/10 bg-white/5 text-gray-500"
                        : "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"
                    }`}
                  >
                    <Sparkles size={14} className={isGeneratingImage ? "animate-spin" : ""} />
                    {isGeneratingImage ? "生图中..." : "生成图片"}
                  </BillingActionButton>
                ) : (
                  <BillingActionButton
                    type="button"
                    onClick={() => {
                      void onGenerateVideo(motionPrompt, negativePrompt);
                    }}
                    disabled={isGeneratingVideo || !canGenerateVideo}
                    priceCredits={videoPriceCredits}
                    balanceCredits={videoBalanceCredits}
                    className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold transition-all ${
                      isGeneratingVideo || !canGenerateVideo
                        ? "cursor-not-allowed border border-white/10 bg-white/5 text-gray-500"
                        : "bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500"
                    }`}
                  >
                    <Video size={14} className={isGeneratingVideo ? "animate-pulse" : ""} />
                    {isGeneratingVideo ? "生视频中..." : "生成视频"}
                  </BillingActionButton>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <section className="space-y-8">
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-400">
                      {activeMode === "static" ? <ImageIcon size={14} /> : <Video size={14} />}
                      <h3 className="text-xs font-bold uppercase tracking-widest">
                        {activeMode === "static" ? "候选图预览" : "视频预览"}
                      </h3>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      {activeMode === "static" ? previewImageVariants.length : motionVideos.length} records
                    </span>
                  </div>

                  {activeMode === "static" ? (
                    <div className={`grid gap-4 ${assetType === "scene" ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-3 xl:grid-cols-4"}`}>
                      {visibleImageVariants.map((variant) => (
                        <div
                          key={variant.id}
                          className={`group relative overflow-hidden rounded-2xl border-2 transition-all ${
                            selectedVariantId === variant.id
                              ? "border-indigo-500 shadow-lg shadow-indigo-500/20 scale-[1.02]"
                              : "border-white/10 hover:border-white/25 hover:bg-white/5"
                          } ${aspectClass}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              void handleSelectVariant(variant.id);
                            }}
                            className="h-full w-full"
                          >
                            <img
                              src={getAssetUrl(variant.url)}
                              alt="候选图"
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          </button>
                          <div className="absolute inset-0 bg-slate-950/10 group-hover:bg-transparent transition-all pointer-events-none" />
                          {variant.id === selectedVariantId && (
                            <div className="absolute right-2 top-2 rounded-full bg-indigo-600 p-1.5 text-white shadow-lg ring-2 ring-white/20">
                              <Check size={12} />
                            </div>
                          )}
                          {onDeleteVariant && (
                            <button
                              type="button"
                              onClick={() => {
                                void onDeleteVariant(variant.id);
                              }}
                              className="absolute left-2 top-2 rounded-full bg-black/60 p-1.5 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 z-10"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      {isGeneratingImage && Array.from({ length: batchSize }).map((_, i) => (
                        <div key={`gen-${i}`} className={`flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] animate-pulse ${aspectClass}`}>
                          <RefreshCw size={24} className="animate-spin text-indigo-500/50" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Generating</p>
                        </div>
                      ))}
                      {!isGeneratingImage && visibleImageVariants.length === 0 && (
                        <div className={`col-span-full flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-white/5 bg-transparent py-20 text-gray-500`}>
                          <Sparkles size={40} strokeWidth={1} className="opacity-20" />
                          <span className="text-xs font-bold uppercase tracking-widest">还没有候选图，请先点击“生成图片”。</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`grid gap-4 ${assetType === "scene" ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-3 xl:grid-cols-4"}`}>
                      {motionVideos.map((video) => (
                        <div key={video.id} className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 ${aspectClass}`}>
                          <video src={getAssetUrl(video.video_url)} className="h-full w-full object-cover" controls />
                        </div>
                      ))}
                      {isGeneratingVideo && (
                        <div className={`flex items-center justify-center rounded-2xl border border-dashed border-white/20 bg-white/[0.02] ${aspectClass}`}>
                          <div className="text-center">
                            <RefreshCw size={18} className="mx-auto animate-spin text-blue-400" />
                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Rendering</p>
                          </div>
                        </div>
                      )}
                      {!isGeneratingVideo && motionVideos.length === 0 && (
                        <div className={`col-span-full flex items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] ${aspectClass}`}>
                          <span className="text-xs text-gray-500">{motionDisabledReason || "还没有视频候选，请点击“生成视频”。"}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Sparkles size={14} />
                      <h3 className="text-xs font-bold uppercase tracking-widest">正向提示词</h3>
                    </div>
                    <textarea
                      value={activeMode === "static" ? positivePrompt : motionPrompt}
                      onChange={(event) => {
                        if (activeMode === "static") {
                          setPositivePrompt(event.target.value);
                          return;
                        }
                        setMotionPrompt(event.target.value);
                      }}
                      className="h-44 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-4 text-sm leading-6 text-gray-200 outline-none transition-all focus:border-indigo-500/50"
                      placeholder={activeMode === "static"
                        ? (assetType === "scene" ? "描述场景构图、镜头语言、氛围光、材质细节..." : "描述道具材质、光泽、纹理、摆放和拍摄角度...")
                        : (assetType === "scene" ? "描述场景动态、环境运动和镜头节奏..." : "描述道具动态、旋转路径和运动节奏...")}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-gray-400">
                      <FileText size={14} />
                      <h3 className="text-xs font-bold uppercase tracking-widest">负向提示词</h3>
                    </div>
                    <textarea
                      value={negativePrompt}
                      onChange={(event) => setNegativePrompt(event.target.value)}
                      className="h-44 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-4 text-sm leading-6 text-gray-300 outline-none transition-all focus:border-indigo-500/50"
                      placeholder="写入你不希望出现的元素，例如畸变、脏污、低清晰度、错误结构..."
                    />
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </motion.div>
    </div>
  );
}
