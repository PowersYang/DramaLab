"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Loader2, Palette, Plus, Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import type { ArtDirection, StyleConfig } from "@/store/projectStore";

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
    ? styles.map((style) => (style.id === targetStyle.id ? targetStyle : style))
    : [...styles, targetStyle];
}

export default function ArtDirectionEditorCard({
  title,
  description,
  initialArtDirection,
  actionLabel,
  onSave,
  onGenerateAiRecommendations,
}: {
  title: string;
  description?: string;
  initialArtDirection?: ArtDirection | null;
  actionLabel: string;
  onSave: (selectedStyleId: string, styleConfig: StyleConfig) => Promise<void>;
  onGenerateAiRecommendations?: () => Promise<StyleConfig[]>;
}) {
  const [selectedStyle, setSelectedStyle] = useState<StyleConfig | null>(null);
  const [userStyles, setUserStyles] = useState<StyleConfig[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<StyleConfig[]>([]);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingPositive, setEditingPositive] = useState("");
  const [editingNegative, setEditingNegative] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStyles = async () => {
      try {
        const userStylePayload = await api.getUserArtStyles();
        setUserStyles(userStylePayload.styles || []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "风格库加载失败");
      }
    };
    void loadStyles();
  }, []);

  useEffect(() => {
    if (initialArtDirection?.style_config) {
      setSelectedStyle(initialArtDirection.style_config);
      setEditingName(initialArtDirection.style_config.name || "");
      setEditingDescription(initialArtDirection.style_config.description || "");
      setEditingPositive(initialArtDirection.style_config.positive_prompt || "");
      setEditingNegative(initialArtDirection.style_config.negative_prompt || "");
      setAiRecommendations(initialArtDirection.ai_recommendations || []);
      return;
    }

    setSelectedStyle(null);
    setEditingName("");
    setEditingDescription("");
    setEditingPositive("");
    setEditingNegative("");
    setAiRecommendations([]);
  }, [initialArtDirection]);

  const customStyles = useMemo(() => userStyles, [userStyles]);

  const handleGenerateAi = async () => {
    if (!onGenerateAiRecommendations || isGeneratingAi) {
      return;
    }
    setIsGeneratingAi(true);
    setError(null);
    setMessage(null);
    try {
      const nextRecommendations = await onGenerateAiRecommendations();
      setAiRecommendations(nextRecommendations || []);
      if (!nextRecommendations || nextRecommendations.length === 0) {
        setMessage("已完成分析，但未生成可用的推荐风格");
        window.setTimeout(() => setMessage(null), 3000);
        return;
      }
      setMessage("AI 推荐已更新");
      window.setTimeout(() => setMessage(null), 3000);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成 AI 推荐失败");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleSelectStyle = (style: StyleConfig) => {
    setSelectedStyle(style);
    setEditingName(style.name || "");
    setEditingDescription(style.description || "");
    setEditingPositive(style.positive_prompt || "");
    setEditingNegative(style.negative_prompt || "");
  };

  const handleCreateCustomStyle = () => {
    const draft = createEmptyCustomStyle();
    setSelectedStyle(draft);
    setEditingName("");
    setEditingDescription("");
    setEditingPositive("");
    setEditingNegative("");
  };

  const handleSaveCustom = async () => {
    if (!editingName.trim() || !editingPositive.trim()) {
      setError("请填写风格名称和正向提示词");
      return;
    }

    const nextCustomId = selectedStyle?.is_custom ? selectedStyle.id : `custom-${Date.now()}`;
    const nextCustomStyle: StyleConfig = {
      id: nextCustomId,
      name: editingName.trim(),
      description: editingDescription.trim(),
      positive_prompt: editingPositive.trim(),
      negative_prompt: editingNegative.trim(),
      is_custom: true,
    };

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const persisted = await api.saveUserArtStyles(upsertStyle(userStyles, nextCustomStyle));
      const nextUserStyles = persisted.styles || [];
      setUserStyles(nextUserStyles);
      const matched = nextUserStyles.find((style) => style.id === nextCustomId) || nextCustomStyle;
      setSelectedStyle(matched);
      setEditingName(matched.name || "");
      setEditingDescription(matched.description || "");
      setEditingPositive(matched.positive_prompt || "");
      setEditingNegative(matched.negative_prompt || "");
      setMessage("自定义风格已保存到风格库");
      window.setTimeout(() => setMessage(null), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "自定义风格保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApply = async () => {
    if (!selectedStyle) {
      setError("请先选择一个风格");
      return;
    }

    const finalConfig: StyleConfig = {
      ...selectedStyle,
      name: editingName.trim(),
      description: editingDescription.trim(),
      positive_prompt: editingPositive.trim(),
      negative_prompt: editingNegative.trim(),
    };

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);

      let finalSelectedStyle = finalConfig;
      if (finalConfig.is_custom) {
        const persisted = await api.saveUserArtStyles(upsertStyle(userStyles, finalConfig));
        const nextUserStyles = persisted.styles || [];
        setUserStyles(nextUserStyles);
        finalSelectedStyle = nextUserStyles.find((style) => style.id === finalConfig.id) || finalConfig;
      }

      await onSave(finalSelectedStyle.id, finalSelectedStyle);
      setSelectedStyle(finalSelectedStyle);
      setMessage("美术设定已保存");
      window.setTimeout(() => setMessage(null), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="art-direction-shell flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
      <div className="art-direction-header border-b border-white/10 px-8 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">{title}</h2>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{description}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!selectedStyle || isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {actionLabel}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="art-direction-list-pane flex w-[46%] flex-col gap-8 overflow-y-auto px-8 py-8">
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-amber-400" />
                <h3 className="text-lg font-bold text-white">AI 智能推荐</h3>
              </div>
              {onGenerateAiRecommendations ? (
                <button
                  type="button"
                  onClick={() => void handleGenerateAi()}
                  disabled={isGeneratingAi}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGeneratingAi ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  生成推荐
                </button>
              ) : null}
            </div>

            {aiRecommendations.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                {aiRecommendations.map((style) => (
                  <StyleChoiceCard
                    key={style.id}
                    style={style}
                    isSelected={selectedStyle?.id === style.id}
                    onSelect={() => handleSelectStyle(style)}
                    accent="amber"
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 px-5 py-6 text-sm text-gray-400">
                暂无 AI 推荐结果。请先生成推荐，或从下方自定义风格开始选择。
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Plus size={18} className="text-emerald-400" />
                <h3 className="text-lg font-bold text-white">自定义风格</h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/studio/styles"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/10"
                >
                  管理风格库
                </Link>
                <button
                  type="button"
                  onClick={handleCreateCustomStyle}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  <Plus size={14} />
                  新建自定义风格
                </button>
              </div>
            </div>

            {customStyles.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                {customStyles.map((style) => (
                  <StyleChoiceCard
                    key={style.id}
                    style={style}
                    isSelected={selectedStyle?.id === style.id}
                    onSelect={() => handleSelectStyle(style)}
                    accent="emerald"
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 px-5 py-6 text-sm text-gray-400">
                还没有自定义风格。你可以先从右侧编辑器创建一套，再保存到风格库。
              </div>
            )}
          </section>
        </div>

        <div className="art-direction-editor-pane flex w-[54%] flex-col overflow-y-auto border-l border-white/10 px-8 py-8">
          <div className="mb-6 flex items-center gap-2">
            <Palette size={18} className="text-cyan-300" />
            <h3 className="text-lg font-bold text-white">风格编辑器</h3>
          </div>

          {!selectedStyle ? (
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-6 text-sm leading-6 text-slate-300">
              先从左侧选择 AI 推荐或自定义风格，再在这里微调名称、描述与提示词。
            </div>
          ) : null}

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
            isSaving={isSaving}
          />

          {message ? <div className="mt-4 text-sm text-emerald-300">{message}</div> : null}
          {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
        </div>
      </div>

      <style jsx>{`
        .art-direction-shell {
          backdrop-filter: blur(24px);
        }

        .art-direction-header {
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 32%),
            radial-gradient(circle at top right, rgba(16, 185, 129, 0.1), transparent 28%);
        }

        .art-direction-list-pane {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
        }

        .art-direction-editor-pane {
          background:
            linear-gradient(180deg, rgba(2, 6, 23, 0.72), rgba(15, 23, 42, 0.9));
        }

        :global([data-studio-theme="light"] .art-direction-shell) {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.96));
          border-color: rgba(148, 163, 184, 0.24);
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.08);
        }

        :global([data-studio-theme="light"] .art-direction-header) {
          background:
            radial-gradient(circle at top left, rgba(49, 95, 145, 0.12), transparent 34%),
            radial-gradient(circle at top right, rgba(16, 185, 129, 0.08), transparent 28%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9));
          border-color: rgba(148, 163, 184, 0.18);
        }

        :global([data-studio-theme="light"] .art-direction-list-pane) {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(248, 250, 252, 0.96));
        }

        :global([data-studio-theme="light"] .art-direction-editor-pane) {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(241, 245, 249, 0.92));
          border-color: rgba(148, 163, 184, 0.16);
        }

        :global([data-studio-theme="light"] .art-direction-shell h2),
        :global([data-studio-theme="light"] .art-direction-shell h3),
        :global([data-studio-theme="light"] .art-direction-shell h4),
        :global([data-studio-theme="light"] .art-direction-shell label) {
          color: rgb(15, 23, 42);
        }

        :global([data-studio-theme="light"] .art-direction-shell .text-gray-200) {
          color: rgb(30, 41, 59);
        }

        :global([data-studio-theme="light"] .art-direction-shell .text-gray-400),
        :global([data-studio-theme="light"] .art-direction-shell .text-slate-300),
        :global([data-studio-theme="light"] .art-direction-shell .text-slate-200) {
          color: rgb(71, 85, 105);
        }

        :global([data-studio-theme="light"] .art-direction-shell .text-gray-500),
        :global([data-studio-theme="light"] .art-direction-shell .text-slate-500) {
          color: rgb(100, 116, 139);
        }

        :global([data-studio-theme="light"] .art-direction-shell .ad-field) {
          background: rgba(255, 255, 255, 0.86);
          border-color: rgba(148, 163, 184, 0.35);
          color: rgb(15, 23, 42);
        }

        :global([data-studio-theme="light"] .art-direction-shell .ad-field::placeholder) {
          color: rgba(100, 116, 139, 0.9);
        }

        :global([data-studio-theme="light"] .art-direction-shell .ad-field-positive) {
          background: rgba(14, 116, 144, 0.06);
          border-color: rgba(6, 182, 212, 0.35);
        }
      `}</style>
    </div>
  );
}

type StyleChoiceCardProps = {
  style: StyleConfig;
  isSelected: boolean;
  onSelect: () => void;
  accent: "amber" | "emerald";
};

function StyleChoiceCard({ style, isSelected, onSelect, accent }: StyleChoiceCardProps) {
  const activeClass = accent === "amber"
    ? "border-amber-300 bg-amber-500/10 shadow-[0_18px_35px_rgba(245,158,11,0.16)]"
    : "border-emerald-300 bg-emerald-500/10 shadow-[0_18px_35px_rgba(16,185,129,0.14)]";

  const dotClass = accent === "amber"
    ? "border-amber-400 bg-amber-500"
    : "border-emerald-400 bg-emerald-500";

  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-[1.3rem] border px-4 py-3 text-left transition-all ${
        isSelected ? activeClass : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? dotClass : "border-slate-300 bg-white"}`}>
          {isSelected ? <Check size={12} className="text-white" /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="truncate text-base font-bold text-white">{style.name || "未命名风格"}</h4>
        </div>
      </div>
    </motion.button>
  );
}

function StyleEditor({
  name,
  description,
  positivePrompt,
  negativePrompt,
  onNameChange,
  onDescriptionChange,
  onPositiveChange,
  onNegativeChange,
  onSaveCustom,
  selectedStyle,
  isSaving,
}: {
  name: string;
  description: string;
  positivePrompt: string;
  negativePrompt: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPositiveChange: (value: string) => void;
  onNegativeChange: (value: string) => void;
  onSaveCustom: () => Promise<void>;
  selectedStyle: StyleConfig | null;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-5">
      <EditorField label="风格名称">
        <input
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如：潮湿都市霓虹 / 颗粒电影感 / 高反差国风"
          className="ad-field w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400"
        />
      </EditorField>

      <EditorField label="风格描述">
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="描述这套风格的整体气质、适用桥段和镜头质感"
          rows={3}
          className="ad-field w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 resize-none"
        />
      </EditorField>

      <EditorField label="正向提示词" hint="这是剧集视觉主档中最关键的风格约束。">
        <textarea
          value={positivePrompt}
          onChange={(event) => onPositiveChange(event.target.value)}
          placeholder="例如：cinematic, controlled rim light, subtle film grain, realistic skin texture..."
          rows={7}
          className="ad-field ad-field-positive w-full rounded-2xl border border-cyan-400/30 bg-cyan-500/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-300 resize-none"
        />
      </EditorField>

      <EditorField label="负向提示词" hint="用于稳定规避画面瑕疵和不希望出现的视觉元素。">
        <textarea
          value={negativePrompt}
          onChange={(event) => onNegativeChange(event.target.value)}
          placeholder="例如：low quality, deformed hands, watermark, oversaturated..."
          rows={5}
          className="ad-field w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-cyan-400 resize-none"
        />
      </EditorField>

      <div className="pt-2">
        <button
          type="button"
          onClick={() => void onSaveCustom()}
          disabled={!name.trim() || !positivePrompt.trim() || isSaving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {selectedStyle?.is_custom ? "更新自定义风格" : "另存为自定义风格"}
        </button>
      </div>
    </div>
  );
}

function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-slate-200">{label}</label>
        {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
