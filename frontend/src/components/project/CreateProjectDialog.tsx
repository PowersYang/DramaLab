"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/store/projectStore";


interface CreateProjectDialogProps {
    isOpen: boolean;
    onClose: () => void;
    redirectBasePath?: string;
}

export default function CreateProjectDialog({ isOpen, onClose, redirectBasePath = "/studio/projects" }: CreateProjectDialogProps) {
    const router = useRouter();
    const [title, setTitle] = useState("");
    const [text, setText] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const createProject = useProjectStore((state) => state.createProject);


    const handleCreate = async () => {
        if (!title) {
            alert("请填写项目标题");
            return;
        }

        setIsCreating(true);
        try {
            await createProject(title, text, true);
            const currentProject = useProjectStore.getState().currentProject;
            if (currentProject) {
                router.push(`${redirectBasePath}/${currentProject.id}`);
            }
            onClose();
        } catch (error: any) {
            const errorMessage = error?.response?.data?.detail || error?.message || "请检查后端连接";
            alert(`创建项目失败: ${errorMessage}`);
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
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="studio-panel w-full max-w-2xl rounded-[2rem] p-8"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-display font-bold text-slate-950">创建新项目</h2>
                            <button
                                onClick={onClose}
                                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block text-sm font-medium text-slate-700">
                                    项目标题
                                </label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="输入项目标题..."
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm font-medium text-slate-700">
                                    脚本内容
                                </label>
                                <textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    placeholder="粘贴小说或剧本内容..."
                                    rows={10}
                                    className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-primary focus:bg-white"
                                />
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    onClick={onClose}
                                    className="flex-1 rounded-full border border-slate-200 bg-white px-6 py-3 font-medium text-slate-600"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={isCreating || !title}
                                    className="flex-1 rounded-full bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isCreating ? "创建中..." : "创建项目"}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
