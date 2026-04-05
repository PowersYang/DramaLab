"use client";

export type CharacterPromptPanelKey = "full_body" | "three_view" | "headshot";
export type CharacterMotionPromptPanelKey = Extract<CharacterPromptPanelKey, "full_body" | "headshot">;

export const DEFAULT_NEGATIVE_PROMPT_ZH =
  "低质量，低清晰度，模糊，解剖错误，手部畸形，脸部崩坏，多余手指，缺失手指，肢体残缺，比例失衡，裁切，重复人物，文字，水印，签名，杂乱背景，错误透视";

const buildDescriptionSentence = (description: string) => {
  const normalized = description.trim();
  return normalized ? `角色设定：${normalized}。` : "";
};

// 中文注释：旧版默认 prompt 是英文模板，系列资产工作台历史上可能把它们直接持久化进数据库。
// 新版统一改成中文模板时，需要继续识别这些旧默认值，避免老数据把系统默认误当成“用户手填值”保留下来。
export function getLegacyEnglishCharacterPrompt(panelKey: CharacterPromptPanelKey, assetName: string, description: string) {
  const baseDesc = description || "";
  const name = assetName || "角色";
  if (panelKey === "full_body") {
    return `Full body character design of ${name}, concept art. ${baseDesc}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece.`;
  }
  if (panelKey === "three_view") {
    return `Character Reference Sheet for ${name}. ${baseDesc}. Three-view character design: Front view, Side view, and Back view. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background.`;
  }
  return `Close-up portrait of the SAME character ${name}. ${baseDesc}. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece.`;
}

export function getDefaultCharacterPrompt(
  panelKey: CharacterPromptPanelKey,
  assetName: string,
  description: string,
  options?: { keepReferenceConsistency?: boolean },
) {
  const name = assetName.trim() || "角色";
  const descSentence = buildDescriptionSentence(description);
  const consistencyPrefix = options?.keepReferenceConsistency
    ? panelKey === "headshot"
      ? "严格保持与参考图一致的人脸轮廓、发型、肤色与五官细节。"
      : "严格保持与参考图一致的人物外貌、发型、肤色、服饰和整体设定。"
    : "";

  if (panelKey === "full_body") {
    return `${consistencyPrefix}请绘制角色${name}的全身角色设定图。${descSentence}全身出镜，站立姿态，自然正视镜头，表情平静克制，不要夸张情绪。纯白或极简浅色背景，单人主体，无道具，无场景干扰，服装和轮廓清晰，细节完整，画质精致。`;
  }
  if (panelKey === "three_view") {
    return `${consistencyPrefix}请绘制角色${name}的三视图角色设定图。${descSentence}需要同时展示正面、侧面和背面，全身站立，表情自然，三视图服装、发型和细节保持完全一致。背景简洁干净，方便作为角色设定参考。`;
  }
  return `${consistencyPrefix}请绘制角色${name}的近景头像设定图。${descSentence}聚焦面部与肩部，正视镜头，表情自然克制，突出五官细节、发型层次和人物气质。背景简洁干净，主体清晰，画质精致。`;
}

export function getDefaultCharacterMotionPrompt(
  panelKey: CharacterMotionPromptPanelKey,
  assetName: string,
  description: string,
) {
  const subject = description.trim() || assetName.trim() || "角色";
  if (panelKey === "full_body") {
    return `请生成角色动态参考视频。\n主体：${subject}。\n全身站立，自然重心轻微变化，双手做少量自然交流动作，身体可轻微左右转动约三十度。镜头稳定，光线均匀，始终保持人物服装、面部和体态一致。`;
  }
  return `请生成角色头像动态参考视频。\n主体：${subject}。\n人物正对镜头，包含轻微眨眼、细小头部动作和自然微表情。镜头稳定，构图保持在面部与肩部附近，始终保持人物面部细节一致。`;
}

export function isSystemDefaultCharacterPrompt(prompt: string | null | undefined, panelKey: CharacterPromptPanelKey, assetName: string, description: string) {
  if (!prompt) {
    return false;
  }
  return (
    prompt === getDefaultCharacterPrompt(panelKey, assetName, description) ||
    prompt === getLegacyEnglishCharacterPrompt(panelKey, assetName, description)
  );
}
