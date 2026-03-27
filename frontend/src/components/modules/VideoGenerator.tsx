"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";
import VideoCreator from "./VideoCreator";
import VideoSidebar from "./VideoSidebar";
import { api, TaskReceipt, VideoTask } from "@/lib/api";

export default function VideoGenerator() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
    const jobsById = useTaskStore((state) => state.jobsById);
    const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);
    const [tasks, setTasks] = useState<VideoTask[]>([]);
    const previousActiveJobIdsRef = useRef<string[]>([]);

    // Shared state for Remix functionality
    const [remixData, setRemixData] = useState<Partial<VideoTask> | null>(null);

    // Get default model from project settings
    const defaultI2vModel = currentProject?.model_settings?.i2v_model || "wan2.5-i2v-preview";

    // Generation Params (Lifted State)
    const [params, setParams] = useState({
        resolution: "720p",
        duration: 5,
        seed: undefined as number | undefined,
        generateAudio: true,  // Default to AI Sound enabled
        audioUrl: "",
        promptExtend: true,
        negativePrompt: "",
        batchSize: 1,
        cameraMovement: "none" as string,
        subjectMotion: "still" as string,
        model: defaultI2vModel,
        shotType: "single" as string,  // 'single' or 'multi' (only for wan2.6-i2v)
        generationMode: "i2v" as string,  // 'i2v' or 'r2v'
        referenceVideoUrls: [] as string[],  // Reference videos for R2V (max 3)
        // Kling params
        mode: "std" as string,
        sound: false,
        cfgScale: 0.5,
        // Vidu params
        viduAudio: true,
        movementAmplitude: "auto" as string,
    });

    // Sync model from project settings when project changes
    useEffect(() => {
        if (currentProject?.model_settings?.i2v_model) {
            setParams(p => ({ ...p, model: currentProject.model_settings!.i2v_model }));
        }
    }, [currentProject?.model_settings?.i2v_model]);

    // Sync tasks from project
    useEffect(() => {
        if (currentProject?.video_tasks) {
            setTasks(currentProject.video_tasks);
        }
    }, [currentProject?.video_tasks]);

    const activeJobIds = useMemo(() => {
        if (!currentProject) return [];
        const projectJobIds = jobIdsByProject[currentProject.id] || [];
        return projectJobIds.filter((jobId) => {
            const job = jobsById[jobId];
            return job && ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status);
        });
    }, [currentProject, jobIdsByProject, jobsById]);

    // Poll active jobs only; this keeps任务状态同步和项目详情刷新解耦。
    useEffect(() => {
        if (!currentProject || activeJobIds.length === 0) return;

        let cancelled = false;
        let timeoutId: number | null = null;

        const pollActiveJobs = async () => {
            try {
                await fetchProjectJobs(currentProject.id, ["queued", "claimed", "running", "retry_waiting", "cancel_requested"]);
            } catch (error) {
                console.error("Failed to poll active project jobs:", error);
            } finally {
                if (!cancelled) {
                    timeoutId = window.setTimeout(pollActiveJobs, 3000);
                }
            }
        };

        timeoutId = window.setTimeout(pollActiveJobs, 3000);
        return () => {
            cancelled = true;
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [activeJobIds, currentProject?.id, fetchProjectJobs]);

    // 只有“活跃任务刚结束”时才刷新视频产物，避免历史 completed job 导致重复刷新。
    useEffect(() => {
        if (!currentProject) {
            previousActiveJobIdsRef.current = [];
            return;
        }

        const previousIds = previousActiveJobIdsRef.current;
        const activeIdSet = new Set(activeJobIds);
        const finishedJobIds = previousIds.filter((jobId) => !activeIdSet.has(jobId));
        previousActiveJobIdsRef.current = activeJobIds;

        if (finishedJobIds.length === 0) return;

        let cancelled = false;
        (async () => {
            try {
                const project = await api.getProject(currentProject.id);
                if (cancelled || !project.video_tasks) return;
                setTasks(project.video_tasks);
                updateProject(currentProject.id, { video_tasks: project.video_tasks });
            } catch (error) {
                console.error("Failed to refresh video tasks after job completion:", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [activeJobIds, currentProject, updateProject]);

    const handleTaskCreated = (updatedProject: any) => {
        if (updatedProject.video_tasks) {
            setTasks(updatedProject.video_tasks);
            updateProject(currentProject!.id, { video_tasks: updatedProject.video_tasks });
        }
    };

    const handleJobCreated = (receipts: TaskReceipt[]) => {
        if (!currentProject) return;
        enqueueReceipts(currentProject.id, receipts);
    };

    const handleRemix = (task: VideoTask) => {
        setRemixData({
            image_url: task.image_url,
            prompt: task.prompt,
            negative_prompt: task.negative_prompt,
            seed: task.seed,
            duration: task.duration,
            audio_url: task.audio_url,
            prompt_extend: task.prompt_extend
        });

        // Update params state
        setParams(p => ({
            ...p,
            duration: task.duration || 5,
            seed: task.seed,
            resolution: task.resolution || "720p",
            generateAudio: task.generate_audio,
            audioUrl: task.audio_url || "",
            promptExtend: task.prompt_extend ?? true,
            negativePrompt: task.negative_prompt || "",
            // Reset motion params as they are not stored directly in task (they are in prompt)
            cameraMovement: "none",
            subjectMotion: "still"
        }));
    };

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Left: Creator (70%) */}
            <div className="w-[70%] h-full border-r border-white/10">
                <VideoCreator
                    onTaskCreated={handleTaskCreated}
                    onJobCreated={handleJobCreated}
                    remixData={remixData}
                    onRemixClear={() => setRemixData(null)}
                    params={params}
                    onParamsChange={(newParams) => setParams(p => ({ ...p, ...newParams }))}
                />
            </div>

            {/* Right: Sidebar (30%) */}
            <div className="w-[30%] h-full">
                <VideoSidebar
                    tasks={tasks}
                    projectId={currentProject?.id}
                    onRemix={handleRemix}
                    params={params}
                    setParams={setParams}
                />
            </div>
        </div>
    );
}
