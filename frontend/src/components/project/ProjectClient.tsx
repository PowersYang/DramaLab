"use client";

import { useEffect, useState } from "react";
import { Palette, Layout, Film, Share2, Mic, Music, BookOpen, Users, Video, Sun, Moon } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import PipelineSidebar from "@/components/layout/PipelineSidebar";
import type { BreadcrumbSegment } from "@/components/layout/BreadcrumbBar";
import ProjectRightSidebar from "@/components/project/ProjectRightSidebar";
import ScriptProcessor from "@/components/modules/ScriptProcessor";
import VideoGenerator from "@/components/modules/VideoGenerator";
import VideoAssembly from "@/components/modules/VideoAssembly";
import ConsistencyVault from "@/components/modules/ConsistencyVault";
import ArtDirection from "@/components/modules/ArtDirection";
import StoryboardComposer from "@/components/modules/StoryboardComposer";
import VoiceActingStudio from "@/components/modules/VoiceActingStudio";
import FinalMixStudio from "@/components/modules/FinalMixStudio";
import ExportStudio from "@/components/modules/ExportStudio";
import { usePathname, useRouter } from "next/navigation";
import { PROJECT_REFRESH_PATH_STORAGE_KEY, isPageReloadNavigation } from "@/components/project/projectNavigation";
import { persistStudioTheme, readStoredStudioTheme, type StudioTheme } from "@/components/studio/studioTheme";
import { StudioOverlaysProvider } from "@/components/studio/ui/StudioOverlays";

import CreativeCanvas from "@/components/canvas/CreativeCanvas";
const PROJECT_STEP_STORAGE_KEY_PREFIX = "dramalab-project-active-step";
const LEGACY_PROJECT_STEP_STORAGE_KEY_PREFIX = "lumenx-project-active-step";
const PROJECT_STEP_IDS = [
    "script",
    "art_direction",
    "assets",
    "storyboard",
    "motion",
    "assembly",
    "audio",
    "mix",
    "export",
];

export default function ProjectClient({ id, breadcrumbSegments, homeHref = "/studio/projects" }: { id: string; breadcrumbSegments?: BreadcrumbSegment[]; homeHref?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [activeStep, setActiveStep] = useState("script");
    const [theme, setTheme] = useState<StudioTheme>("light");
    const [hasRestoredStep, setHasRestoredStep] = useState(false);

    const hasHydrated = useProjectStore((state) => state.hasHydrated);
    const selectProject = useProjectStore((state) => state.selectProject);
    const currentProject = useProjectStore((state) => state.currentProject);

    const handleBackToHome = () => {
        router.push(homeHref);
    };

    const steps = [
        { id: "script", label: "剧本处理", icon: BookOpen },
        { id: "art_direction", label: "美术设定", icon: Palette },
        { id: "assets", label: "资产制作", icon: Users },
        { id: "storyboard", label: "分镜设计", icon: Layout },
        { id: "motion", label: "视频生成", icon: Video },
        { id: "assembly", label: "视频组装", icon: Film },
        { id: "audio", label: "配音制作", icon: Mic },
        { id: "mix", label: "最终混剪", icon: Music },
        { id: "export", label: "导出成片", icon: Share2 },
    ];
    const projectStepStorageKey = `${PROJECT_STEP_STORAGE_KEY_PREFIX}:${id}`;
    const legacyProjectStepStorageKey = `${LEGACY_PROJECT_STEP_STORAGE_KEY_PREFIX}:${id}`;

    useEffect(() => {
        setHasRestoredStep(false);
    }, [projectStepStorageKey]);

    useEffect(() => {
        if (!hasHydrated) {
            return;
        }
        selectProject(id);
    }, [hasHydrated, id, selectProject]);

    useEffect(() => {
        // 读取本地主题偏好，让项目制作页和工作台的视觉习惯保持连续。
        setTheme(readStoredStudioTheme());
    }, []);

    useEffect(() => {
        if (!hasHydrated) {
            return;
        }

        // 中文注释：只有“真实页面刷新”且“刷新前离开的就是当前项目页”时，才恢复上次停留阶段。
        const refreshedProjectPath = window.sessionStorage.getItem(PROJECT_REFRESH_PATH_STORAGE_KEY);
        const savedStep = isPageReloadNavigation() && refreshedProjectPath === pathname
            ? window.localStorage.getItem(projectStepStorageKey) ?? window.localStorage.getItem(legacyProjectStepStorageKey)
            : null;

        if (savedStep && PROJECT_STEP_IDS.includes(savedStep)) {
            setActiveStep(savedStep);
        } else {
            setActiveStep("script");
        }
        setHasRestoredStep(true);
    }, [hasHydrated, legacyProjectStepStorageKey, pathname, projectStepStorageKey]);

    useEffect(() => {
        const markRefreshPath = () => {
            // 中文注释：仅浏览器真正卸载当前文档时才会触发，用它标记“刷新前所在项目页”。
            window.sessionStorage.setItem(PROJECT_REFRESH_PATH_STORAGE_KEY, pathname);
        };

        window.addEventListener("beforeunload", markRefreshPath);
        return () => {
            window.removeEventListener("beforeunload", markRefreshPath);
        };
    }, [pathname]);

    useEffect(() => {
        // 持久化主题偏好，避免每次重新打开项目都回到默认状态。
        persistStudioTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (!hasHydrated || !hasRestoredStep || !PROJECT_STEP_IDS.includes(activeStep)) {
            return;
        }

        // 当前步骤单独存储，避免刷新时总是落回默认的剧本处理页。
        window.localStorage.setItem(projectStepStorageKey, activeStep);
        window.localStorage.removeItem(legacyProjectStepStorageKey);
    }, [activeStep, hasHydrated, hasRestoredStep, legacyProjectStepStorageKey, projectStepStorageKey]);

    if (!hasHydrated) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center">
                    <p className="text-gray-400">正在恢复项目状态...</p>
                </div>
            </div>
        );
    }

    if (!currentProject) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center">
                    <p className="text-gray-400 mb-4">项目未找到</p>
                    <button
                        onClick={handleBackToHome}
                        className="text-primary hover:underline"
                    >
                        返回项目列表
                    </button>
                </div>
            </div>
        );
    }

    const segments = breadcrumbSegments || [{ label: "项目中心", href: homeHref }, { label: currentProject.title }];
    return (
        <StudioOverlaysProvider>
            <main
                data-studio-theme={theme}
                className="studio-theme-root pipeline-theme-root flex h-screen w-screen overflow-hidden relative bg-background"
            >
                <div className="absolute inset-0 z-0 pointer-events-auto">
                    <CreativeCanvas theme={theme} />
                </div>

                <div className="relative z-20 h-full flex flex-col overflow-hidden">
                    <PipelineSidebar
                        activeStep={activeStep}
                        onStepChange={setActiveStep}
                        steps={steps}
                        breadcrumbSegments={segments}
                        headerActions={
                            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                                <button
                                    type="button"
                                    onClick={() => setTheme("light")}
                                    aria-pressed={theme === "light"}
                                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                                        theme === "light"
                                            ? "bg-white text-slate-950 shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    <Sun size={14} />
                                    浅色
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTheme("dark")}
                                    aria-pressed={theme === "dark"}
                                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                                        theme === "dark"
                                            ? "bg-primary text-white shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    <Moon size={14} />
                                    深色
                                </button>
                            </div>
                        }
                    />
                </div>

                <div className="flex-1 flex overflow-hidden relative z-10">
                    <div className="flex-1 overflow-hidden relative">
                        {activeStep === "script" && <ScriptProcessor />}
                        {activeStep === "art_direction" && <ArtDirection />}
                        {activeStep === "assets" && <ConsistencyVault />}
                        {activeStep === "storyboard" && <StoryboardComposer />}
                        {activeStep === "motion" && <VideoGenerator />}
                        {activeStep === "assembly" && <VideoAssembly />}
                        {activeStep === "audio" && <VoiceActingStudio />}
                        {activeStep === "mix" && <FinalMixStudio />}
                        {activeStep === "export" && <ExportStudio />}
                    </div>

                    {activeStep !== "assembly" && activeStep !== "art_direction" && <ProjectRightSidebar activeStep={activeStep} />}
                </div>
            </main>
        </StudioOverlaysProvider>
    );
}
