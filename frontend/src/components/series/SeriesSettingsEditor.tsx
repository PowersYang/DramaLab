"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Image as ImageIcon, Layout, Loader2, User, Building, Box, Video } from "lucide-react";

import { api } from "@/lib/api";
import { ASPECT_RATIOS, type Series } from "@/store/projectStore";
import { useAvailableModelCatalog } from "@/lib/modelCatalog";

interface SeriesSettingsEditorProps {
  series: Series;
  onUpdated?: (nextSeries: Series) => void;
}

interface SettingsMessageState {
  type: "success" | "error";
  text: string;
}

// 中文注释：剧集设置现在是一级页面，所以把原先弹窗内的读写逻辑收成页面级编辑器，
// 既保留既有接口契约，也让视觉和“美术设定”保持同一层级。
export default function SeriesSettingsEditor({ series, onUpdated }: SeriesSettingsEditorProps) {
  const [t2iModel, setT2iModel] = useState("wan2.5-t2i-preview");
  const [i2iModel, setI2iModel] = useState("wan2.5-i2i-preview");
  const [i2vModel, setI2vModel] = useState("wan2.5-i2v-preview");
  const [characterAspectRatio, setCharacterAspectRatio] = useState("9:16");
  const [sceneAspectRatio, setSceneAspectRatio] = useState("16:9");
  const [propAspectRatio, setPropAspectRatio] = useState("1:1");
  const [storyboardAspectRatio, setStoryboardAspectRatio] = useState("16:9");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<SettingsMessageState | null>(null);

  const { catalog } = useAvailableModelCatalog({
    t2i: t2iModel,
    i2i: i2iModel,
    i2v: i2vModel,
  });

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await api.getSeriesModelSettings(series.id);
        if (!data || cancelled) {
          return;
        }
        setT2iModel(data.t2i_model || "wan2.5-t2i-preview");
        setI2iModel(data.i2i_model || "wan2.5-i2i-preview");
        setI2vModel(data.i2v_model || "wan2.5-i2v-preview");
        setCharacterAspectRatio(data.character_aspect_ratio || "9:16");
        setSceneAspectRatio(data.scene_aspect_ratio || "16:9");
        setPropAspectRatio(data.prop_aspect_ratio || "1:1");
        setStoryboardAspectRatio(data.storyboard_aspect_ratio || "16:9");
      } catch (error) {
        console.error("Failed to load series model settings:", error);
        if (!cancelled) {
          setLoadError("剧集设置加载失败，请稍后再试。");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [series.id]);

  const showMessage = (nextMessage: SettingsMessageState) => {
    setMessage(nextMessage);
    window.setTimeout(() => {
      setMessage((current) => (current?.text === nextMessage.text ? null : current));
    }, 3200);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      await api.updateSeriesModelSettings(series.id, {
        t2i_model: t2iModel,
        i2i_model: i2iModel,
        i2v_model: i2vModel,
        character_aspect_ratio: characterAspectRatio,
        scene_aspect_ratio: sceneAspectRatio,
        prop_aspect_ratio: propAspectRatio,
        storyboard_aspect_ratio: storyboardAspectRatio,
      });

      if (onUpdated) {
        const latestSeries = await api.getSeriesLight(series.id);
        onUpdated(latestSeries);
      }
      showMessage({ type: "success", text: "剧集默认设置已保存" });
    } catch (error) {
      console.error("Failed to save series model settings:", error);
      showMessage({ type: "error", text: "保存失败，请稍后重试" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
      <div className="border-b border-white/10 px-8 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">剧集设置</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              管理这个剧集的默认模型与画幅比例。这里的设置会作为分集创作的默认起点，但单个项目仍然可以按项目单独覆盖。
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isLoading || !!loadError}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.22)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            保存剧集设置
          </button>
        </div>

        {message ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              message.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-red-500/20 bg-red-500/10 text-red-200"
            }`}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {isLoading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center text-gray-400">
            <Loader2 size={20} className="mr-2 animate-spin text-blue-400" />
            正在加载剧集设置...
          </div>
        ) : loadError ? (
          <div className="rounded-3xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-200">
            {loadError}
          </div>
        ) : (
          <div className="space-y-8">
            <SettingsSection
              icon={<ImageIcon size={18} className="text-emerald-400" />}
              title="资产默认模型"
              description="角色、场景、道具等静态资产会优先使用这里的默认生图模型。"
            >
              <ModelChoiceGrid
                models={catalog.t2i}
                selectedModel={t2iModel}
                onSelect={setT2iModel}
                accentClassName="border-emerald-500/50 bg-emerald-500/10"
                checkClassName="text-emerald-400"
              />

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <AspectRatioGroup
                  label="角色比例"
                  icon={<User size={13} />}
                  selectedRatio={characterAspectRatio}
                  onSelect={setCharacterAspectRatio}
                />
                <AspectRatioGroup
                  label="场景比例"
                  icon={<Building size={13} />}
                  selectedRatio={sceneAspectRatio}
                  onSelect={setSceneAspectRatio}
                />
                <AspectRatioGroup
                  label="道具比例"
                  icon={<Box size={13} />}
                  selectedRatio={propAspectRatio}
                  onSelect={setPropAspectRatio}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              icon={<Layout size={18} className="text-sky-400" />}
              title="分镜默认模型"
              description="分镜图生成会继承这里的默认图像模型与画幅比例。"
            >
              <ModelChoiceGrid
                models={catalog.i2i}
                selectedModel={i2iModel}
                onSelect={setI2iModel}
                accentClassName="border-sky-500/50 bg-sky-500/10"
                checkClassName="text-sky-400"
              />

              <AspectRatioInlineGrid
                label="分镜比例"
                selectedRatio={storyboardAspectRatio}
                onSelect={setStoryboardAspectRatio}
                accentClassName="border-sky-500/50 bg-sky-500/10"
              />
            </SettingsSection>

            <SettingsSection
              icon={<Video size={18} className="text-fuchsia-400" />}
              title="动态视频默认模型"
              description="视频生成默认会从这里取模型；分镜项目里临时切换模型只影响当次任务。"
            >
              <ModelChoiceGrid
                models={catalog.i2v}
                selectedModel={i2vModel}
                onSelect={setI2vModel}
                accentClassName="border-fuchsia-500/50 bg-fuchsia-500/10"
                checkClassName="text-fuchsia-400"
              />
            </SettingsSection>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] px-6 py-6 shadow-[0_16px_48px_rgba(2,6,23,0.18)]">
      <div className="mb-5 flex items-start gap-3">
        <div className="mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-400">{description}</p>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function ModelChoiceGrid({
  models,
  selectedModel,
  onSelect,
  accentClassName,
  checkClassName,
}: {
  models: Array<{ id: string; name: string; description?: string; disabled?: boolean; unavailableReason?: string }>;
  selectedModel: string;
  onSelect: (modelId: string) => void;
  accentClassName: string;
  checkClassName: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {models.map((model) => {
        const isSelected = selectedModel === model.id;
        const isDisabled = Boolean(model.disabled);
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => !isDisabled && onSelect(model.id)}
            disabled={isDisabled}
            className={`relative rounded-2xl border px-4 py-4 text-left transition-all ${
              isSelected ? accentClassName : "border-white/10 bg-white/5 hover:border-white/20"
            } ${isDisabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {isSelected ? (
              <div className={`absolute right-3 top-3 ${checkClassName}`}>
                <Check size={14} />
              </div>
            ) : null}
            <div className="text-sm font-semibold text-white">{model.name}</div>
            <div className="mt-1 text-xs leading-5 text-gray-400">{model.description || "暂无模型说明"}</div>
            {isDisabled && model.unavailableReason ? (
              <div className="mt-2 text-[11px] text-amber-300">{model.unavailableReason}</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function AspectRatioGroup({
  label,
  icon,
  selectedRatio,
  onSelect,
}: {
  label: string;
  icon: ReactNode;
  selectedRatio: string;
  onSelect: (ratioId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-300">
        {icon}
        <span>{label}</span>
      </div>
      <div className="space-y-2">
        {ASPECT_RATIOS.map((ratio) => {
          const isSelected = selectedRatio === ratio.id;
          return (
            <button
              key={ratio.id}
              type="button"
              onClick={() => onSelect(ratio.id)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                isSelected
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="text-sm font-semibold text-white">{ratio.name}</div>
              <div className="mt-1 text-[11px] leading-4 text-gray-400">{ratio.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AspectRatioInlineGrid({
  label,
  selectedRatio,
  onSelect,
  accentClassName,
}: {
  label: string;
  selectedRatio: string;
  onSelect: (ratioId: string) => void;
  accentClassName: string;
}) {
  return (
    <div>
      <div className="mb-3 text-xs font-medium text-gray-300">{label}</div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {ASPECT_RATIOS.map((ratio) => {
          const isSelected = selectedRatio === ratio.id;
          return (
            <button
              key={ratio.id}
              type="button"
              onClick={() => onSelect(ratio.id)}
              className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                isSelected ? accentClassName : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="text-sm font-semibold text-white">{ratio.name}</div>
              <div className="mt-1 text-[11px] leading-5 text-gray-400">{ratio.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
