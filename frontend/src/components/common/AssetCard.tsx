"use client";

import { Image as ImageIcon } from "lucide-react";
import type { Character, Scene, Prop } from "@/store/projectStore";
import { getCharacterPreviewImage } from "@/lib/characterAssets";

type AssetTab = "characters" | "scenes" | "props";

interface AssetCardProps {
  asset: Character | Scene | Prop;
  type: AssetTab;
}

function getImageUrl(asset: Character | Scene | Prop, type: AssetTab): string | undefined {
  if (type === "characters") {
    return getCharacterPreviewImage(asset as Character).previewPath;
  }
  if (type === "scenes") {
    const scene = asset as Scene;
    if (scene.image_asset?.variants?.length) {
      const selected = scene.image_asset.variants.find(
        (v) => v.id === scene.image_asset?.selected_id
      );
      return selected?.url || scene.image_asset.variants[0]?.url;
    }
    return scene.image_url;
  }
  const prop = asset as Prop;
  if (prop.image_asset?.variants?.length) {
    const selected = prop.image_asset.variants.find(
      (v) => v.id === prop.image_asset?.selected_id
    );
    return selected?.url || prop.image_asset.variants[0]?.url;
  }
  return prop.image_url;
}

export default function AssetCard({ asset, type }: AssetCardProps) {
  const imageUrl = getImageUrl(asset, type);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-500/10">
      {/* ── 图片容器 ── */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-50">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={asset.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageIcon size={40} strokeWidth={1.5} />
          </div>
        )}
        
        {/* ── 悬停渐变蒙层 ── */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>

      {/* ── 内容区域 ── */}
      <div className="flex flex-1 flex-col p-3.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="truncate text-[13px] font-bold text-slate-800 transition-colors group-hover:text-indigo-600">
            {asset.name}
          </h4>
        </div>
        
        {asset.description ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
            {asset.description}
          </p>
        ) : (
          <p className="text-[11px] italic text-slate-300">暂无描述</p>
        )}
      </div>

      {/* ── 快速操作按钮 (仅在悬停时显示) ── */}
      <div className="absolute right-2 top-2 translate-y-1 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-slate-600 shadow-sm backdrop-blur-sm hover:bg-indigo-500 hover:text-white transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  );
}
