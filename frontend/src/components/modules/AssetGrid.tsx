"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Download, Plus } from "lucide-react";

import BillingTaskHint from "@/components/billing/BillingTaskHint";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { api, API_URL } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";
import { getAssetUrl } from "@/lib/utils";

interface Asset {
    id: string;
    type: "char" | "bg" | "prop";
    url: string;
    title: string;
}

interface AssetGridProps {
    projectId: string | null;
}

export default function AssetGrid({ projectId }: AssetGridProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);

    const [isGenerating, setIsGenerating] = useState(false);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();
    const assetBatchPrice = getTaskPrice("asset.generate_batch");
    const assetBatchAffordable = canAffordTask("asset.generate_batch");

    // Initialize assets from current project
    const [assets, setAssets] = useState<Asset[]>(() => {
        if (!currentProject) return [];
        return [
            ...currentProject.characters.map((c: any) => ({
                id: c.id,
                type: "char" as const,
                url: getAssetUrl(c.image_url),
                title: c.name
            })),
            ...currentProject.scenes.map((s: any) => ({
                id: s.id,
                type: "bg" as const,
                url: getAssetUrl(s.image_url),
                title: s.name
            }))
        ];
    });

    // Update assets when project changes
    useEffect(() => {
        if (currentProject) {
            const newAssets: Asset[] = [
                ...currentProject.characters.map((c: any) => ({
                    id: c.id,
                    type: "char" as const,
                    url: getAssetUrl(c.image_url),
                    title: c.name
                })),
                ...currentProject.scenes.map((s: any) => ({
                    id: s.id,
                    type: "bg" as const,
                    url: getAssetUrl(s.image_url),
                    title: s.name
                }))
            ];
            setAssets(newAssets);
        }
    }, [currentProject?.id, currentProject?.characters, currentProject?.scenes]);

    const handleGenerate = async () => {
        if (!projectId) {
            // Try to find the latest project or alert user
            alert("请先创建脚本！");
            return;
        }
        setIsGenerating(true);
        try {
            const receipt = await api.generateAssets(projectId);
            enqueueReceipts(projectId, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 2000 });
            const project = await api.getProject(projectId);
            const newAssets: Asset[] = [
                ...project.characters.map((c: any) => ({
                    id: c.id,
                    type: "char" as const,
                    url: getAssetUrl(c.image_url),
                    title: c.name
                })),
                ...project.scenes.map((s: any) => ({
                    id: s.id,
                    type: "bg" as const,
                    url: getAssetUrl(s.image_url),
                    title: s.name
                }))
            ];
            setAssets(newAssets);
            if (currentProject) {
                updateProject(currentProject.id, {
                    characters: project.characters,
                    scenes: project.scenes,
                    props: project.props,
                });
            }
            if (job.status !== "succeeded") {
                console.error("Generate assets finished with non-success status:", job.error_message);
            }
        } catch (error) {
            console.error("Failed to generate assets:", error);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-full p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-display font-bold text-white">生成的资源</h2>
                <div className="flex gap-2">
                    <button className="glass-button text-xs flex items-center gap-2">
                        <Plus size={14} /> 上传
                    </button>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || !assetBatchAffordable}
                        className="glass-button text-xs flex items-center gap-2 text-primary border-primary/30"
                        title={!assetBatchAffordable ? "当前组织算力豆余额不足，无法提交批量资产生成任务" : undefined}
                    >
                        <RefreshCw size={14} className={isGenerating ? "animate-spin" : ""} />
                        {isGenerating ? "生成中..." : "生成全部"}
                    </button>
                </div>
            </div>
            <BillingTaskHint
                priceCredits={assetBatchPrice}
                balanceCredits={account?.balance_credits}
                compact
                className="mb-4"
            />

            <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                {assets.map((asset, i) => (
                    <motion.div
                        key={asset.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="break-inside-avoid group relative rounded-xl overflow-hidden bg-white/5 border border-white/5 hover:border-primary/50 transition-all duration-300"
                    >
                        {asset.url ? (
                            <img
                                src={asset.url}
                                alt={asset.title}
                                className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                        ) : (
                            <div className="w-full h-48 bg-white/5 flex items-center justify-center text-xs text-gray-500">
                                生成中...
                            </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                            <h3 className="text-sm font-bold text-white">{asset.title}</h3>
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] font-mono bg-white/10 px-2 py-1 rounded">{asset.type.toUpperCase()}</span>
                                <button className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
                                    <Download size={12} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
