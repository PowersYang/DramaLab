"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, MapPin, Box, Save, Sparkles, Plus, Trash2, Wand2 } from "lucide-react";
import { api, crudApi } from "@/lib/api";
import BillingActionButton from "@/components/billing/BillingActionButton";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { useProjectStore } from "@/store/projectStore";
import { getEffectiveProjectCharacters } from "@/lib/projectAssets";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

interface ScriptNode {
    type: "character" | "scene" | "prop";
    id?: string;
    name: string;
    desc: string;
    // Extended attributes
    age?: string;
    gender?: string;
    clothing?: string;
    visual_weight?: number;
}

function hasImageVariants(asset?: { variants?: any[] | null; selected_id?: string | null } | null) {
    return Boolean(asset?.selected_id) || Boolean(asset?.variants && asset.variants.length > 0);
}

function hasCharacterAssets(character: any) {
    return Boolean(
        character?.full_body_image_url
        || character?.three_view_image_url
        || character?.headshot_image_url
        || hasImageVariants(character?.full_body_asset)
        || hasImageVariants(character?.three_view_asset)
        || hasImageVariants(character?.headshot_asset)
        || character?.full_body?.selected_image_id
        || character?.head_shot?.selected_image_id
        || (character?.full_body?.image_variants?.length || 0) > 0
        || (character?.head_shot?.image_variants?.length || 0) > 0
        || (character?.three_views?.image_variants?.length || 0) > 0
        || (character?.video_assets?.length || 0) > 0
        || (character?.full_body?.video_variants?.length || 0) > 0
        || (character?.head_shot?.video_variants?.length || 0) > 0
    );
}

function hasSceneAssets(scene: any) {
    return Boolean(
        scene?.image_url
        || hasImageVariants(scene?.image_asset)
        || (scene?.video_assets?.length || 0) > 0
    );
}

function hasPropAssets(prop: any) {
    return Boolean(
        prop?.image_url
        || hasImageVariants(prop?.image_asset)
        || (prop?.video_assets?.length || 0) > 0
    );
}

export default function ScriptProcessor() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const analyzeProject = useProjectStore((state) => state.analyzeProject);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();

    // Initialize from project data
    const [script, setScript] = useState(currentProject?.originalText || "");
    const [nodes, setNodes] = useState<ScriptNode[]>([]);

    // UI State
    const [selectedNode, setSelectedNode] = useState<ScriptNode | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isExtractingEntities, setIsExtractingEntities] = useState(false);
    const showPanel = true;
    const extractTaskPrice = getTaskPrice("project.reparse");
    const extractTaskAffordable = canAffordTask("project.reparse");

    // Sync from project
    useEffect(() => {
        if (currentProject) {
            const effectiveCharacters = getEffectiveProjectCharacters(currentProject);
            setScript(currentProject.originalText || "");
            const newNodes: ScriptNode[] = [
                ...effectiveCharacters.map((c: any) => ({
                    type: "character" as const,
                    id: c.id,
                    name: c.name,
                    desc: c.description,
                    age: c.age,
                    gender: c.gender,
                    clothing: c.clothing,
                    visual_weight: c.visual_weight
                })),
                ...currentProject.scenes.map((s: any) => ({
                    type: "scene" as const,
                    id: s.id,
                    name: s.name,
                    desc: s.description,
                    visual_weight: s.visual_weight
                })),
                ...currentProject.props.map((p: any) => ({
                    type: "prop" as const,
                    id: p.id,
                    name: p.name,
                    desc: p.description
                }))
            ];
            setNodes(newNodes);
        }
    }, [currentProject]); // Depend on the whole object to catch updates

    const handleDeleteNode = async (node: ScriptNode, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject) return;
        const isSeriesSceneOrProp = Boolean(currentProject.series_id && (node.type === "scene" || node.type === "prop"));

        const hasRelatedAssets = (() => {
            if (node.type === "character") {
                const character = getEffectiveProjectCharacters(currentProject).find((item: any) => item.id === node.id);
                return hasCharacterAssets(character);
            }
            if (node.type === "scene") {
                const scene = currentProject.scenes.find((item: any) => item.id === node.id);
                return hasSceneAssets(scene);
            }
            const prop = currentProject.props.find((item: any) => item.id === node.id);
            return hasPropAssets(prop);
        })();

        const hasRelatedFrames = (() => {
            const frames = currentProject.frames || [];
            if (node.type === "character") {
                return frames.some((frame: any) => (frame.character_ids || []).includes(node.id));
            }
            if (node.type === "scene") {
                return frames.some((frame: any) => frame.scene_id === node.id);
            }
            return frames.some((frame: any) => (frame.prop_ids || []).includes(node.id));
        })();

        const baseConfirmMessage = hasRelatedAssets || hasRelatedFrames
            ? `“${node.name}” 已有关联资产或分镜，删除后可能影响已有数据。确认继续删除吗？`
            : `确认删除“${node.name}”吗？`;
        // 中文注释：分集里删除共享场景/道具时，后端默认只清理当前分集引用，不会直接删掉剧集主档。
        const confirmMessage = isSeriesSceneOrProp
            ? `${baseConfirmMessage}\n若该实体来自剧集共享资产，本次操作不会删除剧集主档实体。`
            : baseConfirmMessage;
        if (!confirm(confirmMessage)) return;

        try {
            if (node.type === "character" && node.id) {
                await crudApi.deleteCharacter(currentProject.id, node.id);
            } else if (node.type === "scene" && node.id) {
                await crudApi.deleteScene(currentProject.id, node.id);
            } else if (node.type === "prop" && node.id) {
                await crudApi.deleteProp(currentProject.id, node.id);
            }

            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);

            if (isSeriesSceneOrProp && node.id) {
                const stillExists = node.type === "scene"
                    ? (updatedProject.scenes || []).some((item: any) => item.id === node.id)
                    : (updatedProject.props || []).some((item: any) => item.id === node.id);
                if (stillExists) {
                    const assetLabel = node.type === "scene" ? "场景" : "道具";
                    alert(`当前分集里的“${node.name}”属于剧集共享${assetLabel}，分集删除只会清理当前分镜引用，不会删除剧集资产主档。请前往“剧集资产”页面执行主档删除。`);
                }
            }
        } catch (error) {
            console.error("Failed to delete node:", error);
            alert("删除实体失败");
        }
    };

    const handleCreateNode = async (data: any) => {
        if (!currentProject) return;
        try {
            if (data.type === "character") {
                await crudApi.createCharacter(currentProject.id, data);
            } else if (data.type === "scene") {
                await crudApi.createScene(currentProject.id, data);
            } else if (data.type === "prop") {
                await crudApi.createProp(currentProject.id, data);
            }

            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            setIsCreateDialogOpen(false);
        } catch (error) {
            console.error("Failed to create node:", error);
            alert("创建实体失败");
        }
    };

    const handleNodeUpdate = (updatedNode: ScriptNode) => {
        // Update local state
        setNodes(prev => prev.map(n => n.name === updatedNode.name ? updatedNode : n));
        setSelectedNode(updatedNode);
    };

    const handleExtractEntities = async () => {
        if (!currentProject) return;
        if (!script.trim()) {
            alert("请先输入剧本内容，再提取实体。");
            return;
        }
        if (!extractTaskAffordable) {
            alert("当前算力豆余额不足，暂时无法提取实体。");
            return;
        }

        try {
            // 中文注释：这里统一复用 projectStore 里的 analyzeProject 闭环，让入队、等待任务完成和项目详情刷新继续走同一条链路。
            setIsExtractingEntities(true);
            await analyzeProject(script);
        } catch (error) {
            console.error("Failed to extract entities:", error);
            alert(error instanceof Error ? error.message : "提取实体失败，请稍后重试");
        } finally {
            setIsExtractingEntities(false);
        }
    };

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Left: Script Editor */}
            <div className="flex-1 flex flex-col transition-all duration-300">
                <div className={PANEL_HEADER_CLASS}>
                    <h2 className={`${PANEL_TITLE_CLASS} text-base`}>
                        <Sparkles className="text-primary" size={18} />
                        {currentProject?.title || "剧本编辑器"}
                    </h2>
                    <BillingActionButton
                        onClick={handleExtractEntities}
                        disabled={isExtractingEntities || !script.trim() || !extractTaskAffordable}
                        priceCredits={extractTaskPrice}
                        balanceCredits={account?.balance_credits}
                        className="studio-action-button studio-action-button-warm text-xs disabled:cursor-not-allowed"
                    >
                        <Wand2 size={14} />
                        {isExtractingEntities ? "提取中..." : "提取实体"}
                    </BillingActionButton>
                </div>

                <div className="flex-1 relative p-6">
                    <textarea
                        value={script}
                        onChange={(e) => {
                            const newText = e.target.value;
                            setScript(newText);
                            if (currentProject) {
                                updateProject(currentProject.id, { originalText: newText });
                            }
                        }}
                        placeholder="在此粘贴小说或剧本内容..."
                        className="w-full h-full bg-transparent text-gray-300 font-mono text-base leading-relaxed resize-none focus:outline-none"
                        spellCheck={false}
                    />
                </div>
            </div>

            {/* Right: Entity Intelligence Panel */}
            <AnimatePresence mode="popLayout">
                {showPanel && (
                    <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 400, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="studio-inspector border-l border-white/10 flex flex-col h-full"
                    >
                        <div className={PANEL_HEADER_CLASS}>
                            <h3 className={PANEL_TITLE_CLASS}>实体识别面板</h3>
                            <button
                                onClick={() => setIsCreateDialogOpen(true)}
                                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-gray-300 hover:text-white transition-colors"
                                title="新增实体"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        <div className="studio-panel-subheader px-4 py-2">
                            <p className="text-[11px] text-gray-500">已识别 {nodes.length} 个关键要素</p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                            {nodes.length === 0 && (
                                <div className="text-center text-gray-500 mt-10 text-sm">
                                    暂无已识别要素
                                </div>
                            )}

                            {nodes.map((node, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                    onClick={() => setSelectedNode(node)}
                                    className={`group p-3 rounded-lg border cursor-pointer transition-all hover:bg-white/5 ${selectedNode?.name === node.name
                                        ? "border-primary bg-primary/5"
                                        : "border-white/10 bg-white/5"
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            {node.type === "character" && <User size={14} className="text-blue-400" />}
                                            {node.type === "scene" && <MapPin size={14} className="text-green-400" />}
                                            {node.type === "prop" && <Box size={14} className="text-yellow-400" />}
                                            <span className="font-bold text-sm text-gray-200">{node.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {node.visual_weight && (
                                                <div className="flex gap-0.5">
                                                    {[...Array(5)].map((_, w) => (
                                                        <div key={w} className={`w-1 h-3 rounded-full ${w < (node.visual_weight || 0) ? "bg-primary" : "bg-white/10"}`} />
                                                    ))}
                                                </div>
                                            )}
                                            <button
                                                onClick={(e) => handleDeleteNode(node, e)}
                                                className="p-1 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Delete"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 line-clamp-2">{node.desc}</p>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Floating Attribute Card (Popover) */}
            <AnimatePresence>
                {selectedNode && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedNode(null)}>
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            className="w-[500px] rounded-xl overflow-hidden border border-white/10 bg-black/30 shadow-2xl"
                        >
                            <div className="p-6 border-b border-white/10 bg-black/20 flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${selectedNode.type === "character" ? "bg-blue-500/20 text-blue-400" :
                                            selectedNode.type === "scene" ? "bg-green-500/20 text-green-400" :
                                                "bg-yellow-500/20 text-yellow-400"
                                            }`}>
                                            {selectedNode.type === "character" ? "角色" : selectedNode.type === "scene" ? "场景" : "道具"}
                                        </span>
                                        <h2 className="text-xl font-bold text-white">{selectedNode.name}</h2>
                                    </div>
                                    <p className="text-sm text-gray-400">实体属性配置</p>
                                </div>
                                <button onClick={() => setSelectedNode(null)} className="text-gray-500 hover:text-white">✕</button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">视觉描述</label>
                                    <textarea
                                        value={selectedNode.desc}
                                        onChange={e => handleNodeUpdate({ ...selectedNode, desc: e.target.value })}
                                        className="w-full h-24 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                                    />
                                </div>

                                {selectedNode.type === "character" && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">年龄</label>
                                            <input
                                                type="text"
                                                value={selectedNode.age || ""}
                                                    onChange={e => handleNodeUpdate({ ...selectedNode, age: e.target.value })}
                                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                                                placeholder="e.g. 18"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">性别</label>
                                            <input
                                                type="text"
                                                value={selectedNode.gender || ""}
                                                    onChange={e => handleNodeUpdate({ ...selectedNode, gender: e.target.value })}
                                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                                                placeholder="e.g. Female"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs text-gray-500 mb-1">服装</label>
                                            <input
                                                type="text"
                                                value={selectedNode.clothing || ""}
                                                    onChange={e => handleNodeUpdate({ ...selectedNode, clothing: e.target.value })}
                                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                                                    placeholder="e.g. Black Hoodie"
                                                />
                                        </div>
                                    </div>
                                )}

                                {selectedNode.type !== "prop" && (
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-2">视觉权重</label>
                                        <div className="flex gap-2">
                                            {[1, 2, 3, 4, 5].map(w => (
                                                <button
                                                    key={w}
                                                    onClick={() => handleNodeUpdate({ ...selectedNode, visual_weight: w })}
                                                    className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${(selectedNode.visual_weight || 3) === w
                                                        ? "bg-primary text-white"
                                                        : "bg-white/5 text-gray-500 hover:bg-white/10"
                                                        }`}
                                                >
                                                    {w}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-gray-600 mt-1 text-center">
                                            1: 背景路人 — 3: 重要配角 — 5: 核心主角
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 border-t border-white/10 bg-black/20 flex justify-end">
                                <button
                                    onClick={async () => {
                                        if (currentProject && selectedNode && selectedNode.id) {
                                            try {
                                                // Construct attributes to update
                                                const attributes: any = {
                                                    description: selectedNode.desc,
                                                    visual_weight: selectedNode.visual_weight
                                                };

                                                if (selectedNode.type === "character") {
                                                    attributes.age = selectedNode.age;
                                                    attributes.gender = selectedNode.gender;
                                                    attributes.clothing = selectedNode.clothing;
                                                }

                                                const updatedProject = await api.updateAssetAttributes(
                                                    currentProject.id,
                                                    selectedNode.id,
                                                    selectedNode.type,
                                                    attributes
                                                );

                                                updateProject(currentProject.id, updatedProject);
                                                console.log("Asset attributes updated successfully");
                                                // alert("配置已保存"); // Optional: Feedback
                                                setSelectedNode(null);
                                            } catch (error) {
                                                console.error("Failed to update asset attributes:", error);
                                                alert("保存失败，请重试");
                                            }
                                        } else {
                                            setSelectedNode(null);
                                        }
                                    }}
                                    className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-bold flex items-center gap-2"
                                >
                                    <Save size={14} /> 保存配置
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
            {/* Create Entity Dialog */}
            <AnimatePresence>
                {isCreateDialogOpen && (
                    <CreateEntityDialog
                        onClose={() => setIsCreateDialogOpen(false)}
                        onCreate={handleCreateNode}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function CreateEntityDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (data: any) => void }) {
    const [name, setName] = useState("");
    const [desc, setDesc] = useState("");
    const [type, setType] = useState<"character" | "scene" | "prop">("character");

    const handleSubmit = () => {
        if (!name.trim()) return alert("Name is required");
        onCreate({ name, description: desc, type });
    };

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="w-[400px] rounded-xl border border-white/10 bg-black/30 p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-white">新增实体</h3>

                <div className="flex gap-2 p-1 bg-black/20 rounded-lg">
                    {(["character", "scene", "prop"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setType(t)}
                            className={`flex-1 py-1.5 text-xs font-bold rounded capitalize ${type === t ? "bg-primary text-white" : "text-gray-500 hover:text-white"}`}
                        >
                            {t === "character" ? "角色" : t === "scene" ? "场景" : "道具"}
                        </button>
                    ))}
                </div>

                <div>
                    <label className="text-xs text-gray-500">名称</label>
                    <input
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="输入实体名称"
                    />
                </div>

                <div>
                    <label className="text-xs text-gray-500">描述</label>
                    <textarea
                        className="w-full h-24 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                        value={desc}
                        onChange={e => setDesc(e.target.value)}
                        placeholder="输入视觉描述..."
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white">取消</button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-primary text-white rounded text-xs font-bold">创建</button>
                </div>
            </div>
        </div>
    );
}
