"use client";

import { useState, useEffect } from "react";
import { Save, Settings, MessageSquareCode } from "lucide-react";
import { T2I_MODELS, I2I_MODELS, I2V_MODELS, ASPECT_RATIOS } from "@/store/projectStore";
import { Image, Video, Layout, Check, User, Building, Box } from "lucide-react";

const LS_KEY_MODEL = "dramalab_default_model_settings";
const LEGACY_LS_KEY_MODEL = "lumenx_default_model_settings";
const LS_KEY_PROMPT = "dramalab_default_prompt_config";
const LEGACY_LS_KEY_PROMPT = "lumenx_default_prompt_config";

interface DefaultModelSettings {
  t2i_model: string;
  i2i_model: string;
  i2v_model: string;
  character_aspect_ratio: string;
  scene_aspect_ratio: string;
  prop_aspect_ratio: string;
  storyboard_aspect_ratio: string;
}

interface DefaultPromptConfig {
  storyboard_polish: string;
  video_polish: string;
  r2v_polish: string;
}

function loadFromLS<T>(keys: string[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        return JSON.parse(raw) as T;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export default function SettingsPage() {
  // ── Default Model Settings ──
  const [modelSettings, setModelSettings] = useState<DefaultModelSettings>({
    t2i_model: "wan2.5-t2i-preview",
    i2i_model: "wan2.5-i2i-preview",
    i2v_model: "wan2.5-i2v-preview",
    character_aspect_ratio: "9:16",
    scene_aspect_ratio: "16:9",
    prop_aspect_ratio: "1:1",
    storyboard_aspect_ratio: "16:9",
  });

  // ── Default Prompt Config ──
  const [promptConfig, setPromptConfig] = useState<DefaultPromptConfig>({ storyboard_polish: "", video_polish: "", r2v_polish: "" });

  useEffect(() => {
    // 中文注释：默认设置延后到挂载后恢复，避免 localStorage 让首屏 hydration 前后不一致。
    setModelSettings(
      loadFromLS([LS_KEY_MODEL, LEGACY_LS_KEY_MODEL], {
        t2i_model: "wan2.5-t2i-preview",
        i2i_model: "wan2.5-i2i-preview",
        i2v_model: "wan2.5-i2v-preview",
        character_aspect_ratio: "9:16",
        scene_aspect_ratio: "16:9",
        prop_aspect_ratio: "1:1",
        storyboard_aspect_ratio: "16:9",
      })
    );
    setPromptConfig(loadFromLS([LS_KEY_PROMPT, LEGACY_LS_KEY_PROMPT], { storyboard_polish: "", video_polish: "", r2v_polish: "" }));
  }, []);

  const handleSaveModelDefaults = () => {
    // 中文注释：统一写入新品牌键名，并清掉旧键，避免后续读取来源分叉。
    localStorage.setItem(LS_KEY_MODEL, JSON.stringify(modelSettings));
    localStorage.removeItem(LEGACY_LS_KEY_MODEL);
    alert("Default model settings saved!");
  };

  const handleSavePromptDefaults = () => {
    // 中文注释：提示词默认值沿用同一套迁移策略，保证旧浏览器缓存平滑切换。
    localStorage.setItem(LS_KEY_PROMPT, JSON.stringify(promptConfig));
    localStorage.removeItem(LEGACY_LS_KEY_PROMPT);
    alert("Default prompt configuration saved!");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl space-y-8">
      <h1 className="text-2xl font-display font-bold text-white">设置</h1>
      <section className="glass-panel rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg">
            <Settings size={20} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">默认模型设置</h2>
            <p className="text-xs text-gray-500">Default models and aspect ratios for new projects</p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Image size={16} className="text-green-400" />
            <span>Text-to-Image Model</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {T2I_MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => setModelSettings((s) => ({ ...s, t2i_model: model.id }))}
                className={`relative flex flex-col items-start p-3 rounded-lg border transition-all text-left ${modelSettings.t2i_model === model.id ? "border-green-500/50 bg-green-500/10" : "border-white/10 hover:border-white/20 bg-white/5"}`}
              >
                {modelSettings.t2i_model === model.id && <div className="absolute top-2 right-2"><Check size={14} className="text-green-400" /></div>}
                <span className="text-sm font-medium text-white">{model.name}</span>
                <span className="text-xs text-gray-500">{model.description}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4">
            {(
              [
                { key: "character_aspect_ratio" as const, label: "Character", icon: User },
                { key: "scene_aspect_ratio" as const, label: "Scene", icon: Building },
                { key: "prop_aspect_ratio" as const, label: "Prop", icon: Box },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center gap-1 text-xs text-gray-400"><Icon size={12} /><label>{label}</label></div>
                <div className="space-y-1">
                  {ASPECT_RATIOS.map((ratio) => (
                    <button key={ratio.id} onClick={() => setModelSettings((s) => ({ ...s, [key]: ratio.id }))} className={`w-full flex flex-col items-center py-2 px-2 rounded border transition-all ${modelSettings[key] === ratio.id ? "border-green-500/50 bg-green-500/10" : "border-white/10 hover:border-white/20 bg-white/5"}`}>
                      <span className="text-xs font-medium text-white">{ratio.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Layout size={16} className="text-blue-400" />
              <span>Storyboard (Image-to-Image)</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {I2I_MODELS.map((model) => (
                <button key={model.id} onClick={() => setModelSettings((s) => ({ ...s, i2i_model: model.id }))} className={`relative flex flex-col items-start p-3 rounded-lg border transition-all text-left ${modelSettings.i2i_model === model.id ? "border-blue-500/50 bg-blue-500/10" : "border-white/10 hover:border-white/20 bg-white/5"}`}>
                  {modelSettings.i2i_model === model.id && <div className="absolute top-2 right-2"><Check size={14} className="text-blue-400" /></div>}
                  <span className="text-sm font-medium text-white">{model.name}</span>
                  <span className="text-xs text-gray-500">{model.description}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <label className="text-xs text-gray-400">Storyboard Aspect Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                {ASPECT_RATIOS.map((ratio) => (
                  <button key={ratio.id} onClick={() => setModelSettings((s) => ({ ...s, storyboard_aspect_ratio: ratio.id }))} className={`flex flex-col items-center p-3 rounded-lg border transition-all ${modelSettings.storyboard_aspect_ratio === ratio.id ? "border-blue-500/50 bg-blue-500/10" : "border-white/10 hover:border-white/20 bg-white/5"}`}>
                    <span className="text-sm font-medium text-white">{ratio.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Video size={16} className="text-purple-400" />
              <span>Motion (Image-to-Video)</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {I2V_MODELS.map((model) => (
                <button key={model.id} onClick={() => setModelSettings((s) => ({ ...s, i2v_model: model.id }))} className={`relative flex flex-col items-start p-3 rounded-lg border transition-all text-left ${modelSettings.i2v_model === model.id ? "border-purple-500/50 bg-purple-500/10" : "border-white/10 hover:border-white/20 bg-white/5"}`}>
                  {modelSettings.i2v_model === model.id && <div className="absolute top-2 right-2"><Check size={14} className="text-purple-400" /></div>}
                  <span className="text-sm font-medium text-white">{model.name}</span>
                  <span className="text-xs text-gray-500">{model.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSaveModelDefaults} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-sm font-medium rounded-lg transition-all">
            <Save size={16} />
            Save Defaults
          </button>
        </div>
      </section>

      <section className="glass-panel rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <MessageSquareCode size={20} className="text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">默认提示词配置</h2>
            <p className="text-xs text-gray-500">Default system prompts for new projects (leave empty for built-in defaults)</p>
          </div>
        </div>

        {(
          [
            { key: "storyboard_polish" as const, label: "Storyboard Polish", desc: "System prompt for storyboard/image prompt polishing" },
            { key: "video_polish" as const, label: "Video I2V Polish", desc: "System prompt for Image-to-Video prompt polishing" },
            { key: "r2v_polish" as const, label: "Video R2V Polish", desc: "System prompt for Reference-to-Video prompt polishing" },
          ] as const
        ).map((section) => (
          <div key={section.key} className="space-y-2">
            <h3 className="text-sm font-bold text-white">{section.label}</h3>
            <p className="text-[10px] text-gray-500">{section.desc}</p>
            <textarea
              value={promptConfig[section.key]}
              onChange={(e) => setPromptConfig((prev) => ({ ...prev, [section.key]: e.target.value }))}
              placeholder="Leave empty to use system default..."
              className="w-full h-32 bg-black/30 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-y focus:outline-none focus:border-purple-500/50 font-mono placeholder-gray-600"
            />
          </div>
        ))}

        <div className="flex justify-end">
          <button onClick={handleSavePromptDefaults} className="px-6 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-2">
            <Save size={16} />
            Save Defaults
          </button>
        </div>
      </section>

      <div className="pb-8" />
    </div>
  );
}
