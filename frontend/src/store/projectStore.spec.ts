import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProject = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    getProject: (...args: unknown[]) => mockGetProject(...args),
  },
  API_URL: "http://localhost:17177",
}));

import { useProjectStore } from "./projectStore";

describe("projectStore.selectProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useProjectStore.setState({
      projects: [],
      currentProject: null,
      hasHydrated: true,
      isLoading: false,
      selectedFrameId: null,
      selectedAudioCharacterId: null,
      generatingTasks: [],
      renderingFrames: new Set<string>(),
      seriesList: [],
      currentSeries: null,
    });
  });

  it("loads project details through the shared api client", async () => {
    mockGetProject.mockResolvedValue({
      id: "project-wolf-bride",
      title: "狼王的新娘",
      original_text: "test script",
      characters: [],
      scenes: [],
      props: [],
      frames: [],
      video_tasks: [],
      model_settings: {},
      prompt_config: {},
    });

    await useProjectStore.getState().selectProject("project-wolf-bride");

    expect(mockGetProject).toHaveBeenCalledWith("project-wolf-bride");
    expect(useProjectStore.getState().currentProject?.id).toBe("project-wolf-bride");
    expect(useProjectStore.getState().currentProject?.title).toBe("狼王的新娘");
  });

  it("derives characters from series_character_links for series projects without affecting standalone projects", async () => {
    mockGetProject
      .mockResolvedValueOnce({
        id: "series-project-1",
        title: "系列分集",
        original_text: "episode script",
        series_id: "series-1",
        characters: [],
        series_character_links: [
          {
            id: "link-1",
            project_id: "series-project-1",
            series_id: "series-1",
            character_id: "char-series-1",
            match_status: "auto_matched",
            character: {
              id: "char-series-1",
              name: "阿杰",
              description: "系列主角",
              video_assets: [],
            },
          },
        ],
        scenes: [],
        props: [],
        frames: [],
        video_tasks: [],
        model_settings: {},
        prompt_config: {},
      })
      .mockResolvedValueOnce({
        id: "standalone-project-1",
        title: "独立项目",
        original_text: "single script",
        characters: [
          {
            id: "char-project-1",
            name: "小雨",
            description: "独立项目角色",
            video_assets: [],
          },
        ],
        scenes: [],
        props: [],
        frames: [],
        video_tasks: [],
        model_settings: {},
        prompt_config: {},
      });

    await useProjectStore.getState().selectProject("series-project-1");
    expect(useProjectStore.getState().currentProject?.characters.map((item) => item.id)).toEqual(["char-series-1"]);

    await useProjectStore.getState().selectProject("standalone-project-1");
    expect(useProjectStore.getState().currentProject?.characters.map((item) => item.id)).toEqual(["char-project-1"]);
  });
});
