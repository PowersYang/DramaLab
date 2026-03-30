"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Palette, Plus, Save, Trash2 } from "lucide-react";

import { api } from "@/lib/api";
import type { StyleConfig } from "@/store/projectStore";

function createDraftStyle(): StyleConfig {
  return {
    id: `custom-${Date.now()}`,
    name: "",
    description: "",
    positive_prompt: "",
    negative_prompt: "",
    is_custom: true,
  };
}

function upsertStyle(styles: StyleConfig[], nextStyle: StyleConfig): StyleConfig[] {
  return styles.some((style) => style.id === nextStyle.id)
    ? styles.map((style) => (style.id === nextStyle.id ? nextStyle : style))
    : [nextStyle, ...styles];
}

export default function StudioArtStyleLibraryPage() {
  const [styles, setStyles] = useState<StyleConfig[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [editingStyle, setEditingStyle] = useState<StyleConfig>(createDraftStyle());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStyles = async () => {
      try {
        setIsLoading(true);
        const payload = await api.getUserArtStyles();
        const nextStyles = payload.styles || [];
        setStyles(nextStyles);
        if (nextStyles.length > 0) {
          setSelectedStyleId(nextStyles[0].id);
          setEditingStyle(nextStyles[0]);
        } else {
          setSelectedStyleId(null);
          setEditingStyle(createDraftStyle());
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "风格库加载失败");
      } finally {
        setIsLoading(false);
      }
    };

    void loadStyles();
  }, []);

  const handleSelectStyle = (style: StyleConfig) => {
    setSelectedStyleId(style.id);
    setEditingStyle(style);
    setMessage(null);
    setError(null);
  };

  const handleCreate = () => {
    const draft = createDraftStyle();
    setSelectedStyleId(draft.id);
    setEditingStyle(draft);
    setMessage(null);
    setError(null);
  };

  const handlePersistStyles = async (nextStyles: StyleConfig[], successMessage: string, nextSelectedId?: string | null) => {
    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const payload = await api.saveUserArtStyles(nextStyles);
      const persistedStyles = payload.styles || [];
      setStyles(persistedStyles);
      if (nextSelectedId) {
        const selected = persistedStyles.find((style) => style.id === nextSelectedId) || null;
        setSelectedStyleId(selected?.id || null);
        setEditingStyle(selected || createDraftStyle());
      } else if (persistedStyles.length > 0) {
        setSelectedStyleId(persistedStyles[0].id);
        setEditingStyle(persistedStyles[0]);
      } else {
        setSelectedStyleId(null);
        setEditingStyle(createDraftStyle());
      }
      setMessage(successMessage);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "风格库保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editingStyle.name.trim() || !editingStyle.positive_prompt.trim()) {
      setError("请至少填写风格名称和正向提示词");
      setMessage(null);
      return;
    }

    const styleToSave: StyleConfig = {
      ...editingStyle,
      name: editingStyle.name.trim(),
      description: editingStyle.description?.trim() || "",
      positive_prompt: editingStyle.positive_prompt.trim(),
      negative_prompt: editingStyle.negative_prompt.trim(),
      is_custom: true,
    };
    const nextStyles = upsertStyle(styles, styleToSave);
    await handlePersistStyles(nextStyles, "风格库已更新", styleToSave.id);
  };

  const handleDelete = async () => {
    if (!selectedStyleId) {
      return;
    }
    const nextStyles = styles.filter((style) => style.id !== selectedStyleId);
    await handlePersistStyles(nextStyles, "风格已删除", nextStyles[0]?.id || null);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
      <section className="studio-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Style Library</p>
            <h2 className="mt-3 text-2xl font-bold text-slate-950">自定义美术风格</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">统一沉淀你保存过的视觉风格，在项目美术设定里可直接复用。</p>
          </div>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus size={14} />
            新建风格
          </button>
        </div>

        {isLoading ? (
          <div className="mt-6 flex min-h-[240px] items-center justify-center text-sm text-slate-500">
            <Loader2 size={18} className="mr-2 animate-spin" />
            风格库加载中...
          </div>
        ) : styles.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {styles.map((style) => {
              const isSelected = style.id === selectedStyleId;
              return (
                <button
                  key={style.id}
                  onClick={() => handleSelectStyle(style)}
                  className={`group relative overflow-hidden rounded-[1.4rem] border p-4 text-left transition-all ${
                    isSelected
                      ? "border-slate-950 bg-slate-950 text-white shadow-[0_20px_45px_-30px_rgba(15,23,42,0.8)]"
                      : "border-slate-200 bg-white hover:border-primary/40 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-white bg-white text-slate-950" : "border-slate-300 bg-slate-100 text-transparent"}`}>
                      <Check size={11} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className={`truncate text-sm font-semibold ${isSelected ? "text-white" : "text-slate-950"}`}>{style.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isSelected ? "bg-white/10 text-slate-200" : "bg-emerald-50 text-emerald-700"}`}>自定义</span>
                      </div>
                      <p className={`mt-2 line-clamp-2 text-sm leading-6 ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                        {style.description || "暂无风格描述"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-6 rounded-[1.6rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <Palette className="mx-auto text-slate-400" size={28} />
            <p className="mt-4 text-sm font-semibold text-slate-900">还没有保存过自定义风格</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">创建后会自动出现在项目的美术设定页中，方便重复复用。</p>
          </div>
        )}
      </section>

      <section className="studio-panel p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Editor</p>
        <h2 className="mt-3 text-2xl font-bold text-slate-950">风格编辑器</h2>
        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">风格名称</span>
            <input
              value={editingStyle.name}
              onChange={(event) => setEditingStyle((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：Painterly Suspense"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">风格描述</span>
            <textarea
              value={editingStyle.description || ""}
              onChange={(event) => setEditingStyle((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              placeholder="描述这套风格适合什么题材、情绪和镜头语言"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">正向提示词</span>
            <textarea
              value={editingStyle.positive_prompt}
              onChange={(event) => setEditingStyle((current) => ({ ...current, positive_prompt: event.target.value }))}
              rows={6}
              placeholder="例如：cinematic lighting, painterly texture, moody atmosphere..."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">负向提示词</span>
            <textarea
              value={editingStyle.negative_prompt}
              onChange={(event) => setEditingStyle((current) => ({ ...current, negative_prompt: event.target.value }))}
              rows={4}
              placeholder="例如：low quality, flat lighting, blurry..."
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存风格
          </button>
          <button
            onClick={handleDelete}
            disabled={!selectedStyleId || isSaving || !styles.some((style) => style.id === selectedStyleId)}
            className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
          >
            <Trash2 size={14} />
            删除当前风格
          </button>
        </div>

        {message ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      </section>
    </div>
  );
}
