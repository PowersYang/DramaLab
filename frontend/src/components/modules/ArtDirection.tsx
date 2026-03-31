"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, SwatchBook, Check, Loader2, Plus } from "lucide-react";
import { useProjectStore, type StyleConfig, type StylePreset } from "@/store/projectStore";
import { api } from "@/lib/api";
import { PANEL_HEADER_CLASS, PANEL_META_TEXT_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

// 统一把系统预设映射成编辑器和卡片可复用的风格结构，避免前后端字段漂移后在页面里到处兼容。
function presetToStyleConfig(style: StylePreset): StyleConfig {
    return {
        id: style.id,
        name: style.name,
        description: style.description || "",
        positive_prompt: style.positive_prompt,
        negative_prompt: style.negative_prompt || "",
        thumbnail_url: style.thumbnail_url,
        is_custom: false,
    };
}

// 新建自定义风格时先生成一份可编辑草稿，用户保存后再持久化到项目的 art_direction.custom_styles。
function createEmptyCustomStyle(): StyleConfig {
    return {
        id: `custom-${Date.now()}`,
        name: "",
        description: "",
        positive_prompt: "",
        negative_prompt: "",
        is_custom: true,
    };
}

function upsertStyle(styles: StyleConfig[], targetStyle: StyleConfig): StyleConfig[] {
    return styles.some((style) => style.id === targetStyle.id)
        ? styles.map((style) => style.id === targetStyle.id ? targetStyle : style)
        : [...styles, targetStyle];
}

function mergeStyles(primaryStyles: StyleConfig[], secondaryStyles: StyleConfig[]): StyleConfig[] {
    const merged: StyleConfig[] = [];
    const seen = new Set<string>();

    [...primaryStyles, ...secondaryStyles].forEach((style) => {
        if (!style?.id || seen.has(style.id)) {
            return;
        }
        seen.add(style.id);
        merged.push(style);
    });

    return merged;
}

export default function ArtDirection() {
    const {
        currentProject,
        updateProject,
    } = useProjectStore();

    const [selectedStyle, setSelectedStyle] = useState<StyleConfig | null>(null);
    const [userStyles, setUserStyles] = useState<StyleConfig[]>([]);
    const [aiRecommendations, setAiRecommendations] = useState<StyleConfig[]>([]);
    const [presets, setPresets] = useState<StylePreset[]>([]);

    // Editor state
    const [editingName, setEditingName] = useState("");
    const [editingDescription, setEditingDescription] = useState("");
    const [editingPositive, setEditingPositive] = useState("");
    const [editingNegative, setEditingNegative] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const customStyles = mergeStyles(userStyles, currentProject?.art_direction?.custom_styles || []);

    // Load presets and user style library once on mount.
    useEffect(() => {
        loadPresets();
        loadUserStyles();
    }, []);

    // Load art direction from project when it changes
    useEffect(() => {
        // Load existing art direction if available
        if (currentProject?.art_direction) {
            if (currentProject.art_direction.style_config) {
                setSelectedStyle(currentProject.art_direction.style_config);
                setEditingName(currentProject.art_direction.style_config.name || "");
                setEditingDescription(currentProject.art_direction.style_config.description || "");
                setEditingPositive(currentProject.art_direction.style_config.positive_prompt || "");
                setEditingNegative(currentProject.art_direction.style_config.negative_prompt || "");
            }

            // Load recommendations from project if available
            setAiRecommendations(currentProject.art_direction.ai_recommendations || []);
        } else {
            setSelectedStyle(null);
            setEditingName("");
            setEditingDescription("");
            setEditingPositive("");
            setEditingNegative("");
            setAiRecommendations([]);
        }
    }, [currentProject?.id, currentProject?.art_direction]);

    // Sync local aiRecommendations with store when it updates (e.g. after analysis finishes)
    useEffect(() => {
        setAiRecommendations(currentProject?.art_direction?.ai_recommendations || []);
    }, [currentProject?.art_direction?.ai_recommendations]);

    const loadPresets = async () => {
        try {
            const data = await api.getStylePresets();
            setPresets(data.presets || []);
        } catch (error) {
            console.error("Failed to load presets:", error);
        }
    };

    const loadUserStyles = async () => {
        try {
            const data = await api.getUserArtStyles();
            setUserStyles(data.styles || []);
        } catch (error) {
            console.error("Failed to load user art styles:", error);
        }
    };

    const handleSelectStyle = (style: StyleConfig) => {
        setSelectedStyle(style);
        setEditingName(style.name);
        setEditingDescription(style.description || "");
        setEditingPositive(style.positive_prompt);
        setEditingNegative(style.negative_prompt);
    };

    const handleCreateCustomStyle = () => {
        const draftStyle = createEmptyCustomStyle();
        setSelectedStyle(draftStyle);
        setEditingName("");
        setEditingDescription("");
        setEditingPositive("");
        setEditingNegative("");
    };

    const handleSaveCustom = async () => {
        if (!editingName || !editingPositive) {
            alert("请填写风格名称和正向提示词");
            return;
        }

        const targetCustomId = selectedStyle?.is_custom ? selectedStyle.id : `custom-${Date.now()}`;
        const newCustomStyle: StyleConfig = {
            id: targetCustomId,
            name: editingName,
            description: editingDescription,
            positive_prompt: editingPositive,
            negative_prompt: editingNegative,
            is_custom: true
        };

        const nextUserStyles = upsertStyle(userStyles, newCustomStyle);
        const updatedCustomStyles = mergeStyles(nextUserStyles, currentProject?.art_direction?.custom_styles || []);

        setUserStyles(nextUserStyles);
        setSelectedStyle(newCustomStyle);

        // 新建/编辑自定义风格都立即持久化，避免刷新后丢失。
        try {
            await api.saveUserArtStyles(nextUserStyles);
            if (currentProject) {
                const updated = await api.saveArtDirection(
                    currentProject.id,
                    newCustomStyle.id,
                    newCustomStyle,
                    updatedCustomStyles,
                    aiRecommendations
                );
                updateProject(currentProject.id, updated);
            }
            alert("自定义风格已保存！");
        } catch (error) {
            console.error("Failed to save custom style:", error);
            alert("保存失败，请重试");
        }
    };

    const handleApply = async () => {
        if (!currentProject || !selectedStyle) {
            alert("请先选择一个风格");
            return;
        }

        // 右侧编辑器允许对当前选中风格做微调；若是自定义风格，需要同步更新 custom_styles 列表。
        const finalConfig: StyleConfig = {
            ...selectedStyle,
            name: editingName,
            description: editingDescription,
            positive_prompt: editingPositive,
            negative_prompt: editingNegative,
        };

        const nextUserStyles = finalConfig.is_custom ? upsertStyle(userStyles, finalConfig) : userStyles;
        const nextCustomStyles = mergeStyles(nextUserStyles, currentProject.art_direction?.custom_styles || []);

        setIsSaving(true);
        try {
            if (finalConfig.is_custom) {
                await api.saveUserArtStyles(nextUserStyles);
                setUserStyles(nextUserStyles);
            }
            const updated = await api.saveArtDirection(
                currentProject.id,
                finalConfig.id,
                finalConfig,
                nextCustomStyles,
                aiRecommendations
            );
            setSelectedStyle(finalConfig);
            updateProject(currentProject.id, updated);
            alert("风格配置已应用！");
        } catch (error) {
            console.error("Failed to save art direction:", error);
            alert("保存失败");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className={PANEL_HEADER_CLASS}>
                <div className="flex items-center gap-4">
                    <h2 className={PANEL_TITLE_CLASS}>
                        <SwatchBook className="text-primary" size={16} />
                        艺术指导
                        <span className={`${PANEL_META_TEXT_CLASS} font-normal`}>风格定调 - 建立全局视觉标准</span>
                    </h2>
                </div>

                <button
                    onClick={handleApply}
                    disabled={!selectedStyle || isSaving}
                    className="px-5 py-2 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 bg-white/10 text-white hover:bg-white/15"
                >
                    {isSaving ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            保存中...
                        </>
                    ) : (
                        <>应用并继续</>
                    )}
                </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel: AI + Presets */}
                <div className="w-2/3 flex flex-col p-8 overflow-y-auto gap-8 border-r border-white/10">
                    {/* Built-in Presets */}
                    <div>
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <SwatchBook size={20} className="text-slate-300" />
                            系统内置风格
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {presets.map((style) => (
                                <StyleChoiceCard
                                    key={style.id}
                                    style={presetToStyleConfig(style)}
                                    isSelected={selectedStyle?.id === style.id}
                                    onSelect={() => handleSelectStyle(presetToStyleConfig(style))}
                                    accent="blue"
                                />
                            ))}
                        </div>
                    </div>

                    {/* AI Recommendations */}
                    <div>
                        <div className="mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Sparkles size={20} className="text-yellow-400" />
                                AI 智能推荐
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {aiRecommendations.map((style) => (
                                <StyleChoiceCard
                                    key={style.id}
                                    style={style}
                                    isSelected={selectedStyle?.id === style.id}
                                    onSelect={() => handleSelectStyle(style)}
                                    accent="purple"
                                    badgeLabel="AI 推荐"
                                    footer={style.reason ? (
                                        <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 mt-2.5">
                                            <p className="text-xs text-gray-300 leading-relaxed">
                                                <span className="font-bold">推荐理由：</span>
                                                {style.reason}
                                            </p>
                                        </div>
                                    ) : null}
                                    leadingIcon={<Sparkles size={14} className="text-yellow-300" />}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Custom Styles */}
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Plus size={20} className="text-green-400" />
                                自定义风格
                            </h3>
                            <div className="flex items-center gap-2">
                                <Link
                                    href="/studio/styles"
                                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 text-sm rounded-lg font-medium transition-all"
                                >
                                    管理风格库
                                </Link>
                                <button
                                    onClick={handleCreateCustomStyle}
                                    className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 text-white text-sm rounded-lg font-medium transition-all flex items-center gap-2"
                                >
                                    <Plus size={14} />
                                    添加自定义风格
                                </button>
                            </div>
                        </div>

                        {customStyles.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {customStyles.map((style) => (
                                    <StyleChoiceCard
                                        key={style.id}
                                        style={style}
                                        isSelected={selectedStyle?.id === style.id}
                                        onSelect={() => handleSelectStyle(style)}
                                        accent="emerald"
                                        badgeLabel="自定义"
                                        leadingIcon={<Plus size={14} className="text-emerald-200" />}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-sm text-gray-400">
                                还没有自定义风格。点击右上角按钮即可新建，并会随项目一起持久化保存。
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Editor */}
                <div className="w-1/3 flex flex-col p-8 overflow-y-auto bg-black/10">
                    <StyleEditor
                        name={editingName}
                        description={editingDescription}
                        positivePrompt={editingPositive}
                        negativePrompt={editingNegative}
                        onNameChange={setEditingName}
                        onDescriptionChange={setEditingDescription}
                        onPositiveChange={setEditingPositive}
                        onNegativeChange={setEditingNegative}
                        onSaveCustom={handleSaveCustom}
                        selectedStyle={selectedStyle}
                    />
                </div>
            </div>
        </div>
    );
}

type StyleChoiceCardProps = {
    style: StyleConfig;
    isSelected: boolean;
    onSelect: () => void;
    accent: "blue" | "purple" | "emerald";
    badgeLabel?: string;
    leadingIcon?: ReactNode;
    footer?: ReactNode;
};

function StyleChoiceCard({ style, isSelected, onSelect, accent, badgeLabel, leadingIcon, footer }: StyleChoiceCardProps) {
    const selectedAccentClass = {
        blue: "bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20",
        purple: "bg-purple-500/20 border-purple-500 shadow-lg shadow-purple-500/20",
        emerald: "bg-emerald-500/20 border-emerald-500 shadow-lg shadow-emerald-500/20",
    }[accent];

    const selectedCircleClass = {
        blue: "border-blue-300 bg-blue-500",
        purple: "border-purple-300 bg-purple-500",
        emerald: "border-emerald-300 bg-emerald-500",
    }[accent];

    const accentGlowClass = {
        blue: "from-blue-400/20 via-blue-400/5 to-transparent",
        purple: "from-purple-400/20 via-purple-400/5 to-transparent",
        emerald: "from-emerald-400/20 via-emerald-400/5 to-transparent",
    }[accent];

    return (
        <motion.div
            layout
            onClick={onSelect}
            className={`group relative overflow-hidden min-h-[118px] p-4 rounded-2xl border-2 cursor-pointer transition-all ${isSelected
                ? selectedAccentClass
                : "bg-white/[0.04] border-white/10 hover:border-white/25 hover:bg-white/[0.07]"
                }`}
        >
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b ${accentGlowClass} ${isSelected ? "opacity-100" : "opacity-70"}`} />
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? selectedCircleClass : "border-slate-500/80 bg-slate-200/70 dark:border-slate-300/80 dark:bg-slate-700/30"}`}>
                    {isSelected ? <Check size={12} className="text-white" /> : null}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                        <h4 className="font-bold text-white text-base truncate">{style.name}</h4>
                        {badgeLabel ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                                {leadingIcon}
                                {badgeLabel}
                            </span>
                        ) : null}
                    </div>

                    <p className="text-sm text-gray-400 leading-relaxed line-clamp-2">
                        {style.description || "暂无风格描述"}
                    </p>

                    {footer}
                </div>
            </div>
        </motion.div>
    );
}

function StyleEditor({ name, description, positivePrompt, negativePrompt, onNameChange, onDescriptionChange, onPositiveChange, onNegativeChange, onSaveCustom, selectedStyle }: any) {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-bold text-white mb-4">风格编辑器</h3>
                {!selectedStyle && (
                    <div className="text-sm text-gray-500 italic mb-4">
                        请先从左侧选择一个风格
                    </div>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    风格名称
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="例如: Cyberpunk Neon"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    艺术风格描述
                </label>
                <textarea
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    placeholder="填写这套风格的整体视觉气质、适用题材或镜头感觉"
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none resize-none"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    正向提示词 (Positive Prompt)
                </label>
                <textarea
                    value={positivePrompt}
                    onChange={(e) => onPositiveChange(e.target.value)}
                    placeholder="例如: cinematic, 8k, volumetric lighting..."
                    rows={6}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                    将自动应用到所有资产和分镜生成
                </p>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                    负向提示词 (Negative Prompt)
                </label>
                <textarea
                    value={negativePrompt}
                    onChange={(e) => onNegativeChange(e.target.value)}
                    placeholder="例如: low quality, blurry, cartoon..."
                    rows={4}
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                    避免的视觉元素
                </p>
            </div>

            <div className="pt-4 border-t border-white/10">
                <button
                    onClick={onSaveCustom}
                    disabled={!name || !positivePrompt}
                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-white/10 text-white text-sm font-semibold transition-all hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {selectedStyle?.is_custom ? "保存自定义风格" : "另存为自定义风格"}
                </button>
            </div>
        </div>
    );
}
