import { useState } from "react";
import { Download, Film, CheckCircle, FileVideo, Monitor, Captions } from "lucide-react";
import clsx from "clsx";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { getAssetUrl } from "@/lib/utils";

export default function ExportStudio() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const fetchJob = useTaskStore((state) => state.fetchJob);

    const [isExporting, setIsExporting] = useState(false);
    const [exportUrl, setExportUrl] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    // Config State
    const [resolution, setResolution] = useState("1080p");
    const [format, setFormat] = useState("mp4");
    const [subtitles, setSubtitles] = useState("burn-in");

    // If project already has a merged video, show it immediately
    const effectiveUrl = exportUrl || currentProject?.merged_video_url || null;

    const waitForJob = async (jobId: string) => {
        for (let attempt = 0; attempt < 180; attempt += 1) {
            const job = await fetchJob(jobId);
            if (["succeeded", "failed", "cancelled", "timed_out"].includes(job.status)) {
                return job;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        throw new Error("导出任务等待超时");
    };

    const handleExport = async () => {
        if (!currentProject) return;
        setIsExporting(true);
        setExportUrl(null);
        setExportError(null);

        try {
            const receipt = await api.exportProject(currentProject.id, { resolution, format, subtitles });
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id);
            if (job.status !== "succeeded") {
                throw new Error(job.error_message || "导出失败");
            }
            const nextUrl = job.result_json?.url || null;
            if (nextUrl) {
                setExportUrl(nextUrl);
            }
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Export failed:", error);
            setExportError(error?.message || "Export failed. Please check that videos have been generated.");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex h-full text-white">
            {/* Left: Configuration */}
            <div className="w-96 border-r border-white/10 bg-black/20 p-8 flex flex-col">
                <h2 className="text-2xl font-display font-bold mb-8 flex items-center gap-3">
                    <Film className="text-primary" /> Export Studio
                </h2>

                <div className="space-y-8 flex-1">
                    {/* Resolution */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-gray-400 flex items-center gap-2">
                            <Monitor size={16} /> Resolution
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {["1080p", "4K"].map(res => (
                                <button
                                    key={res}
                                    onClick={() => setResolution(res)}
                                    className={clsx(
                                        "py-3 px-4 rounded-xl border text-sm font-bold transition-all",
                                        resolution === res
                                            ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                                            : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
                                    )}
                                >
                                    {res}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Format */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-gray-400 flex items-center gap-2">
                            <FileVideo size={16} /> Format
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {["mp4", "mov", "gif"].map(fmt => (
                                <button
                                    key={fmt}
                                    onClick={() => setFormat(fmt)}
                                    className={clsx(
                                        "py-3 px-4 rounded-xl border text-sm font-bold uppercase transition-all",
                                        format === fmt
                                            ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                                            : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
                                    )}
                                >
                                    {fmt}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Subtitles */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-gray-400 flex items-center gap-2">
                            <Captions size={16} /> Subtitles
                        </label>
                        <div className="space-y-2">
                            {[
                                { id: "burn-in", label: "Burn-in (Hardcoded)" },
                                { id: "srt", label: "Export .SRT File" },
                                { id: "none", label: "None" }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => setSubtitles(opt.id)}
                                    className={clsx(
                                        "w-full py-3 px-4 rounded-xl border text-sm font-medium text-left transition-all",
                                        subtitles === opt.id
                                            ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                                            : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="w-full bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-8"
                >
                    {isExporting ? "Rendering..." : "Start Render"}
                </button>
            </div>

            {/* Right: Preview & Status */}
            <div className="flex-1 flex items-center justify-center relative overflow-hidden">
                {/* Background Glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-purple-900/10 pointer-events-none" />

                <div className="w-full max-w-2xl p-8 text-center space-y-8 relative z-10">
                    {isExporting ? (
                        <div className="bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl p-12 shadow-2xl">
                            <div className="w-24 h-24 border-4 border-white/10 border-t-primary rounded-full animate-spin mx-auto mb-8" />
                            <h3 className="text-2xl font-bold mb-2">Rendering Your Masterpiece</h3>
                            <p className="text-gray-400">Stitching video, mixing audio, and burning subtitles...</p>
                        </div>
                    ) : exportError ? (
                        <div className="bg-black/30 backdrop-blur-xl border border-red-500/30 rounded-2xl p-12 shadow-2xl shadow-red-900/20">
                            <div className="w-20 h-20 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Film size={40} />
                            </div>
                            <h3 className="text-2xl font-bold mb-2 text-white">Export Failed</h3>
                            <p className="text-gray-400 mb-4">{exportError}</p>
                            <button
                                onClick={handleExport}
                                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold transition-colors"
                            >
                                Retry
                            </button>
                        </div>
                    ) : effectiveUrl ? (
                        <div className="bg-black/30 backdrop-blur-xl border border-green-500/30 rounded-2xl p-12 shadow-2xl shadow-green-900/20">
                            <div className="w-20 h-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle size={40} />
                            </div>
                            <h3 className="text-2xl font-bold mb-2 text-white">Export Complete!</h3>
                            <p className="text-gray-400 mb-8">Your video is ready to be shared with the world.</p>

                            <a
                                href={getAssetUrl(effectiveUrl)}
                                target="_blank"
                                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-8 py-4 rounded-xl font-bold text-lg transition-colors shadow-lg shadow-green-600/20"
                            >
                                <Download size={20} /> Download Video
                            </a>
                        </div>
                    ) : (
                        <div className="opacity-50">
                            <Film size={64} className="mx-auto mb-4 text-gray-600" />
                            <p className="text-gray-500">Configure your export settings and click "Start Render"</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
