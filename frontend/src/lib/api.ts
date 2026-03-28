import axiosLib from "axios";

// Dynamic API URL detection:
// 1. In packaged app (Electron): Frontend is served by backend, use same origin
// 2. In development (port 3000/3001): Default to direct backend port 17177
const getApiUrl = (): string => {
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && envUrl.trim()) {
        return envUrl.trim().replace(/\/$/, "");
    }

    if (typeof window !== "undefined") {
        if (process.env.NODE_ENV !== "production") {
            // 开发态默认直连后端，避免 Next dev 代理在长耗时接口（如 reparse）上提前断开连接。
            // 如果确实需要继续走代理，可显式设置 NEXT_PUBLIC_USE_DEV_PROXY=true。
            if (process.env.NEXT_PUBLIC_USE_DEV_PROXY === "true") {
                return "/api-proxy";
            }
            return "http://127.0.0.1:17177";
        }

        const { protocol, hostname, port } = window.location;

        if (port === "3000" || port === "3001") {
            return `${protocol}//${hostname}:17177`;
        }

        return `${protocol}//${hostname}${port ? ":" + port : ""}`;
    }

    // SSR 或少量直接请求场景下也保持和开发代理一致，避免前后端连到不同回环地址。
    return "http://127.0.0.1:17177";
};


export const API_URL = getApiUrl();

const LOG_PREFIX = "[lumenx-api]";
const SENSITIVE_KEYWORDS = ["password", "secret", "token", "key", "authorization", "cookie"];

const axios = axiosLib.create();

const formatAxiosError = (error: unknown, fallbackMessage: string): Error => {
    // 统一把代理层、后端状态码和 request_id 拼进错误文案，便于直接在浏览器里定位问题。
    if (!axiosLib.isAxiosError(error)) {
        return error instanceof Error ? error : new Error(fallbackMessage);
    }

    const requestId = error.response?.headers?.["x-request-id"];
    const detail = error.response?.data?.detail;
    const detailMessage =
        typeof detail === "string"
            ? detail
            : typeof detail?.message === "string"
                ? detail.message
                : error.message;
    const requestIdFromBody =
        typeof detail === "object" && detail && typeof detail.request_id === "string"
            ? detail.request_id
            : undefined;

    if (error.response) {
        const resolvedRequestId = requestId || requestIdFromBody;
        return new Error(
            `${fallbackMessage}（status=${error.response.status}` +
            `${resolvedRequestId ? `, request_id=${resolvedRequestId}` : ""}` +
            `${detailMessage ? `, detail=${detailMessage}` : ""}）`
        );
    }

    if (error.request) {
        return new Error(
            `${fallbackMessage}（未收到后端响应，可能是代理断连或服务重启；code=${error.code || "unknown"}` +
            `${requestId ? `, request_id=${requestId}` : ""}` +
            `${error.message ? `, detail=${error.message}` : ""}）`
        );
    }

    return new Error(`${fallbackMessage}（detail=${detailMessage || error.message}）`);
};

const sanitizeForLog = (value: unknown): unknown => {
    // 统一对前端日志里的敏感字段做脱敏，避免在浏览器控制台泄露配置或密钥。
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForLog(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
                key,
                SENSITIVE_KEYWORDS.some((word) => key.toLowerCase().includes(word)) ? "***" : sanitizeForLog(item),
            ])
        );
    }
    return value;
};

const createRequestId = (): string => {
    // 请求 ID 会同步到后端，便于把浏览器日志和服务端日志关联到一起。
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

axios.interceptors.request.use((config) => {
    const requestId = createRequestId();
    const metadata = {
        requestId,
        startedAt: Date.now(),
    };

    config.headers = config.headers ?? {};
    config.headers["X-Request-ID"] = requestId;
    (config as typeof config & { metadata?: typeof metadata }).metadata = metadata;

    console.info(LOG_PREFIX, "request:start", {
        requestId,
        method: config.method,
        url: config.url,
        params: sanitizeForLog(config.params),
        data: sanitizeForLog(config.data),
    });
    return config;
});

axios.interceptors.response.use(
    (response) => {
        const metadata = (response.config as typeof response.config & { metadata?: { requestId: string; startedAt: number } }).metadata;
        const durationMs = metadata ? Date.now() - metadata.startedAt : undefined;

        console.info(LOG_PREFIX, "request:end", {
            requestId: response.headers["x-request-id"] || metadata?.requestId,
            method: response.config.method,
            url: response.config.url,
            status: response.status,
            durationMs,
        });
        return response;
    },
    (error) => {
        const config = error.config as (typeof error.config & { metadata?: { requestId: string; startedAt: number } }) | undefined;
        const durationMs = config?.metadata ? Date.now() - config.metadata.startedAt : undefined;

        console.error(LOG_PREFIX, "request:error", {
            requestId: error.response?.headers?.["x-request-id"] || config?.metadata?.requestId,
            method: config?.method,
            url: config?.url,
            status: error.response?.status,
            durationMs,
            params: sanitizeForLog(config?.params),
            data: sanitizeForLog(config?.data),
            response: sanitizeForLog(error.response?.data),
        });
        return Promise.reject(error);
    }
);

const fetchJson = async (input: string, init?: RequestInit) => {
    const requestId = createRequestId();
    const startedAt = Date.now();
    const headers = new Headers(init?.headers);

    // fetch 场景也保持和 axios 一样的请求 ID 策略，避免日志链路断掉。
    headers.set("X-Request-ID", requestId);

    console.info(LOG_PREFIX, "fetch:start", {
        requestId,
        url: input,
        method: init?.method || "GET",
    });

    const response = await fetch(input, {
        ...init,
        headers,
    });
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
        const errorText = await response.text();
        let parsedError: unknown = errorText;
        try {
            // 后端多数错误会返回 JSON，这里优先保留结构化信息，方便前端日志检索 detail 字段。
            parsedError = errorText ? JSON.parse(errorText) : errorText;
        } catch {
            parsedError = errorText;
        }
        console.error(LOG_PREFIX, "fetch:error", {
            requestId: response.headers.get("x-request-id") || requestId,
            url: input,
            method: init?.method || "GET",
            status: response.status,
            durationMs,
            response: sanitizeForLog(parsedError),
        });
        if (parsedError && typeof parsedError === "object" && "detail" in (parsedError as Record<string, unknown>)) {
            throw new Error(String((parsedError as Record<string, unknown>).detail));
        }
        throw new Error(errorText || `Request failed with status ${response.status}`);
    }

    console.info(LOG_PREFIX, "fetch:end", {
        requestId: response.headers.get("x-request-id") || requestId,
        url: input,
        method: init?.method || "GET",
        status: response.status,
        durationMs,
    });
    return response.json();
};

export interface VideoTask {
    id: string;
    project_id: string;
    asset_id?: string;
    source_job_id?: string;
    provider_task_id?: string;
    image_url: string;
    prompt: string;
    status: "pending" | "processing" | "completed" | "failed";
    video_url?: string;
    failed_reason?: string;
    completed_at?: string;
    duration: number;
    seed?: number;
    resolution: string;
    generate_audio: boolean;
    audio_url?: string;
    prompt_extend: boolean;
    negative_prompt?: string;
    created_at: string | number;
    model?: string;
    frame_id?: string;
    generation_mode?: string;
    reference_video_urls?: string[];
}

export interface TaskReceipt {
    job_id: string;
    task_type: string;
    status: "queued" | "claimed" | "running" | "retry_waiting" | "succeeded" | "failed" | "cancel_requested" | "cancelled" | "timed_out";
    queue_name: string;
    project_id?: string;
    series_id?: string;
    resource_type?: string;
    resource_id?: string;
    source_video_task_id?: string;
    created_at: string | number;
}

export interface TaskJob {
    id: string;
    task_type: string;
    status: TaskReceipt["status"];
    queue_name: string;
    priority: number;
    project_id?: string;
    series_id?: string;
    resource_type?: string;
    resource_id?: string;
    payload_json?: Record<string, any>;
    result_json?: Record<string, any> | null;
    error_code?: string | null;
    error_message?: string | null;
    attempt_count: number;
    max_attempts: number;
    heartbeat_at?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    cancel_requested_at?: string | null;
    created_at: string | number;
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

export const api = {
    createProject: async (title: string, text: string, skipAnalysis: boolean = false) => {
        const res = await axios.post(`${API_URL}/projects`, { title, text }, {
            params: { skip_analysis: skipAnalysis }
        });
        return { ...res.data, originalText: res.data.original_text };
    },

    getProjects: async () => {
        const res = await axios.get(`${API_URL}/projects/`);
        return res.data.map((p: any) => ({ ...p, originalText: p.original_text }));
    },

    getProject: async (scriptId: string) => {
        const res = await axios.get(`${API_URL}/projects/${scriptId}`);
        return { ...res.data, originalText: res.data.original_text };
    },

    deleteProject: async (scriptId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}`);
        return res.data;
    },

    reparseProject: async (scriptId: string, text: string): Promise<TaskReceipt> => {
        try {
            const res = await axios.put(`${API_URL}/projects/${scriptId}/reparse`, { text });
            return res.data;
        } catch (error) {
            // 重新解析是长耗时链路，这里把错误格式化得更明确，便于区分 500 和 socket hang up。
            throw formatAxiosError(error, "重新解析项目失败");
        }
    },

    syncDescriptions: async (scriptId: string): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/sync_descriptions`);
        return res.data;
    },

    generateAssets: async (scriptId: string): Promise<TaskReceipt> => {
        const dedupeKey = `generate-assets:${scriptId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/generate_assets`, undefined, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    createVideoTask: async (
        id: string,
        image_url: string,
        prompt: string,
        duration: number = 5,
        seed?: number,
        resolution: string = "720p",
        generateAudio: boolean = false,
        audioUrl?: string,
        promptExtend: boolean = true,
        negativePrompt?: string,
        batchSize: number = 1,
        model: string = "wan2.6-i2v",
        frameId?: string,
        shotType: string = "single",  // 'single' or 'multi' (only for wan2.6-i2v)
        generationMode: string = "i2v",  // 'i2v' or 'r2v'
        referenceVideoUrls: string[] = [],  // Reference videos for R2V (max 3)
        // Kling params
        mode?: string,
        sound?: boolean,
        cfgScale?: number,
        // Vidu params
        viduAudio?: boolean,
        movementAmplitude?: string
    ): Promise<TaskReceipt[]> => {
        const dedupeKey = `video:${id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${id}/video_tasks`, {
            image_url,
            prompt,
            duration,
            seed,
            resolution,
            generate_audio: generateAudio,
            audio_url: audioUrl,
            prompt_extend: promptExtend,
            negative_prompt: negativePrompt,
            batch_size: batchSize,
            model,
            frame_id: frameId,
            shot_type: shotType,
            generation_mode: generationMode,
            reference_video_urls: referenceVideoUrls,
            // Kling
            mode,
            sound: sound != null ? (sound ? "on" : "off") : undefined,
            cfg_scale: cfgScale,
            // Vidu
            vidu_audio: viduAudio,
            movement_amplitude: movementAmplitude
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    getTask: async (jobId: string): Promise<TaskJob> => {
        const res = await axios.get(`${API_URL}/tasks/${jobId}`);
        return res.data;
    },

    listTasks: async (
        projectId?: string,
        statuses?: string[],
        options?: { seriesId?: string; limit?: number }
    ): Promise<TaskJob[]> => {
        const res = await axios.get(`${API_URL}/tasks`, {
            params: {
                project_id: projectId,
                series_id: options?.seriesId,
                statuses: statuses?.join(","),
                limit: options?.limit,
            },
        });
        return res.data;
    },

    cancelTask: async (jobId: string): Promise<TaskJob> => {
        const res = await axios.post(`${API_URL}/tasks/${jobId}/cancel`);
        return res.data;
    },

    retryTask: async (jobId: string): Promise<TaskJob> => {
        const res = await axios.post(`${API_URL}/tasks/${jobId}/retry`);
        return res.data;
    },


    uploadFile: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        return fetchJson(`${API_URL}/upload`, {
            method: "POST",
            body: formData,
        });
    },

    /**
     * Upload an asset image as a new variant.
     * The uploaded image will be marked as the 'upload source' for reverse generation.
     */
    uploadAsset: async (
        scriptId: string,
        assetType: string,
        assetId: string,
        file: File,
        uploadType: string,
        description?: string
    ) => {
        const formData = new FormData();
        formData.append("file", file);

        const params = new URLSearchParams({
            upload_type: uploadType,
        });
        if (description) {
            params.append("description", description);
        }

        return fetchJson(
            `${API_URL}/projects/${scriptId}/assets/${assetType}/${assetId}/upload?${params.toString()}`,
            {
                method: "POST",
                body: formData,
            }
        );
    },

    generateAsset: async (scriptId: string, assetId: string, assetType: string, stylePreset: string, stylePrompt?: string, generationType: string = "all", prompt: string = "", applyStyle: boolean = true, negativePrompt: string = "", batchSize: number = 1, modelName?: string): Promise<TaskReceipt> => {
        const dedupeKey = `asset:${scriptId}:${assetId}:${generationType}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/generate`, {
            asset_id: assetId,
            asset_type: assetType,
            style_preset: stylePreset,
            style_prompt: stylePrompt,
            generation_type: generationType,
            prompt: prompt,
            apply_style: applyStyle,
            negative_prompt: negativePrompt,
            batch_size: batchSize,
            model_name: modelName
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    getTaskStatus: async (taskId: string): Promise<TaskJob> => api.getTask(taskId),

    generateAssetVideo: async (scriptId: string, assetType: string, assetId: string, data: { prompt?: string, duration?: number, aspect_ratio?: string }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/${assetType}/${assetId}/generate_video`, data);
        return res.data;
    },

    /**
     * Generate Motion Reference video for an asset (Character Full Body/Headshot, Scene, or Prop).
     * This is part of Asset Activation v2.
     */
    generateMotionRef: async (
        scriptId: string,
        assetId: string,
        assetType: 'full_body' | 'head_shot' | 'scene' | 'prop',
        prompt?: string,
        audioUrl?: string,
        duration: number = 5,
        batchSize: number = 1
    ): Promise<TaskReceipt> => {
        const dedupeKey = `motion-ref:${scriptId}:${assetId}:${assetType}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/generate_motion_ref`, {
            asset_id: assetId,
            asset_type: assetType,
            prompt,
            audio_url: audioUrl,
            duration,
            batch_size: batchSize
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    deleteAssetVideo: async (scriptId: string, assetType: string, assetId: string, videoId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}/assets/${assetType}/${assetId}/videos/${videoId}`);
        return res.data;
    },

    toggleAssetLock: async (scriptId: string, assetId: string, assetType: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/toggle_lock`, {
            asset_id: assetId,
            asset_type: assetType
        });
        return res.data;
    },

    updateAssetImage: async (scriptId: string, assetId: string, assetType: string, imageUrl: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/update_image`, {
            asset_id: assetId,
            asset_type: assetType,
            image_url: imageUrl
        });
        return res.data;
    },

    selectAssetVariant: async (scriptId: string, assetId: string, assetType: string, variantId: string, generationType?: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/variant/select`, {
            asset_id: assetId,
            asset_type: assetType,
            variant_id: variantId,
            generation_type: generationType
        });
        return res.data;
    },

    deleteAssetVariant: async (scriptId: string, assetId: string, assetType: string, variantId: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/variant/delete`, {
            asset_id: assetId,
            asset_type: assetType,
            variant_id: variantId
        });
        return res.data;
    },

    favoriteAssetVariant: async (scriptId: string, assetId: string, assetType: string, variantId: string, isFavorited: boolean, generationType?: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/variant/favorite`, {
            asset_id: assetId,
            asset_type: assetType,
            variant_id: variantId,
            is_favorited: isFavorited,
            generation_type: generationType
        });
        return res.data;
    },

    updateModelSettings: async (
        scriptId: string,
        t2iModel?: string,
        i2iModel?: string,
        i2vModel?: string,
        characterAspectRatio?: string,
        sceneAspectRatio?: string,
        propAspectRatio?: string,
        storyboardAspectRatio?: string
    ) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/model_settings`, {
            t2i_model: t2iModel,
            i2i_model: i2iModel,
            i2v_model: i2vModel,
            character_aspect_ratio: characterAspectRatio,
            scene_aspect_ratio: sceneAspectRatio,
            prop_aspect_ratio: propAspectRatio,
            storyboard_aspect_ratio: storyboardAspectRatio
        });
        return res.data;
    },

    getPromptConfig: async (scriptId: string) => {
        const res = await axios.get(`${API_URL}/projects/${scriptId}/prompt_config`);
        return res.data;
    },

    updatePromptConfig: async (scriptId: string, config: { storyboard_polish?: string; video_polish?: string; r2v_polish?: string }) => {
        const res = await axios.put(`${API_URL}/projects/${scriptId}/prompt_config`, config);
        return res.data;
    },

    selectVideo: async (scriptId: string, frameId: string, videoId: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames/${frameId}/select_video`, {
            video_id: videoId
        });
        return res.data;
    },

    mergeVideos: async (scriptId: string, finalMixTimeline?: FinalMixTimelineDraft | null): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/merge`, {
            final_mix_timeline: finalMixTimeline || undefined,
        });
        return res.data;
    },

    // Art Direction APIs
    analyzeScriptForStyles: async (scriptId: string, scriptText: string): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/art_direction/analyze`, {
            script_text: scriptText
        });
        return res.data;
    },

    saveArtDirection: async (scriptId: string, selectedStyleId: string, styleConfig: any, customStyles: any[] = [], aiRecommendations: any[] = []) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/art_direction/save`, {
            selected_style_id: selectedStyleId,
            style_config: styleConfig,
            custom_styles: customStyles,
            ai_recommendations: aiRecommendations
        });
        return res.data;
    },

    getStylePresets: async () => {
        const res = await axios.get(`${API_URL}/art_direction/presets`);
        return res.data;
    },

    // NOTE: polishPrompt removed - use refineFramePrompt for storyboard prompts
    polishVideoPrompt: async (draftPrompt: string, feedback: string = "", scriptId: string = ""): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/video/polish_prompt`, {
            draft_prompt: draftPrompt,
            feedback: feedback,
            script_id: scriptId,
        });
        return res.data;
    },
    polishR2VPrompt: async (draftPrompt: string, slots: { description: string }[], feedback: string = "", scriptId: string = ""): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/video/polish_r2v_prompt`, {
            draft_prompt: draftPrompt,
            slots: slots,
            feedback: feedback,
            script_id: scriptId,
        });
        return res.data;
    },
    updateAssetDescription: async (scriptId: string, assetId: string, assetType: string, description: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/update_description`, {
            asset_id: assetId,
            asset_type: assetType,
            description: description
        });
        return res.data;
    },

    updateAssetAttributes: async (scriptId: string, assetId: string, assetType: string, attributes: any) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/assets/update_attributes`, {
            asset_id: assetId,
            asset_type: assetType,
            attributes: attributes
        });
        return res.data;
    },

    toggleFrameLock: async (scriptId: string, frameId: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames/toggle_lock`, {
            frame_id: frameId
        });
        return res.data;
    },

    updateFrame: async (scriptId: string, frameId: string, data: {
        image_prompt?: string;
        action_description?: string;
        dialogue?: string;
        camera_angle?: string;
        scene_id?: string;
        character_ids?: string[];
    }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames/update`, {
            frame_id: frameId,
            ...data
        });
        return res.data;
    },

    updateProjectStyle: async (scriptId: string, stylePreset: string, stylePrompt?: string) => {
        const res = await axios.patch(`${API_URL}/projects/${scriptId}/style`, {
            style_preset: stylePreset,
            style_prompt: stylePrompt
        });
        return res.data;
    },

    renderFrame: async (scriptId: string, frameId: string, compositionData: any, prompt: string, batchSize: number = 1): Promise<TaskReceipt> => {
        const dedupeKey = `storyboard-render:${scriptId}:${frameId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/storyboard/render`, {
            frame_id: frameId,
            composition_data: compositionData,
            prompt: prompt,
            batch_size: batchSize
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    // === STORYBOARD DRAMATIZATION v2 ===

    /**
     * Analyzes script text and generates storyboard frames using AI.
     * Replaces existing frames with newly generated ones.
     */
    analyzeToStoryboard: async (scriptId: string, text: string): Promise<TaskReceipt> => {
        const dedupeKey = `storyboard-analyze:${scriptId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/storyboard/analyze`, {
            text: text
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    /**
     * 提交分镜提示词润色任务，完成后 result_json 中会回填双语提示词。
     */
    refineFramePrompt: async (scriptId: string, frameId: string, rawPrompt: string, assets: any[] = [], feedback: string = ""): Promise<TaskReceipt> => {
        const dedupeKey = `storyboard-refine:${scriptId}:${frameId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/storyboard/refine_prompt`, {
            frame_id: frameId,
            raw_prompt: rawPrompt,
            assets: assets,
            feedback: feedback
        }, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    generateStoryboard: async (scriptId: string): Promise<TaskReceipt> => {
        const dedupeKey = `generate-storyboard:${scriptId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        const res = await axios.post(`${API_URL}/projects/${scriptId}/generate_storyboard`, undefined, {
            headers: {
                "Idempotency-Key": dedupeKey,
            },
        });
        return res.data;
    },

    getVoices: async () => {
        return fetchJson(`${API_URL}/voices`);
    },

    bindVoice: async (scriptId: string, charId: string, voiceId: string, voiceName: string) => {
        return fetchJson(`${API_URL}/projects/${scriptId}/characters/${charId}/voice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ voice_id: voiceId, voice_name: voiceName }),
        });
    },

    generateAudio: async (scriptId: string): Promise<TaskReceipt> => {
        return fetchJson(`${API_URL}/projects/${scriptId}/generate_audio`, {
            method: "POST",
        });
    },

    generateLineAudio: async (scriptId: string, frameId: string, speed: number, pitch: number, volume: number = 50): Promise<TaskReceipt> => {
        return fetchJson(`${API_URL}/projects/${scriptId}/frames/${frameId}/audio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ speed, pitch, volume }),
        });
    },

    updateVoiceParams: async (scriptId: string, charId: string, speed: number, pitch: number, volume: number) => {
        return fetchJson(`${API_URL}/projects/${scriptId}/characters/${charId}/voice_params`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ speed, pitch, volume }),
        });
    },

    exportProject: async (scriptId: string, options: any): Promise<TaskReceipt> => {
        return fetchJson(`${API_URL}/projects/${scriptId}/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options),
        });
    },

    generateVideo: async (scriptId: string): Promise<TaskReceipt> => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/generate_video`);
        return res.data;
    },

    getEnvConfig: async () => {
        const res = await axios.get(`${API_URL}/config/env`);
        return res.data;
    },

    saveEnvConfig: async (config: Record<string, string | Record<string, string> | undefined>) => {
        const res = await axios.post(`${API_URL}/config/env`, config, {
            timeout: 60000, // 60 seconds timeout
        });
        return res.data;
    },

    extractLastFrame: async (scriptId: string, frameId: string, videoTaskId: string) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames/${frameId}/extract_last_frame`, {
            video_task_id: videoTaskId,
        });
        return res.data;
    },

    uploadFrameImage: async (scriptId: string, frameId: string, file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        return fetchJson(
            `${API_URL}/projects/${scriptId}/frames/${frameId}/upload_image`,
            { method: "POST", body: formData }
        );
    },

    // ============================================
    // Series APIs
    // ============================================

    // Series CRUD
    createSeries: async (title: string, description?: string) => {
        const response = await axios.post(`${API_URL}/series`, { title, description });
        return response.data;
    },
    listSeries: async () => {
        const response = await axios.get(`${API_URL}/series`);
        return response.data;
    },
    getSeries: async (seriesId: string) => {
        const response = await axios.get(`${API_URL}/series/${seriesId}`);
        return response.data;
    },
    updateSeries: async (seriesId: string, data: { title?: string; description?: string }) => {
        const response = await axios.put(`${API_URL}/series/${seriesId}`, data);
        return response.data;
    },
    deleteSeries: async (seriesId: string) => {
        const response = await axios.delete(`${API_URL}/series/${seriesId}`);
        return response.data;
    },

    // Series Episodes
    getSeriesEpisodes: async (seriesId: string) => {
        const response = await axios.get(`${API_URL}/series/${seriesId}/episodes`);
        return response.data;
    },
    addEpisodeToSeries: async (seriesId: string, scriptId: string, episodeNumber?: number) => {
        const response = await axios.post(`${API_URL}/series/${seriesId}/episodes`, { script_id: scriptId, episode_number: episodeNumber });
        return response.data;
    },
    removeEpisodeFromSeries: async (seriesId: string, scriptId: string) => {
        const response = await axios.delete(`${API_URL}/series/${seriesId}/episodes/${scriptId}`);
        return response.data;
    },

    // Series Assets
    getSeriesAssets: async (seriesId: string) => {
        const response = await axios.get(`${API_URL}/series/${seriesId}/assets`);
        return response.data;
    },
    importSeriesAssets: async (seriesId: string, sourceSeriesId: string, assetIds: string[]): Promise<TaskReceipt> => {
        const response = await axios.post(`${API_URL}/series/${seriesId}/assets/import`, { source_series_id: sourceSeriesId, asset_ids: assetIds });
        return response.data;
    },

    // Series Prompt Config
    getSeriesPromptConfig: async (seriesId: string) => {
        const response = await axios.get(`${API_URL}/series/${seriesId}/prompt_config`);
        return response.data;
    },
    updateSeriesPromptConfig: async (seriesId: string, config: { storyboard_polish?: string; video_polish?: string; r2v_polish?: string }) => {
        const response = await axios.put(`${API_URL}/series/${seriesId}/prompt_config`, config);
        return response.data;
    },
    getSeriesModelSettings: async (seriesId: string) => {
        const response = await axios.get(`${API_URL}/series/${seriesId}/model_settings`);
        return response.data;
    },
    updateSeriesModelSettings: async (seriesId: string, settings: {
        t2i_model?: string;
        i2i_model?: string;
        i2v_model?: string;
        character_aspect_ratio?: string;
        scene_aspect_ratio?: string;
        prop_aspect_ratio?: string;
        storyboard_aspect_ratio?: string;
    }) => {
        const response = await axios.put(`${API_URL}/series/${seriesId}/model_settings`, settings);
        return response.data;
    },

    // Helper: create a project and add it as an episode to a series
    createEpisodeForSeries: async (seriesId: string, title: string, episodeNumber: number) => {
        const project = await api.createProject(title, "", true);
        await api.addEpisodeToSeries(seriesId, project.id, episodeNumber);
        return project;
    },

    // File Import
    importFilePreview: async (file: File, suggestedEpisodes: number = 3): Promise<TaskReceipt> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post(`${API_URL}/series/import/preview?suggested_episodes=${suggestedEpisodes}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return response.data;
    },
    importFileConfirm: async (data: { title: string; description?: string; text: string; episodes: any[]; import_id?: string }): Promise<TaskReceipt> => {
        const response = await axios.post(`${API_URL}/series/import/confirm`, data);
        return response.data;
    },
};

// ============================================
// CRUD APIs for Assets and Frames
// ============================================

export const crudApi = {
    // Character CRUD
    createCharacter: async (scriptId: string, data: {
        name: string;
        description?: string;
        age?: string;
        gender?: string;
        clothing?: string;
    }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/characters`, data);
        return res.data;
    },

    deleteCharacter: async (scriptId: string, characterId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}/characters/${characterId}`);
        return res.data;
    },

    // Scene CRUD
    createScene: async (scriptId: string, data: {
        name: string;
        description?: string;
        time_of_day?: string;
        lighting_mood?: string;
    }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/scenes`, data);
        return res.data;
    },

    deleteScene: async (scriptId: string, sceneId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}/scenes/${sceneId}`);
        return res.data;
    },

    // Prop CRUD
    createProp: async (scriptId: string, data: {
        name: string;
        description?: string;
    }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/props`, data);
        return res.data;
    },

    deleteProp: async (scriptId: string, propId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}/props/${propId}`);
        return res.data;
    },

    // Frame CRUD
    createFrame: async (scriptId: string, data: {
        scene_id: string;
        action_description: string;
        character_ids?: string[];
        prop_ids?: string[];
        dialogue?: string;
        speaker?: string;
        camera_angle?: string;
        insert_at?: number;
    }) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames`, data);
        return res.data;
    },

    deleteFrame: async (scriptId: string, frameId: string) => {
        const res = await axios.delete(`${API_URL}/projects/${scriptId}/frames/${frameId}`);
        return res.data;
    },

    copyFrame: async (scriptId: string, frameId: string, insertAt?: number) => {
        const res = await axios.post(`${API_URL}/projects/${scriptId}/frames/copy`, {
            frame_id: frameId,
            insert_at: insertAt
        });
        return res.data;
    },

    reorderFrames: async (scriptId: string, frameIds: string[]) => {
        const res = await axios.put(`${API_URL}/projects/${scriptId}/frames/reorder`, {
            frame_ids: frameIds
        });
        return res.data;
    }
};
