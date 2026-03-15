"use client";

import { motion } from "framer-motion";
import { Calendar, Trash2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { Project } from "@/store/projectStore";

interface ProjectCardProps {
    project: Project;
    onDelete: (id: string) => void;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
    const router = useRouter();

    const handleOpen = () => {
        window.location.hash = `#/project/${project.id}`;
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`确定要删除项目"${project.title}"吗？`)) {
            onDelete(project.id);
        }
    };

    const statusColors = {
        pending: "bg-gray-500/20 text-gray-400",
        processing: "bg-yellow-500/20 text-yellow-400",
        completed: "bg-green-500/20 text-green-400",
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02 }}
            className="glass-panel p-6 rounded-xl cursor-pointer group relative border-l-2 border-l-gray-600"
            onClick={handleOpen}
        >
            <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                    <h3 className="text-lg font-display font-bold text-white mb-2">
                        {project.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Calendar size={12} />
                        <span>{new Date(project.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                </div>

                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={handleDelete}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
                <span>角色 <span className="text-white font-medium">{project.characters?.length || 0}</span></span>
                <span className="text-gray-600">·</span>
                <span>场景 <span className="text-white font-medium">{project.scenes?.length || 0}</span></span>
                <span className="text-gray-600">·</span>
                <span>分镜 <span className="text-white font-medium">{project.frames?.length || 0}</span></span>
            </div>

            <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-1 rounded ${statusColors[project.status as keyof typeof statusColors] || statusColors.pending}`}>
                    {project.status || '待开始'}
                </span>

                <div className="flex items-center gap-1 text-primary text-xs font-medium">
                    <Play size={14} />
                    <span>打开项目</span>
                </div>
            </div>
        </motion.div>
    );
}
