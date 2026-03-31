"use client";

import { useEffect, useMemo, useState } from "react";
import { 
  Check, 
  Loader2, 
  Palette, 
  Plus, 
  Save, 
  Search, 
  Trash2,
  ChevronRight,
  Info,
  Sparkles,
  AlertCircle
} from "lucide-react";

import { api } from "@/lib/api";
import type { StyleConfig } from "@/store/projectStore";

/**
 * 🎨 StudioArtStyleLibraryPage - 美术风格策略中心 (Refined Professional Edition)
 * 
 * 视觉风格：
 * - 遵循 DramaLab 全局浅色专业主题 (globals.css: brand-panel, admin-primary)
 * - 清晰的双栏布局：左侧“风格资源台账”，右侧“风格编辑器”
 * - 高对比度文字，严谨的表单分组，细腻的悬停反馈
 */

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
  const [keyword, setKeyword] = useState("");
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
      setTimeout(() => setMessage(null), 3000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "风格库保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editingStyle.name.trim() || !editingStyle.positive_prompt.trim()) {
      setError("请至少填写风格名称和正向提示词");
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
    await handlePersistStyles(nextStyles, "风格配置保存成功", styleToSave.id);
  };

  const handleDelete = async () => {
    if (!selectedStyleId || !confirm("确定要删除此风格吗？")) {
      return;
    }
    const nextStyles = styles.filter((style) => style.id !== selectedStyleId);
    await handlePersistStyles(nextStyles, "风格已成功删除", nextStyles[0]?.id || null);
  };

  return (
    <div className="space-y-6">
      {/* 🛠 顶部工具栏 - 搜索与操作 */}
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

        <button onClick={handleCreate} className="studio-button studio-button-primary shadow-sm active:scale-95 transition-transform">
          <Plus size={16} />
          <span>新建美术风格</span>
        </button>
      </section>

      {/* 🗄 双栏主体 */}
      <section className="admin-workbench-grid grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* 📚 风格台账列表 */}
        <section className="lg:col-span-7 xl:col-span-8 studio-panel overflow-hidden shadow-sm flex flex-col min-h-[500px]">
          <div className="admin-ledger-head flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">风格资源台账</h3>
              <span className="admin-status-badge admin-status-badge-neutral text-[11px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                {filteredStyles.length} 款可用
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[70vh] custom-scrollbar">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Loader2 size={24} className="animate-spin mb-3" />
                <p className="text-sm font-medium">正在同步美术风格库...</p>
              </div>
            ) : filteredStyles.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {filteredStyles.map((style) => {
                  const isSelected = style.id === selectedStyleId;
                  return (
                    <button
                      key={style.id}
                      onClick={() => handleSelectStyle(style)}
                      className={`w-full group flex items-center justify-between p-5 text-left transition-all hover:bg-slate-50/80 ${
                        isSelected ? "bg-blue-50/40 border-l-4 border-l-blue-600" : "border-l-4 border-l-transparent"
                      }`}
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center gap-3 mb-1">
                          <p className={`text-base font-bold truncate ${isSelected ? "text-blue-700" : "text-slate-900"}`}>
                            {style.name || "未命名风格"}
                          </p>
                          {isSelected && <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded uppercase">Editing</span>}
                        </div>
                        <p className="text-sm text-slate-500 line-clamp-1">
                          {style.description || "暂无描述，建议添加风格定位说明"}
                        </p>
                      </div>

                      <div className="flex items-center gap-6 text-xs font-semibold uppercase tracking-tighter text-slate-400">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-400 mb-1 font-bold">Positive</span>
                          <span className={style.positive_prompt.trim() ? "text-emerald-600" : "text-slate-300"}>
                            {style.positive_prompt.trim() ? "已填写" : "未填写"}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-400 mb-1 font-bold">Negative</span>
                          <span className={style.negative_prompt.trim() ? "text-blue-500" : "text-slate-300"}>
                            {style.negative_prompt.trim() ? "已填写" : "未填写"}
                          </span>
                        </div>
                        <ChevronRight size={16} className={`ml-2 transition-transform group-hover:translate-x-1 ${isSelected ? "text-blue-600" : "text-slate-300"}`} />
                      </div>
                    </button>
                  );
                })}
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

        {/* 🖌 风格编辑器面板 */}
        <aside className="lg:col-span-5 xl:col-span-4 sticky top-6">
          <section className="studio-panel shadow-md border border-slate-200">
            <div className="admin-inspector-head border-b border-slate-100 bg-slate-50/30 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                  <Palette size={18} />
                </div>
                <h3 className="text-lg font-bold text-slate-800">风格编辑器</h3>
              </div>
            </div>

            <div className="admin-inspector-body p-5 space-y-6">
              {/* 核心识别 */}
              <div className="admin-form-section border border-slate-100 bg-white rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1">
                  <Info size={14} />
                  <span>核心识别</span>
                </div>
                
                <div className="admin-form-field">
                  <label className="text-xs font-bold text-slate-500 mb-1.5 block">风格名称</label>
                  <input
                    value={editingStyle.name}
                    onChange={(e) => setEditingStyle((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="例如：浮世绘 / 赛博朋克"
                    className="studio-input h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                  />
                </div>

                <div className="admin-form-field">
                  <label className="text-xs font-bold text-slate-500 mb-1.5 block">风格描述</label>
                  <textarea
                    value={editingStyle.description || ""}
                    onChange={(e) => setEditingStyle((prev) => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    placeholder="简述此风格的视觉特征、适用场景等"
                    className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm resize-none"
                  />
                </div>
              </div>

              {/* 提示词工程 */}
              <div className="admin-form-section border border-slate-100 bg-white rounded-xl p-4 space-y-4">
                <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-1">
                  <Sparkles size={14} />
                  <span>Prompt 实验室</span>
                </div>

                <div className="admin-form-field">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-500 block">正向提示词 (Positive)</label>
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">Reinforce</span>
                  </div>
                  <textarea
                    value={editingStyle.positive_prompt}
                    onChange={(e) => setEditingStyle((prev) => ({ ...prev, positive_prompt: e.target.value }))}
                    rows={5}
                    placeholder="cinematic lighting, ultra-detailed, 8k..."
                    className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all text-sm leading-relaxed"
                  />
                </div>

                <div className="admin-form-field">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-500 block">负向提示词 (Negative)</label>
                    <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">Filter</span>
                  </div>
                  <textarea
                    value={editingStyle.negative_prompt}
                    onChange={(e) => setEditingStyle((prev) => ({ ...prev, negative_prompt: e.target.value }))}
                    rows={4}
                    placeholder="low quality, blurry, watermark..."
                    className="studio-textarea px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm leading-relaxed"
                  />
                </div>
              </div>

              {/* 底部操作 */}
              <div className="flex flex-col gap-3 pt-4">
                <button 
                  onClick={handleSave} 
                  disabled={isSaving} 
                  className="studio-button studio-button-primary h-11 w-full font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-transform"
                >
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>保存风格配置</span>
                </button>
                <button 
                  onClick={handleDelete}
                  disabled={!selectedStyleId || isSaving || !styles.some((s) => s.id === selectedStyleId)}
                  className="studio-button studio-button-ghost h-11 w-full border-slate-200 hover:border-red-200 hover:text-red-600 hover:bg-red-50/50 transition-all font-semibold"
                >
                  <Trash2 size={18} />
                  <span>删除当前风格</span>
                </button>
              </div>

              {/* 状态通知 */}
              {message && (
                <div className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg animate-in fade-in zoom-in-95 duration-200">
                  <Check size={16} strokeWidth={3} />
                  <p className="text-xs font-bold uppercase tracking-tight">{message}</p>
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 border border-red-100 rounded-lg animate-in slide-in-from-top-2 duration-200">
                  <AlertCircle size={16} strokeWidth={3} />
                  <p className="text-xs font-bold uppercase tracking-tight">{error}</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </section>

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
