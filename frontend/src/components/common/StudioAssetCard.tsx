"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Image as ImageIcon, RefreshCw, Trash2 } from "lucide-react";

import { getCharacterPreviewImage } from "@/lib/characterAssets";
import { getAssetUrl, getAssetUrlWithTimestamp } from "@/lib/utils";
import type { Character, Prop, Scene } from "@/store/projectStore";

type AssetCardType = "character" | "scene" | "prop" | "characters" | "scenes" | "props";

interface StudioAssetCardProps {
  asset: Character | Scene | Prop;
  type: AssetCardType;
  isGenerating?: boolean;
  generationLabel?: string;
  onClick?: () => void;
  onDelete?: () => void;
}

function ImageWithRetry({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setError(false);
    setRetryCount(0);
  }, [src]);

  useEffect(() => {
    if (error && retryCount < 10) {
      const timer = window.setTimeout(() => {
        setRetryCount((prev) => prev + 1);
        setError(false);
      }, 1000 * (retryCount + 1));
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [error, retryCount]);

  const displaySrc = retryCount > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${retryCount}` : src;

  return (
    <div className={`relative ${className || ""}`}>
      {isLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/5 backdrop-blur-sm">
          <RefreshCw className="animate-spin text-white/50" size={24} />
        </div>
      ) : null}
      <img
        src={displaySrc}
        alt={alt}
        className={`${className || ""} ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity duration-300`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setError(true);
          setIsLoading(true);
        }}
      />
      {error && retryCount >= 10 ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-red-500/10 backdrop-blur-sm">
          <span className="text-xs font-bold text-red-400">加载失败</span>
        </div>
      ) : null}
    </div>
  );
}

function getNormalizedType(type: AssetCardType): "character" | "scene" | "prop" {
  if (type === "characters") return "character";
  if (type === "scenes") return "scene";
  if (type === "props") return "prop";
  return type;
}

export default function StudioAssetCard({
  asset,
  type,
  isGenerating = false,
  generationLabel = "生成中",
  onClick,
  onDelete,
}: StudioAssetCardProps) {
  const normalizedType = getNormalizedType(type);

  const getSelectedVariant = (
    imageAsset?: { selected_id?: string | null; variants?: Array<{ id: string; url: string; created_at?: string | number }> },
  ) => {
    if (!imageAsset?.variants?.length) return null;
    return imageAsset.variants.find((variant) => variant.id === imageAsset.selected_id) || imageAsset.variants[0];
  };

  const resolveAssetPreview = () => {
    if (normalizedType === "character") {
      return getCharacterPreviewImage(asset as Character);
    }

    const selectedVariant = getSelectedVariant((asset as Scene | Prop).image_asset);
    return {
      previewPath: selectedVariant?.url || (asset as Scene | Prop).image_url,
      previewTimestamp: selectedVariant?.created_at,
    };
  };

  const { previewPath, previewTimestamp } = resolveAssetPreview();
  const fullImageUrl = previewPath
    ? previewTimestamp
      ? getAssetUrlWithTimestamp(
          previewPath,
          typeof previewTimestamp === "number" ? previewTimestamp : new Date(previewTimestamp).getTime(),
        )
      : getAssetUrl(previewPath)
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="group relative flex h-full cursor-pointer flex-col rounded-none border border-white/10 bg-white/5 transition-all duration-300 hover:border-indigo-500/50 hover:bg-white/[0.08] hover:shadow-2xl hover:shadow-indigo-500/10"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-none">
        {fullImageUrl ? (
          <ImageWithRetry
            src={fullImageUrl}
            alt={asset.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-black/40">
            <ImageIcon className="text-white/10" size={48} strokeWidth={1} />
          </div>
        )}

        {onDelete ? (
          <div className="absolute right-3 top-3 z-20">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-none border border-[color:color-mix(in_srgb,var(--video-workspace-border)_88%,transparent)] bg-[color:color-mix(in_srgb,var(--video-workspace-panel-strong)_88%,transparent)] text-[color:var(--studio-text-soft)] shadow-lg shadow-black/20 backdrop-blur-md transition-all hover:border-[color:color-mix(in_srgb,#b43838_40%,var(--video-workspace-border))] hover:bg-[color:color-mix(in_srgb,#b43838_16%,var(--video-workspace-panel-strong))] hover:text-[#b43838] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,#b43838_38%,transparent)]"
              title="删除"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ) : null}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-40" />

        {isGenerating ? (
          // 中文注释：生成态遮罩仅覆盖图片区域，避免资产名称和描述被遮挡，方便快速识别并点击目标资产。
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
            <div className="relative">
              <RefreshCw className="animate-spin text-indigo-400" size={32} />
              <div className="absolute inset-0 animate-pulse rounded-full bg-indigo-500/20 blur-xl" />
            </div>
            <span className="rounded-none border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-[11px] font-semibold text-indigo-100">
              {generationLabel}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-3 pt-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-[13px] font-bold text-white transition-colors group-hover:text-indigo-400">
              {asset.name}
            </h3>
          </div>
          <p className="line-clamp-2 min-h-[36px] text-[11px] leading-relaxed text-gray-400">
            {asset.description || "暂未填写描述"}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
