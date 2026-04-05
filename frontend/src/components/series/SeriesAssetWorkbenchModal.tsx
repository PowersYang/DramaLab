"use client";

import { useMemo } from "react";

import CharacterWorkbench from "@/components/modules/CharacterWorkbench";
import ScenePropWorkbenchModal from "@/components/modules/ScenePropWorkbenchModal";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { api } from "@/lib/api";
import {
  isSystemDefaultCharacterPrompt,
} from "@/lib/characterPromptTemplates";
import { formatRequestFailureMessage, formatTaskFailureMessage } from "@/lib/taskFeedback";
import type { Character, Prop, Scene, Series } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";

type SeriesAssetType = "character" | "scene" | "prop";

interface SeriesAssetWorkbenchModalProps {
  series: Series;
  asset: Character | Scene | Prop;
  assetType: SeriesAssetType;
  generatingTypes?: { type: string; batchSize: number; status?: string }[];
  onGeneratingStateChange?: (state: {
    assetId: string;
    generationType: string;
    batchSize: number;
    isGenerating: boolean;
  }) => void;
  onClose: () => void;
  onSeriesUpdated: (series: Series) => void;
}

function normalizeSeriesCharacterPrompts(character: Character): Character {
  const name = character.name || "角色";
  const description = character.description || "";

  // 中文注释：系列页历史默认 prompt 不应覆盖当前 CharacterWorkbench 的模板体系。
  return {
    ...character,
    full_body_prompt: isSystemDefaultCharacterPrompt(character.full_body_prompt, "full_body", name, description)
      ? undefined
      : character.full_body_prompt,
    three_view_prompt: isSystemDefaultCharacterPrompt(character.three_view_prompt, "three_view", name, description)
      ? undefined
      : character.three_view_prompt,
    headshot_prompt: isSystemDefaultCharacterPrompt(character.headshot_prompt, "headshot", name, description)
      ? undefined
      : character.headshot_prompt,
  };
}

export default function SeriesAssetWorkbenchModal({
  series,
  asset,
  assetType,
  generatingTypes = [],
  onGeneratingStateChange,
  onClose,
  onSeriesUpdated,
}: SeriesAssetWorkbenchModalProps) {
  const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
  const waitForJob = useTaskStore((state) => state.waitForJob);
  const { account, getTaskPrice, canAffordTask } = useBillingGuard();

  const normalizedCharacterAsset = useMemo(
    () => (assetType === "character" ? normalizeSeriesCharacterPrompts(asset as Character) : null),
    [
      assetType,
      asset.id,
      asset.name,
      asset.description,
      (asset as Character).full_body_prompt,
      (asset as Character).three_view_prompt,
      (asset as Character).headshot_prompt,
    ],
  );

  const assetGeneratePrice = getTaskPrice("asset.generate");
  const motionRefGeneratePrice = getTaskPrice("asset.motion_ref.generate");
  const assetGenerateAffordable = canAffordTask("asset.generate");
  const motionRefAffordable = canAffordTask("asset.motion_ref.generate");

  if (assetType === "character") {
    const character = normalizedCharacterAsset as Character;

    const handleUpdateCharacterDescription = async (nextDescription: string) => {
      const updatedSeries = await api.updateSeriesAssetAttributes(series.id, character.id, "character", {
        description: nextDescription,
      });
      onSeriesUpdated(updatedSeries);
    };

    const handleSelectCharacterVariant = async (panel: "full_body" | "three_view" | "headshot", variantId: string) => {
      // 中文注释：系列角色点选候选图时必须写 selected_id，刷新后才能稳定回显。
      const updatedSeries = await api.selectSeriesAssetVariant(series.id, character.id, "character", variantId, panel);
      onSeriesUpdated(updatedSeries);
    };

    const handleGenerateCharacter = async (
      generationType: string,
      prompt: string,
      applyStyle: boolean,
      negativePromptForAsset: string,
      batchSize: number,
      modelName?: string,
    ) => {
      onGeneratingStateChange?.({ assetId: character.id, generationType, batchSize, isGenerating: true });
      try {
        const promptField =
          generationType === "full_body"
            ? "full_body_prompt"
            : generationType === "three_view"
            ? "three_view_prompt"
            : "headshot_prompt";
        const updatedSeriesBeforeQueue = await api.updateSeriesAssetAttributes(series.id, character.id, "character", {
          [promptField]: prompt,
          description: character.description || "",
        });
        onSeriesUpdated(updatedSeriesBeforeQueue);

        const receipt = await api.generateSeriesAsset(
          series.id,
          character.id,
          "character",
          generationType,
          prompt,
          applyStyle,
          negativePromptForAsset,
          batchSize,
          "ArtDirection",
          series.art_direction?.style_config?.positive_prompt,
          modelName || series.model_settings?.t2i_model,
        );
        enqueueReceipts(series.id, [receipt]);
        const job = await waitForJob(receipt.job_id, { intervalMs: 2000, maxAttempts: 240 });
        if (job.status !== "succeeded") {
          throw new Error(formatTaskFailureMessage(job, "生成素材失败"));
        }
        const refreshedSeries = await api.getSeriesLight(series.id);
        onSeriesUpdated(refreshedSeries);
      } finally {
        onGeneratingStateChange?.({ assetId: character.id, generationType, batchSize, isGenerating: false });
      }
    };

    const handleGenerateCharacterMotion = async (
      prompt: string,
      negativePromptForMotion: string,
      duration: number,
      subType?: string,
    ) => {
      const generationType = subType === "head_shot" ? "video_head_shot" : "video_full_body";
      const assetSubType = subType === "head_shot" ? "head_shot" : "full_body";
      onGeneratingStateChange?.({ assetId: character.id, generationType, batchSize: 1, isGenerating: true });
      try {
        const receipt = await api.generateSeriesMotionRef(
          series.id,
          character.id,
          assetSubType,
          prompt,
          undefined,
          negativePromptForMotion,
          duration,
          1,
        );
        enqueueReceipts(series.id, [receipt]);
        const job = await waitForJob(receipt.job_id, { intervalMs: 2000, maxAttempts: 240 });
        if (job.status !== "succeeded") {
          throw new Error(formatTaskFailureMessage(job, "生成动态参考失败"));
        }
        const refreshedSeries = await api.getSeriesLight(series.id);
        onSeriesUpdated(refreshedSeries);
      } catch (error: any) {
        alert(formatRequestFailureMessage(error, "启动动态参考生成失败"));
      } finally {
        onGeneratingStateChange?.({ assetId: character.id, generationType, batchSize: 1, isGenerating: false });
      }
    };

    return (
      <CharacterWorkbench
        asset={character}
        onClose={onClose}
        onUpdateDescription={handleUpdateCharacterDescription}
        onGenerate={handleGenerateCharacter}
        generatingTypes={generatingTypes}
        stylePrompt={series.art_direction?.style_config?.positive_prompt || ""}
        styleNegativePrompt={series.art_direction?.style_config?.negative_prompt || ""}
        staticTaskType="asset.generate"
        selectedStaticModel={series.model_settings?.t2i_model || "wan2.5-t2i-preview"}
        allowMotionMode={true}
        enableMotionGeneration={true}
        motionTaskType="asset.motion_ref.generate"
        onGenerateVideo={handleGenerateCharacterMotion}
        onSelectVariant={handleSelectCharacterVariant}
        promptStateSeriesId={series.id}
      />
    );
  }

  const sceneOrPropAsset = asset as Scene | Prop;

  const handleUpdateSceneOrPropDescription = async (nextDescription: string) => {
    const updatedSeries = await api.updateSeriesAssetAttributes(series.id, sceneOrPropAsset.id, assetType, {
      description: nextDescription,
    });
    onSeriesUpdated(updatedSeries);
  };

  const handleSelectSceneOrPropVariant = async (variantId: string) => {
    const updatedSeries = await api.selectSeriesAssetVariant(series.id, sceneOrPropAsset.id, assetType, variantId);
    onSeriesUpdated(updatedSeries);
  };

  const handleGenerateSceneOrPropImage = async (prompt: string, negativePrompt: string, batchSize: number) => {
    const generationType = "all";
    onGeneratingStateChange?.({ assetId: sceneOrPropAsset.id, generationType, batchSize, isGenerating: true });
    try {
      const receipt = await api.generateSeriesAsset(
        series.id,
        sceneOrPropAsset.id,
        assetType,
        generationType,
        prompt,
        true,
        negativePrompt,
        batchSize,
        "ArtDirection",
        series.art_direction?.style_config?.positive_prompt,
        series.model_settings?.t2i_model,
      );
      enqueueReceipts(series.id, [receipt]);
      const job = await waitForJob(receipt.job_id, { intervalMs: 2000, maxAttempts: 240 });
      if (job.status !== "succeeded") {
        throw new Error(formatTaskFailureMessage(job, "生成素材失败"));
      }
      const refreshedSeries = await api.getSeriesLight(series.id);
      onSeriesUpdated(refreshedSeries);
    } catch (error: any) {
      alert(formatRequestFailureMessage(error, "启动场景/道具生图失败"));
    } finally {
      onGeneratingStateChange?.({ assetId: sceneOrPropAsset.id, generationType, batchSize: 1, isGenerating: false });
    }
  };

  const isSceneOrPropGeneratingImage = generatingTypes.some((entry) => entry.type === "all");
  const isSceneOrPropGeneratingVideo = generatingTypes.some((entry) => entry.type.startsWith("video"));

  return (
    <ScenePropWorkbenchModal
      asset={sceneOrPropAsset}
      assetType={assetType}
      promptStateSeriesId={series.id}
      onClose={onClose}
      onUpdateDescription={handleUpdateSceneOrPropDescription}
      onSelectVariant={handleSelectSceneOrPropVariant}
      onGenerateImage={handleGenerateSceneOrPropImage}
      onGenerateVideo={async () => {
        // 中文注释：后端当前仅支持系列角色动作参考；场景/道具视频入口先复用 UI，但保持禁用提示。
      }}
      isGeneratingImage={isSceneOrPropGeneratingImage}
      isGeneratingVideo={isSceneOrPropGeneratingVideo}
      imagePriceCredits={assetGeneratePrice}
      imageBalanceCredits={account?.balance_credits ?? 0}
      imageAffordable={assetGenerateAffordable}
      videoPriceCredits={motionRefGeneratePrice}
      videoBalanceCredits={account?.balance_credits ?? 0}
      videoAffordable={motionRefAffordable}
      styleNegativePrompt={series.art_direction?.style_config?.negative_prompt || ""}
      videoGenerateEnabled={false}
      videoDisabledReason="当前系列场景/道具动态生成链路待接入。"
    />
  );
}
