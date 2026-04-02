"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Image as ImageIcon, User, Layout, Eye, Check, RefreshCw } from "lucide-react";

interface UploadAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    assetId: string;
    assetType: "character" | "scene" | "prop";
    assetName: string;
    defaultDescription: string;
    scriptId: string;
    onUploadComplete: (updatedScript: any) => void;
}

const UPLOAD_TYPES = {
    character: [
        { id: "full_body", label: "全身图", icon: User, description: "角色全身立绘" },
        { id: "head_shot", label: "头像特写", icon: Eye, description: "角色头像/面部特写" },
        { id: "three_views", label: "三视图", icon: Layout, description: "角色正面/侧面/背面" },
    ],
    scene: [
        { id: "image", label: "场景图", icon: ImageIcon, description: "场景参考图" },
    ],
    prop: [
        { id: "image", label: "道具图", icon: ImageIcon, description: "道具参考图" },
    ],
};

export default function UploadAssetModal({
    isOpen,
    onClose,
    assetId,
    assetType,
    assetName,
    defaultDescription,
    scriptId,
    onUploadComplete,
}: UploadAssetModalProps) {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [uploadType, setUploadType] = useState<string>(
        assetType === "character" ? "full_body" : "image"
    );
    const [description, setDescription] = useState(defaultDescription);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith("image/")) {
                setError("请选择图片文件");
                return;
            }
            // Validate file size (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                setError("文件大小不能超过 10MB");
                return;
            }
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setError(null);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) {
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
            setError(null);
        }
    }, []);

    const handleUpload = async () => {
        if (!selectedFile) {
            setError("请先选择图片");
            return;
        }

        setIsUploading(true);
        setError(null);

        try {
            // Use api.uploadAsset which uses the correct backend API URL
            const { api } = await import("@/lib/api");
            const updatedScript = await api.uploadAsset(
                scriptId,
                assetType,
                assetId,
                selectedFile,
                uploadType,
                description
            );
            onUploadComplete(updatedScript);
            handleClose();
        } catch (err: any) {
            setError(err.message || "上传失败，请重试");
        } finally {
            setIsUploading(false);
        }
    };

    const handleClose = () => {
        setSelectedFile(null);
        setPreviewUrl(null);
        setError(null);
        setDescription(defaultDescription);
        onClose();
    };

    const uploadTypes = UPLOAD_TYPES[assetType] || [];

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 md:p-8"
                onClick={handleClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="asset-workbench-shell asset-surface-strong border border-white/10 rounded-[32px] w-full max-w-xl overflow-hidden shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* ── Header ── */}
                    <div className="flex h-20 items-center justify-between border-b border-white/5 bg-white/[0.02] px-8">
                        <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <Upload size={20} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white tracking-tight">上传资产</h2>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] mt-0.5">{assetName}</p>
                            </div>
                        </div>
                        <button onClick={handleClose} className="p-2.5 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-all">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        {/* ── Type Selector ── */}
                        {assetType === "character" && (
                            <section className="space-y-4">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Layout size={14} />
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest">资产类型</h3>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    {uploadTypes.map((type) => {
                                        const Icon = type.icon;
                                        const isActive = uploadType === type.id;
                                        return (
                                            <button
                                                key={type.id}
                                                onClick={() => setUploadType(type.id)}
                                                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all duration-300 ${
                                                    isActive 
                                                        ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20" 
                                                        : "bg-white/5 border-white/5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
                                                }`}
                                            >
                                                <Icon size={20} />
                                                <span className="text-[11px] font-bold">{type.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* ── File Upload ── */}
                        <section className="space-y-4">
                            <div className="flex items-center gap-2 text-gray-400">
                                <ImageIcon size={14} />
                                <h3 className="text-[10px] font-bold uppercase tracking-widest">参考图文件</h3>
                            </div>
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className={`group relative aspect-video rounded-3xl border-2 border-dashed transition-all duration-500 cursor-pointer overflow-hidden flex flex-col items-center justify-center gap-4 ${
                                    previewUrl 
                                        ? "border-indigo-500/50 bg-indigo-500/5" 
                                        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5"
                                }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileSelect}
                                    className="hidden"
                                />
                                {previewUrl ? (
                                    <>
                                        <img src={previewUrl} alt="Preview" className="h-full w-full object-contain" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <div className="px-4 py-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-xs font-bold">更换图片</div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="p-5 rounded-2xl bg-white/5 text-gray-500 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-all">
                                            <Upload size={32} strokeWidth={1.5} />
                                        </div>
                                        <div className="text-center px-6">
                                            <p className="text-sm font-bold text-gray-400 group-hover:text-white transition-colors">拖拽或点击上传</p>
                                            <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">JPG, PNG, WebP · Max 10MB</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </section>

                        {/* ── Description ── */}
                        <section className="space-y-4">
                            <div className="flex items-center gap-2 text-gray-400">
                                <Layout size={14} />
                                <h3 className="text-[10px] font-bold uppercase tracking-widest">素材特征描述</h3>
                            </div>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full h-32 bg-black/40 border border-white/10 rounded-[24px] p-5 text-[13px] leading-relaxed text-gray-200 resize-none focus:border-indigo-500/50 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all custom-scrollbar"
                                placeholder="描述素材的核心视觉特征..."
                            />
                        </section>

                        {/* Error Message */}
                        {error && (
                            <motion.div 
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-medium"
                            >
                                {error}
                            </motion.div>
                        )}
                    </div>

                    {/* ── Footer Actions ── */}
                    <div className="p-8 border-t border-white/5 bg-white/[0.02] flex gap-4">
                        <button
                            onClick={handleClose}
                            className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-all"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleUpload}
                            disabled={!selectedFile || isUploading}
                            className={`flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                                !selectedFile || isUploading 
                                    ? "bg-white/5 text-gray-500 border border-white/5 cursor-not-allowed" 
                                    : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20"
                            }`}
                        >
                            {isUploading ? (
                                <RefreshCw size={18} className="animate-spin" />
                            ) : (
                                <Check size={18} />
                            )}
                            {isUploading ? "正在上传" : "确认上传"}
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
