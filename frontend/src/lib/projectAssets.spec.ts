import { describe, expect, it } from "vitest";

import type { Project } from "@/store/projectStore";
import { getEffectiveProjectCharacterCount, getEffectiveProjectCharacters, getProjectCharacterSourceHint } from "./projectAssets";

describe("projectAssets helpers", () => {
  it("prefers series character links for series projects", () => {
    const project: Project = {
      id: "project-series-1",
      title: "系列分集",
      originalText: "",
      characters: [
        { id: "project-char-1", name: "旧项目角色" },
      ],
      series_character_links: [
        {
          id: "link-1",
          project_id: "project-series-1",
          series_id: "series-1",
          character_id: "series-char-1",
          match_status: "auto_matched",
          character: { id: "series-char-1", name: "系列阿杰" },
        },
      ],
      scenes: [],
      props: [],
      frames: [],
      status: "pending",
      createdAt: "",
      updatedAt: "",
      series_id: "series-1",
    };

    expect(getEffectiveProjectCharacters(project).map((item) => item.id)).toEqual(["series-char-1"]);
    expect(getEffectiveProjectCharacterCount(project)).toBe(1);
    expect(getProjectCharacterSourceHint(project)).toContain("系列角色主档");
  });

  it("keeps standalone project characters unchanged", () => {
    const project: Project = {
      id: "project-standalone-1",
      title: "独立项目",
      originalText: "",
      characters: [
        { id: "project-char-1", name: "小雨" },
      ],
      scenes: [],
      props: [],
      frames: [],
      status: "pending",
      createdAt: "",
      updatedAt: "",
    };

    expect(getEffectiveProjectCharacters(project).map((item) => item.id)).toEqual(["project-char-1"]);
    expect(getEffectiveProjectCharacterCount(project)).toBe(1);
    expect(getProjectCharacterSourceHint(project)).toBeNull();
  });
});
