import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEGATIVE_PROMPT_ZH,
  getDefaultCharacterMotionPrompt,
  getDefaultCharacterPrompt,
  getLegacyEnglishCharacterPrompt,
  isSystemDefaultCharacterPrompt,
} from "./characterPromptTemplates";

describe("characterPromptTemplates", () => {
  it("builds Chinese full-body prompt by default", () => {
    const prompt = getDefaultCharacterPrompt("full_body", "沈清辞", "京城女捕快，气质清冷，身手利落");

    expect(prompt).toContain("请绘制角色沈清辞的全身角色设定图");
    expect(prompt).toContain("角色设定：京城女捕快，气质清冷，身手利落");
    expect(prompt).not.toContain("Full body character design");
  });

  it("adds Chinese reference consistency guidance when needed", () => {
    const prompt = getDefaultCharacterPrompt("headshot", "沈清辞", "京城女捕快", {
      keepReferenceConsistency: true,
    });

    expect(prompt).toContain("严格保持与参考图一致");
    expect(prompt).toContain("请绘制角色沈清辞的近景头像设定图");
  });

  it("recognizes both legacy English and new Chinese defaults as system defaults", () => {
    const englishDefault = getLegacyEnglishCharacterPrompt("three_view", "沈清辞", "京城女捕快");
    const chineseDefault = getDefaultCharacterPrompt("three_view", "沈清辞", "京城女捕快");

    expect(isSystemDefaultCharacterPrompt(englishDefault, "three_view", "沈清辞", "京城女捕快")).toBe(true);
    expect(isSystemDefaultCharacterPrompt(chineseDefault, "three_view", "沈清辞", "京城女捕快")).toBe(true);
    expect(isSystemDefaultCharacterPrompt("用户手写提示词", "three_view", "沈清辞", "京城女捕快")).toBe(false);
  });

  it("builds Chinese motion and negative prompts", () => {
    const motionPrompt = getDefaultCharacterMotionPrompt("full_body", "沈清辞", "京城女捕快，气质清冷");

    expect(motionPrompt).toContain("请生成角色动态参考视频");
    expect(motionPrompt).toContain("主体：京城女捕快，气质清冷");
    expect(DEFAULT_NEGATIVE_PROMPT_ZH).toContain("低质量");
    expect(DEFAULT_NEGATIVE_PROMPT_ZH).not.toContain("low quality");
  });
});
