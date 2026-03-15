"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Settings, ChevronDown, ChevronRight, Loader2, Key } from "lucide-react";
import { api } from "@/lib/api";

interface EnvConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isRequired?: boolean;
}

interface EnvConfig {
  DASHSCOPE_API_KEY: string;
  ALIBABA_CLOUD_ACCESS_KEY_ID: string;
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: string;
  OSS_BUCKET_NAME: string;
  OSS_ENDPOINT: string;
  OSS_BASE_PATH: string;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
  VIDU_API_KEY: string;
  endpoint_overrides: Record<string, string>;
  [key: string]: string | Record<string, string>;
}

const ENDPOINT_PROVIDERS = [
  { key: "DASHSCOPE_BASE_URL", label: "DashScope", placeholder: "https://dashscope.aliyuncs.com" },
  { key: "KLING_BASE_URL", label: "Kling", placeholder: "https://api-beijing.klingai.com/v1" },
  { key: "VIDU_BASE_URL", label: "Vidu", placeholder: "https://api.vidu.cn/ent/v2" },
];

export default function EnvConfigDialog({ isOpen, onClose, isRequired = false }: EnvConfigDialogProps) {
  const [config, setConfig] = useState<EnvConfig>({
    DASHSCOPE_API_KEY: "",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "",
    OSS_BUCKET_NAME: "",
    OSS_ENDPOINT: "",
    OSS_BASE_PATH: "",
    KLING_ACCESS_KEY: "",
    KLING_SECRET_KEY: "",
    VIDU_API_KEY: "",
    endpoint_overrides: {},
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.getEnvConfig();
      setConfig({ ...config, ...data, endpoint_overrides: data.endpoint_overrides ?? {} });
    } catch (error) {
      console.error("Failed to load env config:", error);
      setLoadError("Failed to load configuration. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const validateRequiredFields = () => {
    const dashscopeKey = config.DASHSCOPE_API_KEY?.trim();
    const accessKeyId = config.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim();
    const accessKeySecret = config.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim();
    const ossBucket = config.OSS_BUCKET_NAME?.trim();
    const ossEndpoint = config.OSS_ENDPOINT?.trim();

    return dashscopeKey && dashscopeKey.length > 0 &&
      accessKeyId && accessKeyId.length > 0 &&
      accessKeySecret && accessKeySecret.length > 0 &&
      ossBucket && ossBucket.length > 0 &&
      ossEndpoint && ossEndpoint.length > 0;
  };

  const handleSave = async () => {
    if (!validateRequiredFields()) {
      alert("Please fill in all required fields:\n- DashScope API Key\n- Alibaba Cloud Access Key ID\n- Alibaba Cloud Access Key Secret\n- OSS Bucket Name\n- OSS Endpoint");
      return;
    }

    setSaving(true);
    try {
      await api.saveEnvConfig(config);
      alert("Configuration saved successfully!");
      onClose();
      if (isRequired) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Failed to save env config:", error);
      alert("Failed to save configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof EnvConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleEndpointChange = (envKey: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      endpoint_overrides: { ...prev.endpoint_overrides, [envKey]: value },
    }));
  };

  if (!isOpen) return null;

  const inputClass = "w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 transition-colors";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-[#1a1a1a] rounded-2xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-lg">
                <Key size={20} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Environment Configuration</h2>
                <p className="text-xs text-gray-500">Configure API keys and cloud service credentials</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {isRequired && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-300">
                Missing required environment variables. Please fill in the required fields below to continue.
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-amber-400" />
                <span className="ml-2 text-gray-400">Loading configuration...</span>
              </div>
            ) : loadError ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300">
                {loadError}
              </div>
            ) : (
              <>
                {/* DashScope API Key */}
                <div>
                  <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                    <span>DashScope API Key <span className="text-red-500">*</span></span>
                    <span className="text-gray-600 font-normal text-xs">e.g. sk-xxx</span>
                  </label>
                  <input
                    type="password"
                    value={config.DASHSCOPE_API_KEY}
                    onChange={(e) => handleChange("DASHSCOPE_API_KEY", e.target.value)}
                    placeholder="For Qwen and other DashScope models"
                    className={inputClass}
                  />
                </div>

                {/* Alibaba Cloud Access Keys */}
                <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                  <p className="text-xs text-gray-400">For OSS storage service</p>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Alibaba Cloud Access Key ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={config.ALIBABA_CLOUD_ACCESS_KEY_ID}
                      onChange={(e) => handleChange("ALIBABA_CLOUD_ACCESS_KEY_ID", e.target.value)}
                      placeholder="LTAI5t..."
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Alibaba Cloud Access Key Secret <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={config.ALIBABA_CLOUD_ACCESS_KEY_SECRET}
                      onChange={(e) => handleChange("ALIBABA_CLOUD_ACCESS_KEY_SECRET", e.target.value)}
                      placeholder="Access key secret"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* OSS Configuration */}
                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">OSS Configuration</h3>
                    <a
                      href="https://oss.console.aliyun.com/overview"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      Open OSS Console &rarr;
                    </a>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                        <span>OSS Bucket Name <span className="text-red-500">*</span></span>
                        <span className="text-gray-600 font-normal text-xs">e.g. my-comic-bucket</span>
                      </label>
                      <input
                        type="text"
                        value={config.OSS_BUCKET_NAME}
                        onChange={(e) => handleChange("OSS_BUCKET_NAME", e.target.value)}
                        placeholder="your_bucket_name"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                        <span>OSS Endpoint <span className="text-red-500">*</span></span>
                        <span className="text-gray-600 font-normal text-xs">e.g. oss-cn-hangzhou.aliyuncs.com</span>
                      </label>
                      <input
                        type="text"
                        value={config.OSS_ENDPOINT}
                        onChange={(e) => handleChange("OSS_ENDPOINT", e.target.value)}
                        placeholder="oss-cn-beijing.aliyuncs.com"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                        <span>OSS Base Path</span>
                        <span className="text-gray-600 font-normal text-xs">e.g. lumenx</span>
                      </label>
                      <input
                        type="text"
                        value={config.OSS_BASE_PATH}
                        onChange={(e) => handleChange("OSS_BASE_PATH", e.target.value)}
                        placeholder="lumenx"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* Kling Configuration */}
                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">Kling AI</h3>
                    <span className="text-[10px] text-gray-500">Optional &mdash; for Kling video generation</span>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Kling Access Key
                      </label>
                      <input
                        type="password"
                        value={config.KLING_ACCESS_KEY}
                        onChange={(e) => handleChange("KLING_ACCESS_KEY", e.target.value)}
                        placeholder="Kling API Access Key"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Kling Secret Key
                      </label>
                      <input
                        type="password"
                        value={config.KLING_SECRET_KEY}
                        onChange={(e) => handleChange("KLING_SECRET_KEY", e.target.value)}
                        placeholder="Kling API Secret Key"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* Vidu Configuration */}
                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-white">Vidu AI</h3>
                    <span className="text-[10px] text-gray-500">Optional &mdash; for Vidu video generation</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Vidu API Key
                    </label>
                    <input
                      type="password"
                      value={config.VIDU_API_KEY}
                      onChange={(e) => handleChange("VIDU_API_KEY", e.target.value)}
                      placeholder="Vidu API Key"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Advanced: API Endpoints */}
                <div className="pt-4 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setEndpointsOpen(!endpointsOpen)}
                    aria-expanded={endpointsOpen}
                    className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {endpointsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    Advanced: API Endpoints
                  </button>

                  {endpointsOpen && (
                    <div className="mt-4 space-y-4">
                      <p className="text-xs text-gray-500">
                        Custom API endpoint URLs. Leave empty to use defaults. Switch to international endpoints for overseas deployment.
                      </p>
                      {ENDPOINT_PROVIDERS.map(({ key, label, placeholder }) => (
                        <div key={key}>
                          <label className="flex items-center justify-between text-sm font-medium text-gray-300 mb-2">
                            <span>{label} Base URL</span>
                            <span className="text-gray-600 font-normal text-xs">{placeholder}</span>
                          </label>
                          <input
                            type="text"
                            value={config.endpoint_overrides[key] || ""}
                            onChange={(e) => handleEndpointChange(key, e.target.value)}
                            placeholder={placeholder}
                            className={inputClass + " text-sm"}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t border-white/10">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !!loadError}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
