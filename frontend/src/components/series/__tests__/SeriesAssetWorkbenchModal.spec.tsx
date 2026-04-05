/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SeriesAssetWorkbenchModal from "../SeriesAssetWorkbenchModal";

const mockSelectSeriesAssetVariant = vi.fn();
const mockUpdateSeriesAssetAttributes = vi.fn();
const mockCharacterWorkbench = vi.fn();

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span {...props} />;
  return {
    Box: Icon,
    Check: Icon,
    FileText: Icon,
    Image: Icon,
    MapPin: Icon,
    Palette: Icon,
    Sparkles: Icon,
    User: Icon,
    Video: Icon,
    Wand2: Icon,
    X: Icon,
  };
});

vi.mock("@/components/modules/CharacterWorkbench", () => ({
  default: (props: any) => {
    mockCharacterWorkbench(props);
    return <div>Character Workbench</div>;
  },
}));

vi.mock("@/hooks/useBillingGuard", () => ({
  useBillingGuard: () => ({
    account: { balance_credits: 88 },
    getTaskPrice: () => 6,
    canAffordTask: () => true,
  }),
}));

vi.mock("@/lib/modelCatalog", () => ({
  useAvailableModelCatalog: () => ({
    catalog: { t2i: [] },
  }),
}));

vi.mock("@/store/taskStore", () => ({
  useTaskStore: (selector: any) =>
    selector({
      enqueueReceipts: vi.fn(),
      waitForJob: vi.fn(),
    }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    selectSeriesAssetVariant: (...args: any[]) => mockSelectSeriesAssetVariant(...args),
    updateSeriesAssetAttributes: (...args: any[]) => mockUpdateSeriesAssetAttributes(...args),
    generateSeriesAsset: vi.fn(),
    generateSeriesMotionRef: vi.fn(),
    getSeriesLight: vi.fn(),
  },
}));

describe("SeriesAssetWorkbenchModal", () => {
  const baseSeries = {
    id: "series-1",
    title: "霓虹剧集",
    description: "测试剧集",
    characters: [],
    scenes: [],
    props: [],
    art_direction: { style_config: {} },
    model_settings: {},
  };

  const baseScene = {
    id: "scene-1",
    name: "审讯室",
    description: "昏暗审讯室",
    image_url: "https://example.com/variant-4.png",
    image_asset: {
      selected_id: "variant-4",
      variants: [
        { id: "variant-1", url: "https://example.com/variant-1.png" },
        { id: "variant-2", url: "https://example.com/variant-2.png" },
        { id: "variant-3", url: "https://example.com/variant-3.png" },
        { id: "variant-4", url: "https://example.com/variant-4.png" },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSeriesAssetAttributes.mockResolvedValue(baseSeries);
    mockSelectSeriesAssetVariant.mockResolvedValue({
      ...baseSeries,
      scenes: [
        {
          ...baseScene,
          image_url: "https://example.com/variant-1.png",
          image_asset: {
            ...baseScene.image_asset,
            selected_id: "variant-1",
          },
        },
      ],
    });
  });

  it("does not override motion videos with empty external arrays for series characters", () => {
    const characterAsset = {
      id: "char-1",
      name: "沈清辞",
      description: "测试角色",
      full_body: {
        video_variants: [{ id: "video-1", url: "https://example.com/video-1.mp4" }],
      },
      head_shot: {
        video_variants: [{ id: "video-2", url: "https://example.com/video-2.mp4" }],
      },
    };

    render(
      <SeriesAssetWorkbenchModal
        series={baseSeries as any}
        asset={characterAsset as any}
        assetType="character"
        onClose={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    expect(mockCharacterWorkbench).toHaveBeenCalled();
    const passedProps = mockCharacterWorkbench.mock.calls.at(-1)?.[0];
    expect(passedProps.externalMotionVideos).toBeUndefined();
  });

  it("persists the clicked scene variant instead of keeping the last generated variant selected", async () => {
    const handleSeriesUpdated = vi.fn();

    render(
      <SeriesAssetWorkbenchModal
        series={baseSeries as any}
        asset={baseScene as any}
        assetType="scene"
        onClose={vi.fn()}
        onSeriesUpdated={handleSeriesUpdated}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "候选图" })[0]);

    await waitFor(() => {
      expect(mockSelectSeriesAssetVariant).toHaveBeenCalledWith("series-1", "scene-1", "scene", "variant-1");
    });
    expect(handleSeriesUpdated).toHaveBeenCalled();
  });
});
