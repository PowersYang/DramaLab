"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Check, X, Megaphone, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api, type Announcement } from "@/lib/api";

interface AnnouncementManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AnnouncementManagerDialog({ isOpen, onClose }: AnnouncementManagerDialogProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<Partial<Announcement>>({
    title: "",
    content: "",
    status: "active",
    priority: 0,
  });

  const fetchAll = async () => {
    try {
      setLoading(true);
      const data = await api.listAllAnnouncements();
      setAnnouncements(data);
    } catch (error) {
      console.error("Failed to fetch all announcements:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAll();
    }
  }, [isOpen]);

  const handleCreate = async () => {
    if (!form.title || !form.content) return;
    try {
      setSubmitting(true);
      await api.createAnnouncement(form);
      setShowAdd(false);
      setForm({ title: "", content: "", status: "active", priority: 0 });
      fetchAll();
    } catch (error) {
      alert("创建失败: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      setSubmitting(true);
      await api.updateAnnouncement(id, form);
      setEditingId(null);
      fetchAll();
    } catch (error) {
      alert("更新失败: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条公告吗？")) return;
    try {
      await api.deleteAnnouncement(id);
      fetchAll();
    } catch (error) {
      alert("删除失败: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const startEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      content: a.content,
      status: a.status,
      priority: a.priority,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
                  <Megaphone size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">系统公告管理</h2>
                  <p className="text-xs text-slate-500">发布、编辑和管理全站系统公告</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">公告列表</h3>
                {!showAdd && (
                  <button
                    onClick={() => setShowAdd(true)}
                    disabled={!!editingId}
                    className="flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-blue-600 hover:shadow-lg active:scale-95 disabled:opacity-50"
                  >
                    <Plus size={14} />
                    新增公告
                  </button>
                )}
              </div>

              {showAdd && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border-2 border-blue-100 bg-blue-50/30 p-6 space-y-4"
                >
                  <div className="space-y-4">
                    <input
                      type="text"
                      placeholder="公告标题"
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                    <textarea
                      placeholder="公告内容"
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                    />
                    <div className="flex gap-6 items-center">
                      <label className="flex items-center gap-3 text-xs font-medium text-slate-600">
                        优先级权重 (越大越靠前):
                        <input
                          type="number"
                          className="w-20 rounded-lg border border-slate-200 px-3 py-1.5"
                          value={form.priority}
                          onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                        />
                      </label>
                      <label className="flex items-center gap-3 text-xs font-medium text-slate-600">
                        发布状态:
                        <select
                          className="rounded-lg border border-slate-200 px-3 py-1.5 bg-white"
                          value={form.status}
                          onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                        >
                          <option value="active">立即发布 (Active)</option>
                          <option value="inactive">暂不发布 (Inactive)</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setShowAdd(false)}
                      className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={submitting || !form.title || !form.content}
                      className="flex items-center gap-2 rounded-full bg-blue-500 px-6 py-2 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-50"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      确认发布
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="space-y-4">
                {loading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                    目前还没有发布任何公告
                  </div>
                ) : (
                  announcements.map((a) => (
                    <div key={a.id} className="rounded-2xl border border-slate-100 p-5 hover:border-blue-100 transition-colors bg-white">
                      {editingId === a.id ? (
                        <div className="space-y-4">
                          <input
                            type="text"
                            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                          />
                          <textarea
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
                            value={form.content}
                            onChange={(e) => setForm({ ...form, content: e.target.value })}
                          />
                          <div className="flex gap-6 items-center">
                            <label className="flex items-center gap-3 text-xs font-medium text-slate-600">
                              权重:
                              <input
                                type="number"
                                className="w-20 rounded-lg border border-slate-200 px-3 py-1.5"
                                value={form.priority}
                                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                              />
                            </label>
                            <label className="flex items-center gap-3 text-xs font-medium text-slate-600">
                              状态:
                              <select
                                className="rounded-lg border border-slate-200 px-3 py-1.5 bg-white"
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                              >
                                <option value="active">启用</option>
                                <option value="inactive">禁用</option>
                              </select>
                            </label>
                          </div>
                          <div className="flex justify-end gap-3 pt-2">
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleUpdate(a.id)}
                              disabled={submitting}
                              className="flex items-center gap-2 rounded-full bg-blue-500 px-6 py-2 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-50"
                            >
                              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                              保存修改
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-6">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <span className={`h-2 w-2 rounded-full ${a.status === 'active' ? 'bg-green-500' : 'bg-slate-300'}`} />
                              <h4 className="text-sm font-bold text-slate-800 truncate">{a.title}</h4>
                              <div className="flex gap-1.5">
                                {a.priority > 0 && (
                                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                    P{a.priority}
                                  </span>
                                )}
                                {a.status === 'inactive' && (
                                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                    未发布
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed mb-3 line-clamp-3">{a.content}</p>
                            <div className="flex items-center gap-4 text-[10px] text-slate-400">
                              <span>更新于: {new Date(a.updated_at).toLocaleString("zh-CN")}</span>
                              {a.created_by && <span>发布者 ID: {a.created_by}</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => startEdit(a)}
                              className="p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-500 rounded-lg transition-all"
                              title="编辑"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(a.id)}
                              className="p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all"
                              title="删除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
