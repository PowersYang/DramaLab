"use client";

import { useEffect, useState } from "react";
import { Palette, Layout, Film, Share2, Mic, Music, BookOpen, Users, Video } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import PipelineSidebar from "@/components/layout/PipelineSidebar";
import type { BreadcrumbSegment } from "@/components/layout/BreadcrumbBar";
import PropertiesPanel from "@/components/modules/PropertiesPanel";
import ScriptProcessor from "@/components/modules/ScriptProcessor";
import VideoGenerator from "@/components/modules/VideoGenerator";
import VideoAssembly from "@/components/modules/VideoAssembly";
import ConsistencyVault from "@/components/modules/ConsistencyVault";
import ArtDirection from "@/components/modules/ArtDirection";
import StoryboardComposer from "@/components/modules/StoryboardComposer";
import VoiceActingStudio from "@/components/modules/VoiceActingStudio";
import FinalMixStudio from "@/components/modules/FinalMixStudio";
import ExportStudio from "@/components/modules/ExportStudio";
import dynamic from "next/dynamic";

const CreativeCanvas = dynamic(() => import("@/components/canvas/CreativeCanvas"), { ssr: false });

export default function ProjectClient({ id, breadcrumbSegments }: { id: string; breadcrumbSegments?: BreadcrumbSegment[] }) {
    const [activeStep, setActiveStep] = useState("script");

    const selectProject = useProjectStore((state) => state.selectProject);
    const currentProject = useProjectStore((state) => state.currentProject);

    const handleBackToHome = () => {
        window.location.hash = '';
    };

    const steps = [
        { id: "script", label: "1. Script", icon: BookOpen },
        { id: "art_direction", label: "2. Art Direction", icon: Palette },
        { id: "assets", label: "3. Assets", icon: Users },
        { id: "storyboard", label: "4. Storyboard", icon: Layout },
        { id: "motion", label: "5. Motion", icon: Video },
        { id: "assembly", label: "6. Assembly", icon: Film },
        { id: "audio", label: "7. Voice", icon: Mic, comingSoon: true },
        { id: "mix", label: "8. Final Mix", icon: Music, comingSoon: true },
        { id: "export", label: "9. Export", icon: Share2, comingSoon: true },
    ];

    useEffect(() => {
        selectProject(id);
    }, [id, selectProject]);

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

    const segments = breadcrumbSegments || [{ label: "DramaLab", hash: "#/" }, { label: currentProject.title }];

    return (
        <main className="flex h-screen w-screen bg-background overflow-hidden relative">
            {/* Background Canvas */}
            <div className="absolute inset-0 z-0 pointer-events-auto">
                <CreativeCanvas />
            </div>

            {/* Left Sidebar — unified PipelineSidebar with integrated breadcrumb */}
            <div className="relative z-20 h-full flex flex-col overflow-hidden">
                <PipelineSidebar
                    activeStep={activeStep}
                    onStepChange={setActiveStep}
                    steps={steps}
                    breadcrumbSegments={segments}
                />
            </div>

            {/* Main Content Area */}
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

                {/* Right Sidebar - Contextual Inspector */}
                {activeStep !== "assembly" && activeStep !== "art_direction" && <PropertiesPanel activeStep={activeStep} />}
            </div>
        </main>
    );
}
