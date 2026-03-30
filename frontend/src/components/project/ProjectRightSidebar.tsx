"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { List, Settings2 } from "lucide-react";

import PropertiesPanel from "@/components/modules/PropertiesPanel";
import ProjectTaskQueuePanel, { getStepTaskActiveCount } from "@/components/modules/ProjectTaskQueuePanel";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";

interface ProjectRightSidebarProps {
    activeStep: string;
}

function isQueueEnabledStep(step: string): step is "script" | "assets" | "storyboard" | "audio" {
    return step === "script" || step === "assets" || step === "storyboard" || step === "audio";
}

export default function ProjectRightSidebar({ activeStep }: ProjectRightSidebarProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const jobsById = useTaskStore((state) => state.jobsById);
    const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);
    const [activeTab, setActiveTab] = useState<"properties" | "queue">("properties");

    const supportsQueue = isQueueEnabledStep(activeStep);
    const projectJobs = currentProject
        ? (jobIdsByProject[currentProject.id] || [])
            .map((jobId) => jobsById[jobId])
            .filter(Boolean)
        : [];
    const activeQueueCount = supportsQueue
        ? getStepTaskActiveCount(activeStep, projectJobs)
        : 0;

    useEffect(() => {
        // 右侧栏切换到不支持队列的阶段时，回到纯属性视图，避免切换页面后出现无内容态。
        if (!supportsQueue) {
            setActiveTab("properties");
        }
    }, [supportsQueue, activeStep]);

    if (activeStep === "motion" || activeStep === "assembly") {
        return null;
    }

    if (!supportsQueue) {
        return <PropertiesPanel activeStep={activeStep} />;
    }

    return (
        <aside className="studio-inspector w-72 h-full flex flex-col z-50">
            <div className="flex h-14 border-b border-white/10 bg-black/20">
                <button
                    type="button"
                    onClick={() => setActiveTab("properties")}
                    className={`flex-1 h-full text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "properties"
                        ? "text-white border-b-2 border-primary bg-white/5"
                        : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                        }`}
                >
                    <Settings2 size={16} />
                    属性面板
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("queue")}
                    className={`flex-1 h-full text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === "queue"
                        ? "text-white border-b-2 border-primary bg-white/5"
                        : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                        }`}
                >
                    <List size={16} />
                    任务队列
                    {activeQueueCount > 0 && (
                        <span className="bg-primary text-white text-[10px] px-1.5 rounded-full">
                            {activeQueueCount}
                        </span>
                    )}
                </button>
            </div>

            <div className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                    {activeTab === "properties" ? (
                        <motion.div
                            key="properties"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="absolute inset-0"
                        >
                            <PropertiesPanel activeStep={activeStep} embedded />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="queue"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="absolute inset-0"
                        >
                            <ProjectTaskQueuePanel step={activeStep} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </aside>
    );
}
