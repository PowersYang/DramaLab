import React, { useState, useEffect, useRef } from 'react';
import { ImageAsset } from '@/store/projectStore';
import { Trash2, Check, Layers, X, Maximize2, Star, Sparkles, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAssetUrl } from '@/lib/utils';

interface VariantSelectorProps {
    asset: ImageAsset | undefined;
    currentImageUrl?: string; // Fallback/Legacy URL
    onSelect: (variantId: string) => void;
    onDelete: (variantId: string) => void;
    onFavorite?: (variantId: string, isFavorited: boolean) => void;
    onGenerate: (batchSize: number) => void;
    isGenerating: boolean;
    generatingBatchSize?: number; // Persisted batch size from parent/store
    className?: string;
    aspectRatio?: string; // e.g., "9:16", "16:9", "1:1"
    showGenerateControls?: boolean;
    showMainViewer?: boolean;
    showFilmstripArrows?: boolean;
    disableGenerate?: boolean;
    generateDisabledReason?: string;
    generateHint?: React.ReactNode;
}

export const VariantSelector: React.FC<VariantSelectorProps> = ({
    asset,
    currentImageUrl,
    onSelect,
    onDelete,
    onFavorite,
    onGenerate,
    isGenerating,
    generatingBatchSize: propGeneratingBatchSize,
    className = "",
    aspectRatio = "9:16",
    showGenerateControls = true,
    showMainViewer = true,
    showFilmstripArrows = true,
    disableGenerate = false,
    generateDisabledReason,
    generateHint
}) => {
    const [batchSize, setBatchSize] = useState(1);
    const [localGeneratingBatchSize, setLocalGeneratingBatchSize] = useState(1); // Track the batch size when generation started locally
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
    const filmstripRef = useRef<HTMLDivElement | null>(null);
    const prevIsGenerating = useRef(isGenerating);

    // Automatically save batchSize when generation starts
    useEffect(() => {
        // Detect when isGenerating changes from false to true (generation just started)
        if (isGenerating && !prevIsGenerating.current) {
            setLocalGeneratingBatchSize(batchSize);
        }
        prevIsGenerating.current = isGenerating;
    }, [isGenerating, batchSize]);

    // Use prop if provided (for persistence), otherwise use local state
    const displayGeneratingBatchSize = propGeneratingBatchSize || localGeneratingBatchSize;

    const variants = asset?.variants || [];
    const selectedVariant = variants.find((variant) => variant.id === asset?.selected_id) || null;
    const activeVariant = variants.find((variant) => variant.id === activeVariantId) || selectedVariant || variants[0] || null;
    const displayUrl = activeVariant ? getAssetUrl(activeVariant.url) : getAssetUrl(currentImageUrl);

    useEffect(() => {
        if (!variants.length) {
            setActiveVariantId(null);
            return;
        }
        if (asset?.selected_id && variants.some((variant) => variant.id === asset.selected_id)) {
            setActiveVariantId(asset.selected_id);
            return;
        }
        if (activeVariantId && variants.some((variant) => variant.id === activeVariantId)) {
            return;
        }
        setActiveVariantId(variants[0].id);
    }, [asset?.selected_id, activeVariantId, variants]);

    // Helper to calculate aspect ratio class
    const getAspectRatioClass = () => {
        switch (aspectRatio) {
            case "16:9": return "aspect-video";
            case "1:1": return "aspect-square";
            case "9:16": return "aspect-[9/16]";
            default: return "aspect-[9/16]";
        }
    };

    const scrollFilmstrip = (direction: "left" | "right") => {
        if (!filmstripRef.current) return;
        const amount = direction === "left" ? -220 : 220;
        filmstripRef.current.scrollBy({ left: amount, behavior: "smooth" });
    };

    const handleSelectVariant = (variantId: string) => {
        setActiveVariantId(variantId);
        onSelect(variantId);
    };

    const displayVariants = showMainViewer ? variants : variants.slice(0, 4);

    return (
        <div className={`variant-selector flex flex-col gap-4 ${className}`}>
            {showMainViewer && (
                <div
                    className={`variant-selector-viewer relative w-full ${getAspectRatioClass()} rounded-2xl overflow-hidden bg-gradient-to-br from-black/40 to-black/70 group cursor-pointer`}
                    onClick={() => displayUrl && setZoomedImage(displayUrl)}
                >
                    {displayUrl ? (
                        <>
                            <img src={displayUrl} alt="Selected Variant" className="w-full h-full object-contain" />
                            <div className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="variant-selector-hint flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-white/10 bg-black/50 backdrop-blur-sm">
                                    <Maximize2 size={12} className="text-gray-300" />
                                    <span className="text-xs text-gray-300">点击放大查看</span>
                                </div>
                            </div>
                            <div className="absolute left-3 top-3">
                                <div className="flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300 backdrop-blur-sm">
                                    <Sparkles size={11} />
                                    当前展示版本
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                            <Wand2 size={28} className="opacity-50" />
                            <span className="text-sm">还没有生成图片</span>
                        </div>
                    )}

                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                        {selectedVariant && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDelete(selectedVariant.id); }}
                                className="p-2 bg-red-500/80 hover:bg-red-600 text-white rounded-full backdrop-blur-sm"
                                title="删除当前版本"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>

                    {isGenerating && (
                        <div className="variant-selector-loading absolute inset-0 flex items-center justify-center z-10 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <div className="variant-selector-spinner animate-spin rounded-full h-10 w-10 border-b-2"></div>
                                <span className="text-white font-medium">正在生成 {displayGeneratingBatchSize} 个候选版本...</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-3">
                {showGenerateControls && (
                    <div className="rounded-2xl bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="variant-selector-batch flex items-center gap-2 rounded-xl p-1 bg-black/20">
                            {[1, 2, 3, 4].map(size => (
                                <button
                                    key={size}
                                    onClick={() => setBatchSize(size)}
                                    className={`variant-selector-batch-button px-3 py-1 text-xs font-medium rounded-md transition-colors ${batchSize === size
                                        ? 'bg-blue-600 text-white'
                                        : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    x{size}
                                </button>
                            ))}
                            </div>

                            <button
                                onClick={() => onGenerate(batchSize)}
                                disabled={isGenerating || disableGenerate}
                                className={`variant-selector-generate flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${isGenerating || disableGenerate
                                    ? 'bg-white/5 text-gray-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20'
                                    }`}
                                title={disableGenerate ? generateDisabledReason : undefined}
                            >
                                <Layers size={16} />
                                生成候选
                            </button>
                        </div>
                        {generateHint ? <div className="mt-3">{generateHint}</div> : null}
                    </div>
                )}

                {showMainViewer && variants.length > 0 && (
                    <div className="p-0">
                        {showFilmstripArrows && (
                            <div className="mb-3 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => scrollFilmstrip("left")}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
                                    aria-label="向左切换候选图"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => scrollFilmstrip("right")}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 transition hover:bg-white/10 hover:text-white"
                                    aria-label="向右切换候选图"
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        )}
                        <div
                            ref={filmstripRef}
                            className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent snap-x"
                        >
                            {variants.map((variant) => {
                                const isSelected = variant.id === asset?.selected_id;
                                const isFavorited = (variant as any).is_favorited || false;
                                const url = getAssetUrl(variant.url);

                                return (
                                    <div
                                        key={variant.id}
                                        className={`
                                            relative flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border-2 transition-all snap-start group/variant bg-black/30
                                            ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/30 scale-[1.02]' : isFavorited ? 'border-yellow-500/50' : 'border-transparent hover:border-gray-500'}
                                        `}
                                    >
                                        <img
                                            src={url}
                                            alt="Variant"
                                            loading="lazy"
                                            className="w-full h-full object-cover cursor-pointer"
                                            onClick={() => handleSelectVariant(variant.id)}
                                        />

                                        {/* Selected indicator */}
                                        {isSelected && (
                                            <div className="absolute top-1 left-1 bg-blue-500 rounded-full p-0.5">
                                                <Check size={10} className="text-white" />
                                            </div>
                                        )}

                                        {/* Favorite button */}
                                        {onFavorite && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onFavorite(variant.id, !isFavorited);
                                                }}
                                                className={`absolute top-1 right-1 p-1 rounded-full transition-all ${isFavorited
                                                    ? 'bg-yellow-500 text-white'
                                                    : 'variant-selector-favorite text-gray-300 opacity-0 group-hover/variant:opacity-100 hover:bg-yellow-500 hover:text-white'
                                                    }`}
                                                title={isFavorited ? '取消收藏' : '收藏该版本'}
                                            >
                                                <Star size={12} fill={isFavorited ? 'currentColor' : 'none'} />
                                            </button>
                                        )}

                                        {!isFavorited && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm('确认删除这个候选版本吗？')) {
                                                        onDelete(variant.id);
                                                    }
                                                }}
                                                className="absolute bottom-1 right-1 p-1 bg-red-500/80 hover:bg-red-500 rounded-full text-white opacity-0 group-hover/variant:opacity-100 transition-all"
                                                title="删除版本"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        )}

                                        {isFavorited && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-yellow-900/80 to-transparent py-1 px-1">
                                                <span className="text-[8px] text-yellow-200 font-medium">已收藏</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {!showMainViewer && variants.length > 0 && (
                <div className="relative min-h-0 flex-1">
                    <div className={`grid h-full min-h-0 gap-3 ${displayVariants.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'}`}>
                        {displayVariants.map((variant) => {
                            const isSelected = variant.id === asset?.selected_id;
                            const isFavorited = (variant as any).is_favorited || false;
                            const imageUrl = getAssetUrl(variant.url);
                            return (
                                <div
                                    key={variant.id}
                                    className={`group relative min-h-0 overflow-hidden rounded-2xl border transition-all ${isSelected
                                        ? 'border-blue-500 ring-2 ring-blue-500/30'
                                        : isFavorited
                                            ? 'border-yellow-500/50'
                                            : 'border-white/10 hover:border-white/25'
                                        }`}
                                >
                                    <img
                                        src={imageUrl}
                                        alt="候选图"
                                        className="h-full w-full cursor-pointer object-contain bg-black/20"
                                        onClick={() => handleSelectVariant(variant.id)}
                                    />

                                    <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
                                        <div className="flex items-center gap-2 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-sm">
                                            <Sparkles size={11} />
                                            候选图
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {onFavorite && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onFavorite(variant.id, !isFavorited);
                                                    }}
                                                    className={`rounded-full p-1.5 backdrop-blur-sm transition ${isFavorited
                                                        ? 'bg-yellow-500 text-white'
                                                        : 'bg-black/45 text-white/80 hover:bg-yellow-500 hover:text-white'
                                                        }`}
                                                    title={isFavorited ? '取消收藏' : '收藏该版本'}
                                                >
                                                    <Star size={13} fill={isFavorited ? 'currentColor' : 'none'} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setZoomedImage(imageUrl);
                                                }}
                                                className="rounded-full bg-black/45 p-1.5 text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white"
                                                title="放大查看"
                                            >
                                                <Maximize2 size={13} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
                                        {isSelected && (
                                            <div className="rounded-full bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white">
                                                当前选中
                                            </div>
                                        )}
                                        {!isSelected && <div />}
                                        {!isFavorited && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm('确认删除这个候选版本吗？')) {
                                                        onDelete(variant.id);
                                                    }
                                                }}
                                                className="rounded-full bg-red-500/80 p-1.5 text-white backdrop-blur-sm transition hover:bg-red-500"
                                                title="删除版本"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {isGenerating && (
                        <div className="variant-selector-loading absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-3">
                                <div className="variant-selector-spinner animate-spin rounded-full h-10 w-10 border-b-2"></div>
                                <span className="text-white font-medium">正在生成 {displayGeneratingBatchSize} 个候选版本...</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Lightbox Modal */}
            {zoomedImage && (
                <div
                    className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-8"
                    onClick={() => setZoomedImage(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                        onClick={() => setZoomedImage(null)}
                    >
                        <X size={24} />
                    </button>
                    <img
                        src={zoomedImage}
                        alt="Zoomed View"
                        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};
