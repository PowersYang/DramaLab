"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

import { useProjectStore } from "@/store/projectStore";

interface CreateSeriesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateSeriesDialog({ isOpen, onClose }: CreateSeriesDialogProps) {
  const router = useRouter();
  const createSeries = useProjectStore((state) => state.createSeries);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      return;
    }

    setIsCreating(true);
    try {
      const series = await createSeries(title.trim(), description.trim() || undefined);
      setTitle("");
      setDescription("");
      onClose();
      router.push(`/studio/series/${series.id}`);
    } catch (error) {
      console.error("Failed to create series:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Show</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">创建剧集</h2>
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950">
                <X size={18} />
              </button>
            </div>

            <div className="mt-8 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">剧集标题</label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：都市情感宇宙"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">剧集简介</label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  placeholder="描述这个剧集的题材、受众和创作目标"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button onClick={onClose} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || isCreating}
                className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreating ? "创建中..." : "创建剧集"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
