"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Hash, X } from "lucide-react";

import { api } from "@/lib/api";

interface CreateEpisodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  seriesId: string;
  nextEpisodeNumber: number;
  onCreated?: (episodeId: string) => void;
}

export default function CreateEpisodeDialog({ isOpen, onClose, seriesId, nextEpisodeNumber, onCreated }: CreateEpisodeDialogProps) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const trimmedTitle = useMemo(() => title.trim(), [title]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setTitle("");
    setIsCreating(false);
  }, [isOpen]);

  const handleCreate = async () => {
    if (!trimmedTitle || isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const created = await api.createEpisodeForSeries(seriesId, trimmedTitle, nextEpisodeNumber);
      onCreated?.(created.id);
      onClose();
    } catch (error) {
      console.error("Failed to create episode:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm"
          style={{ background: "rgba(2, 6, 23, 0.68)" }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className="w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/10 bg-white shadow-[0_24px_80px_rgba(2,6,23,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between px-7 pt-7">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-gray-400">
                    <Hash size={12} />
                    EP{nextEpisodeNumber}
                  </span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-gray-200">添加项目</h2>
                <p className="mt-1 text-sm text-gray-400">先创建一个单集标题，后续在单集编辑器里推进制作。</p>
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200">
                <X size={18} />
              </button>
            </div>

            <div className="px-7 pb-7 pt-6">
              <label className="mb-2 block text-[12px] font-semibold text-gray-300">集数标题</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreate();
                  if (event.key === "Escape") onClose();
                }}
                placeholder="例如：第一集·开场冲突"
                autoFocus
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-500 focus:border-white/20 focus:bg-white/10"
              />

              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={onClose} className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-gray-300 transition-colors hover:bg-white/10">
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!trimmedTitle || isCreating}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? "创建中..." : "创建集数"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
