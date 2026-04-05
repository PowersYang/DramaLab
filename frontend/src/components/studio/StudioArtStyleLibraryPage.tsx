"use client";

import { useEffect, useMemo, useState } from "react";
import { 
  Check, 
  Loader2, 
  Palette, 
  Plus, 
  Pencil,
  Save, 
  Search, 
  Trash2,
  X,
  AlertCircle
} from "lucide-react";

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

function StyleEditorModal({
  open,
  mode,
  draft,
  isSaving,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: StyleConfig;
  isSaving: boolean;
  error: string | null;
  onChange: (next: StyleConfig) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  const title = mode === "create" ? "新建美术风格" : "编辑美术风格";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl rounded-[1.75rem] bg-white shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 bg-slate-50/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Palette size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">{title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">风格名称、描述与提示词会同步到风格库台账</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-900 transition-all disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <section className="lg:col-span-5 flex">
              <div className="studio-panel p-4 flex flex-col w-full">
                <div className="text-[11px] font-extrabold tracking-widest text-slate-400 mb-3">基本信息</div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">风格名称</label>
                <input
                  value={draft.name}
                  onChange={(e) => onChange({ ...draft, name: e.target.value })}
                  placeholder="例如：浮世绘 / 赛博朋克 / 国风水墨"
                  className="studio-input h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                />

                <label className="block text-xs font-bold text-slate-600 mt-4 mb-1.5">风格描述</label>
                <textarea
                  value={draft.description || ""}
                  onChange={(e) => onChange({ ...draft, description: e.target.value })}
                  rows={4}
                  placeholder="写清视觉特征、适用场景、构图和光影偏好等"
                  className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm leading-relaxed resize-none"
                />
              </div>
            </section>

            <section className="lg:col-span-7 flex">
              <div className="studio-panel p-4 flex flex-col w-full">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-extrabold tracking-widest text-slate-400">提示词</div>
                  <div className="text-[11px] font-bold text-slate-400 tracking-widest">提示词实验室</div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-600">正向提示词</label>
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full tracking-wider">
                      必填
                    </span>
                  </div>
                  <textarea
                    value={draft.positive_prompt}
                    onChange={(e) => onChange({ ...draft, positive_prompt: e.target.value })}
                    rows={7}
                    placeholder="例如：电影感光影、强细节、清晰线条、统一风格词…"
                    className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all text-sm leading-relaxed"
                  />
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-600">负向提示词</label>
                    <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full tracking-wider">可选</span>
                  </div>
                  <textarea
                    value={draft.negative_prompt}
                    onChange={(e) => onChange({ ...draft, negative_prompt: e.target.value })}
                    rows={5}
                    placeholder="例如：低质量、模糊、水印、文字、畸形手…"
                    className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm leading-relaxed"
                  />
                </div>
              </div>
            </section>
          </div>

          {error && (
            <div className="mt-5 flex items-center gap-2 p-3 bg-red-50 text-red-700 border border-red-100 rounded-lg animate-in slide-in-from-top-2 duration-200">
              <AlertCircle size={16} strokeWidth={3} />
              <p className="text-xs font-bold uppercase tracking-tight">{error}</p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-4 bg-white flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="studio-button studio-button-ghost h-11 px-5 border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={isSaving}
            className="studio-button studio-button-primary h-11 px-5 font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-transform disabled:opacity-60"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            <span>保存</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudioArtStyleLibraryPage() {
  const [styles, setStyles] = useState<StyleConfig[]>([]);
  const [keyword, setKeyword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalDraft, setModalDraft] = useState<StyleConfig>(createDraftStyle());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StyleConfig | null>(null);

  useEffect(() => {
    const loadStyles = async () => {
      try {
        setIsLoading(true);
        const payload = await api.getUserArtStyles();
        const nextStyles = payload.styles || [];
        setStyles(nextStyles);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "风格库加载失败");
      } finally {
        setIsLoading(false);
      }
    };

    void loadStyles();
  }, []);

  const filteredStyles = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return styles;
    return styles.filter((style) =>
      [style.name, style.description || "", style.positive_prompt, style.negative_prompt]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword),
    );
  }, [keyword, styles]);

  const handlePersistStyles = async (nextStyles: StyleConfig[], successMessage: string): Promise<boolean> => {
    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);
      const payload = await api.saveUserArtStyles(nextStyles);
      const persistedStyles = payload.styles || [];
      setStyles(persistedStyles);
      setMessage(successMessage);
      setTimeout(() => setMessage(null), 3000);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "风格库保存失败");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const openCreateModal = () => {
    setModalMode("create");
    setModalDraft(createDraftStyle());
    setModalOpen(true);
    setMessage(null);
    setError(null);
  };

  const openEditModal = (style: StyleConfig) => {
    setModalMode("edit");
    setModalDraft({ ...style });
    setModalOpen(true);
    setMessage(null);
    setError(null);
  };

  const closeModal = () => {
    if (isSaving) return;
    setModalOpen(false);
    setError(null);
  };

  const handleSubmitModal = async () => {
    if (!modalDraft.name.trim() || !modalDraft.positive_prompt.trim()) {
      setError("请至少填写风格名称和正向提示词");
      return;
    }
    const styleToSave: StyleConfig = {
      ...modalDraft,
      name: modalDraft.name.trim(),
      description: modalDraft.description?.trim() || "",
      positive_prompt: modalDraft.positive_prompt.trim(),
      negative_prompt: modalDraft.negative_prompt.trim(),
      is_custom: true,
    };
    const nextStyles = upsertStyle(styles, styleToSave);
    const ok = await handlePersistStyles(nextStyles, modalMode === "create" ? "风格已创建" : "风格已更新");
    if (ok) setModalOpen(false);
  };

  const handleDeleteStyle = async (style: StyleConfig) => {
    if (isSaving) return;
    setDeleteTarget(style);
    setDeleteModalOpen(true);
    setMessage(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <section className="studio-panel p-4 flex items-center justify-between shadow-sm">
        <div className="admin-filter-bar flex-1 max-w-lg">
          <label className="admin-filter-search w-full relative group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索风格名称、描述或提示词关键词"
              className="w-full h-10 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
            />
          </label>
        </div>

        <button onClick={openCreateModal} className="studio-button studio-button-primary shadow-sm active:scale-95 transition-transform">
          <Plus size={16} />
          <span>新建美术风格</span>
        </button>
      </section>

      {(message || error) && (
        <section className="space-y-3">
          {message && (
            <div className="studio-panel p-3 flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-100 animate-in fade-in zoom-in-95 duration-200">
              <Check size={16} strokeWidth={3} />
              <p className="text-xs font-bold uppercase tracking-tight">{message}</p>
            </div>
          )}
          {error && (
            <div className="studio-panel p-3 flex items-center gap-2 bg-red-50 text-red-700 border border-red-100 animate-in slide-in-from-top-2 duration-200">
              <AlertCircle size={16} strokeWidth={3} />
              <p className="text-xs font-bold uppercase tracking-tight">{error}</p>
            </div>
          )}
        </section>
      )}

      <section className="studio-panel overflow-hidden shadow-sm flex flex-col min-h-[520px]">
        <div className="admin-ledger-head flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-lg font-extrabold text-slate-800 tracking-tight truncate">风格资源台账</h3>
            <span className="admin-status-badge admin-status-badge-neutral text-[11px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              {filteredStyles.length} 条
            </span>
          </div>
          <div className="text-[11px] text-slate-400 font-bold tracking-widest hidden sm:block">台账</div>
        </div>

        <div className="flex-1 overflow-auto max-h-[72vh] custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-72 text-slate-400">
              <Loader2 size={24} className="animate-spin mb-3" />
              <p className="text-sm font-medium">正在同步美术风格库...</p>
            </div>
          ) : filteredStyles.length > 0 ? (
            <div className="min-w-[980px]">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10 bg-white border-b border-slate-100">
                  <tr className="text-left">
                    <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 w-52">风格名称</th>
                    <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 w-60">风格描述</th>
                    <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 w-[22rem]">正向提示词</th>
                    <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 w-[22rem]">负向提示词</th>
                    <th className="px-5 py-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500 w-48 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStyles.map((style) => (
                    <tr key={style.id} className="group hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-4 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                            <Palette size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-extrabold text-slate-900 truncate" title={style.name || ""}>
                                {style.name || "未命名风格"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 align-middle">
                        <div className="text-sm text-slate-600 line-clamp-2 leading-relaxed" title={style.description || ""}>
                          {style.description?.trim() ? style.description : "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4 align-middle">
                        <div className="text-sm text-slate-700 line-clamp-2 leading-relaxed" title={style.positive_prompt || ""}>
                          {style.positive_prompt?.trim() ? style.positive_prompt : "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4 align-middle">
                        <div className="text-sm text-slate-700 line-clamp-2 leading-relaxed" title={style.negative_prompt || ""}>
                          {style.negative_prompt?.trim() ? style.negative_prompt : "—"}
                        </div>
                      </td>

                      <td className="px-5 py-4 align-middle">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(style)}
                            disabled={isSaving}
                            className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all text-sm font-extrabold inline-flex items-center gap-2 whitespace-nowrap min-w-[88px] justify-center shadow-sm shadow-slate-900/5 disabled:opacity-50"
                          >
                            <Pencil size={16} />
                            编辑
                          </button>
                          <button
                            onClick={() => void handleDeleteStyle(style)}
                            disabled={isSaving}
                            className="h-9 px-3 rounded-xl border border-red-200 bg-red-600 text-white hover:bg-red-700 transition-all text-sm font-extrabold inline-flex items-center gap-2 whitespace-nowrap min-w-[88px] justify-center shadow-sm shadow-red-900/10 disabled:opacity-50"
                          >
                            <Trash2 size={16} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 px-10 text-center">
              <Palette className="text-slate-200 mb-4" size={48} />
              <h4 className="text-slate-900 font-bold text-lg mb-1">未找到美术风格</h4>
              <p className="text-slate-500 text-sm max-w-xs mx-auto">
                库中暂时没有匹配的风格资源。点击右上角按钮创建您的第一个自定义美术风格。
              </p>
            </div>
          )}
        </div>
      </section>

      <StyleEditorModal
        open={modalOpen}
        mode={modalMode}
        draft={modalDraft}
        isSaving={isSaving}
        error={error}
        onChange={(next) => {
          setModalDraft(next);
          if (error) setError(null);
        }}
        onClose={closeModal}
        onSubmit={() => void handleSubmitModal()}
      />

      {deleteModalOpen && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-[1.5rem] bg-white shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 bg-red-50/60">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-red-600 text-white flex items-center justify-center">
                  <Trash2 size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">确认删除</h3>
                  <p className="text-xs text-slate-600 mt-0.5">此操作不可撤销，请谨慎操作</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (isSaving) return;
                  setDeleteModalOpen(false);
                  setDeleteTarget(null);
                }}
                disabled={isSaving}
                className="rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-900 transition-all disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <div className="text-xs font-bold text-slate-500 tracking-widest">将要删除的风格</div>
                <div className="mt-2 text-base font-extrabold text-slate-900 truncate" title={deleteTarget.name || ""}>
                  {deleteTarget.name || "未命名风格"}
                </div>
                <div className="mt-2 text-sm text-slate-600 line-clamp-2 leading-relaxed" title={deleteTarget.description || ""}>
                  {deleteTarget.description?.trim() ? deleteTarget.description : "—"}
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 px-6 py-4 bg-white flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
              <button
                onClick={() => {
                  if (isSaving) return;
                  setDeleteModalOpen(false);
                  setDeleteTarget(null);
                }}
                disabled={isSaving}
                className="studio-button studio-button-ghost h-11 px-5 border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (isSaving) return;
                  const nextStyles = styles.filter((item) => item.id !== deleteTarget.id);
                  const ok = await handlePersistStyles(nextStyles, "风格已成功删除");
                  if (ok) {
                    setDeleteModalOpen(false);
                    setDeleteTarget(null);
                  }
                }}
                disabled={isSaving}
                className="h-11 px-5 rounded-xl bg-red-600 text-white font-extrabold inline-flex items-center justify-center gap-2 hover:bg-red-700 transition-all shadow-md shadow-red-900/15 disabled:opacity-60"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
