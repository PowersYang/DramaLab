import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, API_URL } from '@/lib/api';
import { useTaskStore } from '@/store/taskStore';

export interface ImageVariant {
    id: string;
    url: string;
    created_at: string | number;
    prompt_used?: string;
}

export interface ImageAsset {
    selected_id: string | null;
    variants: ImageVariant[];
}

export interface VideoTask {
    id: string;
    project_id: string;
    asset_id?: string;
    frame_id?: string;
    image_url: string;
    prompt: string;
    status: string;
    video_url?: string;
    duration?: number;
    created_at: string | number;
    model?: string;
    generation_mode?: string;  // 'i2v' or 'r2v'
    reference_video_urls?: string[];  // Reference videos for R2V
}

export interface Character {
    id: string;
    created_at?: string | number;
    name: string;
    description?: string;
    age?: string;
    gender?: string;
    clothing?: string;
    visual_weight?: number;

    // Legacy fields
    image_url?: string;
    avatar_url?: string;
    full_body_image_url?: string;
    three_view_image_url?: string;
    headshot_image_url?: string;

    // New Asset Containers
    full_body_asset?: ImageAsset;
    three_view_asset?: ImageAsset;
    headshot_asset?: ImageAsset;

    // Video Assets
    video_assets?: VideoTask[];
    video_prompt?: string;

    voice_id?: string;
    voice_name?: string;
    voice_speed?: number;
    voice_pitch?: number;
    voice_volume?: number;
    locked?: boolean;
    status?: string;
    is_consistent?: boolean;
    full_body_updated_at?: string | number;
    three_view_updated_at?: string | number;
    headshot_updated_at?: string | number;
}

export interface Scene {
    id: string;
    created_at?: string | number;
    name: string;
    description: string;
    image_url?: string;
    image_asset?: ImageAsset;
    video_assets?: VideoTask[];
    video_prompt?: string;
    status?: string;
    locked?: boolean;
    time_of_day?: string;
    lighting_mood?: string;
}

export interface Prop {
    id: string;
    created_at?: string | number;
    name: string;
    description: string;
    image_url?: string;
    image_asset?: ImageAsset;
    video_assets?: VideoTask[];
    video_prompt?: string;
    status?: string;
    locked?: boolean;
}

export interface StoryboardFrame {
    id: string;
    frame_order?: number;
    scene_id: string;
    image_url?: string;
    image_asset?: ImageAsset;
    rendered_image_url?: string;
    rendered_image_asset?: ImageAsset;
    status?: string;
    locked?: boolean;
    // ... other fields
}

export interface StylePreset {
    id: string;
    name: string;
    color: string;
    prompt: string;
    negative_prompt?: string;
}

export interface StyleConfig {
    id: string;
    name: string;
    description?: string;
    positive_prompt: string;
    negative_prompt: string;
    thumbnail_url?: string;
    is_custom: boolean;
    reason?: string; // For AI recommendations
}

export interface ArtDirection {
    selected_style_id: string;
    style_config: StyleConfig;
    custom_styles: StyleConfig[];
    ai_recommendations: StyleConfig[];
}

export interface ModelSettings {
    t2i_model: string;  // Text-to-Image model for Assets
    i2i_model: string;  // Image-to-Image model for Storyboard
    i2v_model: string;  // Image-to-Video model for Motion
    character_aspect_ratio: string;  // Aspect ratio for Character generation
    scene_aspect_ratio: string;  // Aspect ratio for Scene generation
    prop_aspect_ratio: string;  // Aspect ratio for Prop generation
    storyboard_aspect_ratio: string;  // Aspect ratio for Storyboard generation
}

// Model options for dropdowns
export const T2I_MODELS = [
    { id: 'wan2.6-t2i', name: 'Wan 2.6 T2I', description: 'Latest T2I model' },
    { id: 'wan2.5-t2i-preview', name: 'Wan 2.5 T2I Preview', description: 'Default T2I' },
    { id: 'wan2.2-t2i-plus', name: 'Wan 2.2 T2I Plus', description: 'Higher quality' },
    { id: 'wan2.2-t2i-flash', name: 'Wan 2.2 T2I Flash', description: 'Faster generation' },
];

export const I2I_MODELS = [
    { id: 'wan2.6-image', name: 'Wan 2.6 Image', description: 'Latest I2I model (HTTP)' },
    { id: 'wan2.5-i2i-preview', name: 'Wan 2.5 I2I Preview', description: 'Default I2I' },
];

export type DurationConfig =
    | { type: 'slider'; min: number; max: number; step: number; default: number }
    | { type: 'buttons'; options: number[]; default: number }
    | { type: 'fixed'; value: number };

export interface ModelParamSupport {
    resolution?: { options: string[]; default: string };
    seed?: boolean;
    negativePrompt?: boolean;
    promptExtend?: boolean;
    shotType?: boolean;
    audio?: boolean;
    // Kling
    mode?: { options: string[]; default: string };
    sound?: boolean;
    cfgScale?: { min: number; max: number; step: number; default: number };
    // Vidu
    viduAudio?: boolean;
    movementAmplitude?: { options: string[]; default: string };
}

export interface I2VModelConfig {
    id: string;
    name: string;
    description: string;
    duration: DurationConfig;
    params: ModelParamSupport;
}

const WAN26_PARAMS: ModelParamSupport = {
    resolution: { options: ['480p', '720p', '1080p'], default: '720p' },
    seed: true, negativePrompt: true, promptExtend: true, shotType: true, audio: true,
};

const WAN25_PARAMS: ModelParamSupport = {
    resolution: { options: ['480p', '720p', '1080p'], default: '720p' },
    seed: true, negativePrompt: true, audio: true,
};

const WAN22_PARAMS: ModelParamSupport = {
    resolution: { options: ['480p', '720p', '1080p'], default: '720p' },
    seed: true, negativePrompt: true,
};

const KLING_PARAMS: ModelParamSupport = {
    negativePrompt: true,
    mode: { options: ['std', 'pro'], default: 'std' },
    sound: true,
    cfgScale: { min: 0, max: 1, step: 0.1, default: 0.5 },
};

const VIDU_PARAMS: ModelParamSupport = {
    resolution: { options: ['540p', '720p', '1080p'], default: '720p' },
    seed: true, viduAudio: true,
    movementAmplitude: { options: ['auto', 'small', 'medium', 'large'], default: 'auto' },
};

export const I2V_MODELS: I2VModelConfig[] = [
    { id: 'wan2.6-i2v', name: 'Wan 2.6 I2V / R2V', description: 'Latest model, supports R2V',
      duration: { type: 'slider', min: 2, max: 15, step: 1, default: 5 }, params: WAN26_PARAMS },
    { id: 'wan2.6-i2v-flash', name: 'Wan 2.6 I2V Flash', description: 'Fast generation',
      duration: { type: 'slider', min: 2, max: 15, step: 1, default: 5 }, params: WAN26_PARAMS },
    { id: 'wan2.5-i2v-preview', name: 'Wan 2.5 I2V Preview', description: 'Default I2V',
      duration: { type: 'buttons', options: [5, 10], default: 5 }, params: WAN25_PARAMS },
    { id: 'wan2.2-i2v-plus', name: 'Wan 2.2 I2V Plus', description: 'Higher quality',
      duration: { type: 'fixed', value: 5 }, params: WAN22_PARAMS },
    { id: 'wan2.2-i2v-flash', name: 'Wan 2.2 I2V Flash', description: 'Faster generation',
      duration: { type: 'fixed', value: 5 }, params: WAN22_PARAMS },
    { id: 'kling-v3', name: 'Kling v3', description: 'Kling AI latest model',
      duration: { type: 'slider', min: 3, max: 15, step: 1, default: 5 }, params: KLING_PARAMS },
    { id: 'viduq3-pro', name: 'Vidu Q3 Pro', description: 'Vidu latest model',
      duration: { type: 'slider', min: 1, max: 16, step: 1, default: 5 }, params: VIDU_PARAMS },
    { id: 'viduq3-turbo', name: 'Vidu Q3 Turbo', description: 'Vidu fast generation',
      duration: { type: 'slider', min: 1, max: 16, step: 1, default: 5 }, params: VIDU_PARAMS },
];

export const ASPECT_RATIOS = [
    { id: '9:16', name: '9:16', description: 'Portrait (576*1024)' },
    { id: '16:9', name: '16:9', description: 'Landscape (1024*576)' },
    { id: '1:1', name: '1:1', description: 'Square (1024*1024)' },
];

export interface VideoParams {
    resolution: string;
    duration: number;
    seed: number | undefined;
    generateAudio: boolean;
    audioUrl: string;
    promptExtend: boolean;
    negativePrompt: string;
    batchSize: number;
    cameraMovement: string;
    subjectMotion: string;
    model: string;
    shotType: string;
    generationMode: string;
    referenceVideoUrls: string[];
    // Kling
    mode: string;
    sound: boolean;
    cfgScale: number;
    // Vidu
    viduAudio: boolean;
    movementAmplitude: string;
}

/** 将动态列数映射为完整的 Tailwind class（避免 JIT 扫描不到动态拼接） */
export const GRID_COLS_CLASS: Record<number, string> = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
};

export interface PromptConfig {
    storyboard_polish: string;
    video_polish: string;
    r2v_polish: string;
}

export interface FinalMixClipDraft {
    frame_id: string;
    video_id: string;
    clip_order: number;
    trim_start: number;
    trim_end: number;
}

export interface FinalMixTimelineDraft {
    clips: FinalMixClipDraft[];
}

export interface Series {
    id: string;
    title: string;
    description: string;
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
    art_direction?: ArtDirection;
    prompt_config?: PromptConfig;
    model_settings?: ModelSettings;
    episode_ids: string[];
    created_at: string | number;
    updated_at: string | number;
}

export interface Project {
    id: string;
    title: string;
    originalText: string;
    created_at?: string | number;
    updated_at?: string | number;
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
    frames: any[]; // Keeping as any for now to avoid breaking too much, but ideally StoryboardFrame[]
    video_tasks?: any[];
    status: string;
    createdAt: string;
    updatedAt: string;
    aspectRatio?: string;
    style_preset?: string;
    art_direction?: ArtDirection;
    model_settings?: ModelSettings;
    prompt_config?: PromptConfig;
    merged_video_url?: string;
    final_mix_timeline?: FinalMixTimelineDraft;
    series_id?: string;
    episode_number?: number;
}

const sortStoryboardFrames = (frames: any[] | undefined): any[] => {
    if (!Array.isArray(frames)) {
        return [];
    }

    // 统一按后端 frame_order 排序，避免页面渲染依赖数组偶然顺序。
    return [...frames].sort((a, b) => {
        const orderA = typeof a?.frame_order === 'number' ? a.frame_order : Number.MAX_SAFE_INTEGER;
        const orderB = typeof b?.frame_order === 'number' ? b.frame_order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
};

const parseSortableTime = (value: string | number | undefined | null): number => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return Number.MAX_SAFE_INTEGER;
};

const sortByCreatedAt = <T extends { created_at?: string | number; id?: string }>(items: T[] | undefined): T[] => {
    if (!Array.isArray(items)) {
        return [];
    }

    return [...items].sort((a, b) => {
        const timeA = parseSortableTime(a?.created_at);
        const timeB = parseSortableTime(b?.created_at);
        if (timeA !== timeB) {
            return timeA - timeB;
        }
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
};

const sortVideoTasks = <T extends { created_at?: string | number; id?: string }>(items: T[] | undefined): T[] => {
    return sortByCreatedAt(items);
};

const mergeVariantLists = <T extends { id: string; created_at?: string | number }>(current: T[] | undefined, incoming: T[] | undefined): T[] => {
    const currentList = Array.isArray(current) ? current : [];
    const incomingList = Array.isArray(incoming) ? incoming : [];
    const source = incomingList.length > 0 ? [...incomingList, ...currentList] : currentList;
    const byId = new Map<string, T>();

    source.forEach((item) => {
        if (item?.id && !byId.has(item.id)) {
            byId.set(item.id, item);
        }
    });

    return sortByCreatedAt(Array.from(byId.values()));
};

const mergeImageAssetState = (currentAsset: any, incomingAsset: any) => {
    if (!currentAsset && !incomingAsset) return incomingAsset;
    return {
        ...(currentAsset || {}),
        ...(incomingAsset || {}),
        variants: mergeVariantLists(currentAsset?.variants, incomingAsset?.variants),
        selected_id: incomingAsset?.selected_id || currentAsset?.selected_id || null,
    };
};

const mergeAssetUnitState = (currentUnit: any, incomingUnit: any) => {
    if (!currentUnit && !incomingUnit) return incomingUnit;
    return {
        ...(currentUnit || {}),
        ...(incomingUnit || {}),
        image_variants: mergeVariantLists(currentUnit?.image_variants, incomingUnit?.image_variants),
        video_variants: mergeVariantLists(currentUnit?.video_variants, incomingUnit?.video_variants),
        selected_image_id: incomingUnit?.selected_image_id || currentUnit?.selected_image_id || null,
        selected_video_id: incomingUnit?.selected_video_id || currentUnit?.selected_video_id || null,
    };
};

const mergeCharacterState = (currentItem: any, incomingItem: any) => ({
    ...(currentItem || {}),
    ...(incomingItem || {}),
    full_body_asset: mergeImageAssetState(currentItem?.full_body_asset, incomingItem?.full_body_asset),
    three_view_asset: mergeImageAssetState(currentItem?.three_view_asset, incomingItem?.three_view_asset),
    headshot_asset: mergeImageAssetState(currentItem?.headshot_asset, incomingItem?.headshot_asset),
    full_body: mergeAssetUnitState(currentItem?.full_body, incomingItem?.full_body),
    three_views: mergeAssetUnitState(currentItem?.three_views, incomingItem?.three_views),
    head_shot: mergeAssetUnitState(currentItem?.head_shot, incomingItem?.head_shot),
    video_assets: Array.isArray(incomingItem?.video_assets) ? sortVideoTasks(incomingItem.video_assets) : (currentItem?.video_assets || []),
});

const mergeSimpleAssetState = (currentItem: any, incomingItem: any) => ({
    ...(currentItem || {}),
    ...(incomingItem || {}),
    image_asset: mergeImageAssetState(currentItem?.image_asset, incomingItem?.image_asset),
    video_assets: Array.isArray(incomingItem?.video_assets) ? sortVideoTasks(incomingItem.video_assets) : (currentItem?.video_assets || []),
});

const mergeAssetCollection = (currentItems: any[] | undefined, incomingItems: any[] | undefined, mergeItem: (currentItem: any, incomingItem: any) => any) => {
    if (!Array.isArray(incomingItems)) {
        return currentItems;
    }

    const currentMap = new Map((currentItems || []).map((item: any) => [item.id, item]));
    return incomingItems.map((item: any) => mergeItem(currentMap.get(item.id), item));
};

const normalizeProject = (project: any): any => {
    if (!project) {
        return project;
    }

    const normalizeAssetOwner = (item: any) => ({
        ...item,
        ...(Array.isArray(item?.video_assets) ? { video_assets: sortVideoTasks(item.video_assets) } : {}),
    });

    return {
        ...project,
        ...(Array.isArray(project.characters) ? { characters: sortByCreatedAt(project.characters).map(normalizeAssetOwner) } : {}),
        ...(Array.isArray(project.scenes) ? { scenes: sortByCreatedAt(project.scenes).map(normalizeAssetOwner) } : {}),
        ...(Array.isArray(project.props) ? { props: sortByCreatedAt(project.props).map(normalizeAssetOwner) } : {}),
        ...(Array.isArray(project.frames) ? { frames: sortStoryboardFrames(project.frames) } : {}),
        ...(Array.isArray(project.video_tasks) ? { video_tasks: sortVideoTasks(project.video_tasks) } : {}),
    };
};

const mergeProjectDrafts = (incomingProject: any, existingProject?: any): any => {
    if (!incomingProject) {
        return incomingProject;
    }

    if (!existingProject?.final_mix_timeline || incomingProject.final_mix_timeline) {
        return incomingProject;
    }

    // Final Mix 时间轴当前先保存在前端项目状态里；后端刷新项目时要保留这份本地草稿。
    return {
        ...incomingProject,
        final_mix_timeline: existingProject.final_mix_timeline,
    };
};

const mergeProjectAssetState = (currentProject: any, incomingProject: any): any => {
    if (!currentProject) return incomingProject;
    if (!incomingProject) return incomingProject;

    return {
        ...currentProject,
        ...incomingProject,
        characters: mergeAssetCollection(currentProject.characters, incomingProject.characters, mergeCharacterState),
        scenes: mergeAssetCollection(currentProject.scenes, incomingProject.scenes, mergeSimpleAssetState),
        props: mergeAssetCollection(currentProject.props, incomingProject.props, mergeSimpleAssetState),
        frames: Array.isArray(incomingProject.frames) ? incomingProject.frames : currentProject.frames,
        video_tasks: Array.isArray(incomingProject.video_tasks) ? incomingProject.video_tasks : currentProject.video_tasks,
    };
};

interface ProjectStore {
    projects: Project[];
    currentProject: Project | null;
    hasHydrated: boolean;
    isLoading: boolean;
    isAnalyzing: boolean;
    isAnalyzingArtStyle: boolean;



    // Global Selection State
    selectedFrameId: string | null;
    selectedAudioCharacterId: string | null;

    // Actions
    setHasHydrated: (value: boolean) => void;
    setProjects: (projects: Project[]) => void;  // For syncing from backend
    createProject: (title: string, text: string, skipAnalysis?: boolean) => Promise<void>;
    analyzeProject: (script: string) => Promise<void>;
    analyzeArtStyle: (scriptId: string, text: string) => Promise<void>;
    loadProjects: () => void;
    selectProject: (id: string) => Promise<void>;
    updateProject: (id: string, data: Partial<Project>) => void;
    deleteProject: (id: string) => Promise<void>;
    clearCurrentProject: () => void;



    // Selection Actions
    // Selection Actions
    setSelectedFrameId: (id: string | null) => void;
    setSelectedAudioCharacterId: (id: string | null) => void;

    // Asset Generation State
    generatingTasks: { assetId: string; generationType: string; batchSize: number }[];
    addGeneratingTask: (assetId: string, generationType: string, batchSize: number) => void;
    removeGeneratingTask: (assetId: string, generationType: string) => void;

    // Storyboard Frame Rendering State
    renderingFrames: Set<string>;  // Set of frame IDs currently being rendered
    addRenderingFrame: (frameId: string) => void;
    removeRenderingFrame: (frameId: string) => void;

    // Storyboard Analysis State (persists across tab switches)
    isAnalyzingStoryboard: boolean;
    setIsAnalyzingStoryboard: (value: boolean) => void;

    // Series State
    seriesList: Series[];
    currentSeries: Series | null;
    setSeriesList: (seriesList: Series[]) => void;
    fetchSeriesList: () => Promise<Series[]>;
    fetchSeries: (id: string) => Promise<void>;
    createSeries: (title: string, description?: string) => Promise<Series>;
    deleteSeries: (id: string) => Promise<void>;
    setCurrentSeries: (series: Series | null) => void;
}

export const useProjectStore = create<ProjectStore>()(
    persist(
        (set, get) => ({
            projects: [],
            currentProject: null,
            hasHydrated: false,
            isLoading: false,
            isAnalyzing: false,
            selectedFrameId: null,
            selectedAudioCharacterId: null,

            setHasHydrated: (value: boolean) => set({ hasHydrated: value }),

            // Sync projects from backend
            setProjects: (projects: Project[]) => set({ projects: projects.map((project) => normalizeProject(project)) }),

            createProject: async (title: string, text: string, skipAnalysis: boolean = false) => {
                set({ isLoading: true });
                try {
                    const project = await api.createProject(title, text, skipAnalysis);
                    const normalizedProject = normalizeProject(project);
                    set((state) => ({
                        projects: [...state.projects, normalizedProject],
                        currentProject: normalizedProject,
                        isLoading: false,
                    }));
                } catch (error) {
                    console.error('Failed to create project:', error);
                    set({ isLoading: false });
                    throw error;
                }
            },

            analyzeProject: async (script: string) => {
                const { currentProject, createProject } = get();
                set({ isAnalyzing: true });

                try {
                    if (currentProject && currentProject.id) {
                        const receipt = await api.reparseProject(currentProject.id, script);
                        useTaskStore.getState().enqueueReceipts(currentProject.id, [receipt]);
                        const job = await useTaskStore.getState().waitForJob(receipt.job_id, { intervalMs: 2000 });
                        if (job.status !== "succeeded") {
                            throw new Error(job.error_message || "重新解析项目失败");
                        }
                        const project = normalizeProject(
                            mergeProjectDrafts(await api.getProject(currentProject.id), currentProject)
                        );
                        set((state) => ({
                            projects: state.projects.map((p) =>
                                p.id === project.id ? { ...project, updatedAt: new Date().toISOString() } : p
                            ),
                            currentProject: { ...project, updatedAt: new Date().toISOString() }
                        }));
                    } else {
                        // If no current project, create one (assuming title is available or default)
                        // This case might be rare if we always create project first, but handling it just in case
                        await createProject(currentProject?.title || "New Project", script);
                    }
                } catch (error) {
                    console.error("Failed to analyze script:", error);
                    throw error;
                } finally {
                    set({ isAnalyzing: false });
                }
            },

            loadProjects: () => {
                // Projects are already loaded from localStorage via persist middleware
                // This is mainly for future API sync if needed
            },

            selectProject: async (id: string) => {
                // First, try to set from local cache for immediate feedback
                const cachedProject = get().projects.find((p) => p.id === id);
                if (cachedProject) {
                    set({ currentProject: normalizeProject(cachedProject) });
                }

                // Then fetch latest data from backend
                try {
                    const response = await fetch(`${API_URL}/projects/${id}`);
                    if (response.ok) {
                        const rawData = await response.json();
                        // Transform data to match frontend model (snake_case -> camelCase for specific fields)
                        const latestProject = normalizeProject(mergeProjectAssetState(cachedProject, mergeProjectDrafts({
                            ...rawData,
                            originalText: rawData.original_text
                        }, cachedProject)));

                        // Update both currentProject and projects array with latest data
                        set((state) => ({
                            currentProject: latestProject,
                            projects: state.projects.map((p) =>
                                p.id === id ? latestProject : p
                            ),
                        }));
                    }
                } catch (error) {
                    console.error('Failed to fetch latest project data:', error);
                    // Keep using cached version if fetch fails
                }
            },

            updateProject: (id: string, data: Partial<Project>) => {
                const normalizedData = normalizeProject(data);
                set((state) => ({
                    projects: state.projects.map((p) =>
                        p.id === id ? normalizeProject(mergeProjectAssetState(p, { ...normalizedData, updatedAt: new Date().toISOString() })) : p
                    ),
                    currentProject:
                        state.currentProject?.id === id
                            ? normalizeProject(mergeProjectAssetState(state.currentProject, { ...normalizedData, updatedAt: new Date().toISOString() }))
                            : state.currentProject,
                }));
            },

            deleteProject: async (id: string) => {
                try {
                    // Delete from backend first
                    await api.deleteProject(id);
                    // Then remove from local state
                    set((state) => ({
                        projects: state.projects.filter((p) => p.id !== id),
                        currentProject: state.currentProject?.id === id ? null : state.currentProject
                    }));
                } catch (error) {
                    console.error('Failed to delete project from backend:', error);
                    // Still remove from local state for UX, but warn user
                    set((state) => ({
                        projects: state.projects.filter((p) => p.id !== id),
                        currentProject: state.currentProject?.id === id ? null : state.currentProject
                    }));
                }
            },

            isAnalyzingArtStyle: false,

            analyzeArtStyle: async (scriptId: string, text: string) => {
                set({ isAnalyzingArtStyle: true });
                try {
                    const receipt = await api.analyzeScriptForStyles(scriptId, text);
                    useTaskStore.getState().enqueueReceipts(scriptId, [receipt]);
                    const job = await useTaskStore.getState().waitForJob(receipt.job_id, { intervalMs: 2000 });
                    if (job.status !== "succeeded") {
                        throw new Error(job.error_message || "风格分析失败");
                    }
                    const recommendations = job.result_json?.recommendations || [];
                    const current = get().currentProject;
                    if (current) {
                        const updatedArtDirection = {
                            ...current.art_direction,
                            ai_recommendations: recommendations
                        } as ArtDirection;

                        set((state) => ({
                            currentProject: state.currentProject ? {
                                ...state.currentProject,
                                art_direction: updatedArtDirection
                            } : null
                        }));
                    }

                } catch (error) {
                    console.error("Failed to analyze art style:", error);
                    // We could add an error state here if needed
                } finally {
                    set({ isAnalyzingArtStyle: false });
                }
            },

            clearCurrentProject: () => {
                set({ currentProject: null });
            },



            setSelectedFrameId: (id) => set({ selectedFrameId: id }),
            setSelectedAudioCharacterId: (id) => set({ selectedAudioCharacterId: id }),

            // Asset Generation State
            generatingTasks: [],
            addGeneratingTask: (assetId: string, generationType: string, batchSize: number) => set((state) => ({
                generatingTasks: [...state.generatingTasks, { assetId, generationType, batchSize }]
            })),
            removeGeneratingTask: (assetId: string, generationType: string) => set((state) => ({
                generatingTasks: state.generatingTasks.filter((t) => !(t.assetId === assetId && t.generationType === generationType))
            })),

            // Storyboard Frame Rendering State
            renderingFrames: new Set<string>(),
            addRenderingFrame: (frameId: string) => set((state) => {
                const newSet = new Set(state.renderingFrames);
                newSet.add(frameId);
                return { renderingFrames: newSet };
            }),
            removeRenderingFrame: (frameId: string) => set((state) => {
                const newSet = new Set(state.renderingFrames);
                newSet.delete(frameId);
                return { renderingFrames: newSet };
            }),

            // Storyboard Analysis State
            isAnalyzingStoryboard: false,
            setIsAnalyzingStoryboard: (value: boolean) => set({ isAnalyzingStoryboard: value }),

            // Series State
            seriesList: [],
            currentSeries: null,
            setSeriesList: (seriesList: Series[]) => set({ seriesList }),

            fetchSeriesList: async () => {
                try {
                    const seriesList = await api.listSeries();
                    set({ seriesList });
                    return seriesList;
                } catch (error) {
                    console.error('Failed to fetch series list:', error);
                    return [];
                }
            },

            fetchSeries: async (id: string) => {
                try {
                    const series = await api.getSeries(id);
                    set({ currentSeries: series });
                } catch (error) {
                    console.error('Failed to fetch series:', error);
                }
            },

            createSeries: async (title: string, description?: string) => {
                try {
                    const series = await api.createSeries(title, description);
                    set((state) => ({
                        seriesList: [...state.seriesList, series],
                    }));
                    return series;
                } catch (error) {
                    console.error('Failed to create series:', error);
                    throw error;
                }
            },

            deleteSeries: async (id: string) => {
                try {
                    await api.deleteSeries(id);
                    set((state) => ({
                        seriesList: state.seriesList.filter((s) => s.id !== id),
                        currentSeries: state.currentSeries?.id === id ? null : state.currentSeries,
                    }));
                } catch (error) {
                    console.error('Failed to delete series:', error);
                    throw error;
                }
            },

            setCurrentSeries: (series: Series | null) => set({ currentSeries: series }),
        }),
        {
            name: 'project-storage',
            partialize: (state) => ({
                projects: state.projects,
                seriesList: state.seriesList,
                generatingTasks: state.generatingTasks // Now persisting this to maintain state across refreshes
            }),
            onRehydrateStorage: () => (state) => {
                // 等待持久化状态回灌完成后，再让页面决定是否直接复用本地项目缓存。
                state?.setHasHydrated(true);
            },
        }
    )
);
