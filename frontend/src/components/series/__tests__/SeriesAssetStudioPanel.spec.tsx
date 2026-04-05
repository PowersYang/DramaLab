/* eslint-disable @typescript-eslint/no-explicit-any */
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SeriesAssetStudioPanel from "../SeriesAssetStudioPanel";

const mockSyncSeriesAssets = vi.fn();
const mockToastSuccess = vi.fn();
const mockExtractSeriesAssets = vi.fn();
const mockGetSeriesAssetInbox = vi.fn();
const mockUpsertSeriesAssetInbox = vi.fn();
const mockRemoveSeriesAssetInboxItems = vi.fn();
const mockWaitForJob = vi.fn();
const mockFetchProjectJobs = vi.fn();
let mockBalanceCredits = 88;
let mockCanAffordExtract = true;
let mockCanAffordProjectReparse = true;
let mockTaskStoreState: any;

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span {...props} />;
  return {
    Boxes: Icon,
    Check: Icon,
    Inbox: Icon,
    Loader2: Icon,
    MapPin: Icon,
    Package: Icon,
    Plus: Icon,
    Sparkles: Icon,
    User: Icon,
    Users: Icon,
    Wand2: Icon,
    X: Icon,
  };
});

vi.mock("@/components/common/StudioAssetCard", () => ({
  default: ({ asset, onClick, isGenerating, generationLabel }: any) => (
    <button onClick={onClick}>
      {asset.name}:{isGenerating ? `generating:${generationLabel}` : "idle"}
    </button>
  ),
}));

vi.mock("@/components/common/AssetTypeTabs", () => ({
  default: ({ items }: any) => (
    <div>
      {items.map((item: any) => (
        <span key={item.id}>{item.label}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/store/taskStore", () => ({
  useTaskStore: (selector: any) => selector(mockTaskStoreState),
}));

vi.mock("@/lib/api", () => ({
  api: {
    syncSeriesAssets: (...args: any[]) => mockSyncSeriesAssets(...args),
    extractSeriesAssets: (...args: any[]) => mockExtractSeriesAssets(...args),
    getSeriesAssetInbox: (...args: any[]) => mockGetSeriesAssetInbox(...args),
    upsertSeriesAssetInbox: (...args: any[]) => mockUpsertSeriesAssetInbox(...args),
    removeSeriesAssetInboxItems: (...args: any[]) => mockRemoveSeriesAssetInboxItems(...args),
  },
}));

vi.mock("@/hooks/useBillingGuard", () => ({
  useBillingGuard: () => ({
    account: { balance_credits: mockBalanceCredits },
    pricingRules: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    getTaskPrice: (taskType: string) =>
      taskType === "project.reparse" || taskType === "series.assets.extract" ? 6 : 0,
    canAffordTask: (taskType: string) =>
      taskType === "series.assets.extract"
        ? mockCanAffordExtract
        : taskType === "project.reparse"
          ? mockCanAffordProjectReparse
          : false,
  }),
}));

vi.mock("@/components/studio/ui/StudioOverlays", () => ({
  useStudioToast: () => ({
    success: (...args: any[]) => mockToastSuccess(...args),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/series/SeriesAssetWorkbenchModal", () => ({
  default: ({ asset, onClose, onGeneratingStateChange, generatingTypes }: any) => (
    <div>
      <div>工作台:{asset.name}</div>
      <div data-testid="modal-generating-types">{JSON.stringify(generatingTypes || [])}</div>
      <button
        type="button"
        onClick={() =>
          onGeneratingStateChange?.({
            assetId: asset.id,
            generationType: "full_body",
            batchSize: 2,
            isGenerating: true,
          })
        }
      >
        开始生成
      </button>
      <button
        type="button"
        onClick={() =>
          onGeneratingStateChange?.({
            assetId: asset.id,
            generationType: "full_body",
            batchSize: 2,
            isGenerating: false,
          })
        }
      >
        结束生成
      </button>
      <button type="button" onClick={onClose}>
        关闭工作台
      </button>
    </div>
  ),
}));

const baseSeries = {
  id: "series-1",
  title: "霓虹剧集",
  description: "测试用剧集",
  version: 7,
  characters: [
    {
      id: "char-1",
      name: "林夏",
      description: "冷静的调查记者",
      aliases: [],
      merge_status: "active",
    },
  ],
  scenes: [],
  props: [],
  episode_ids: [],
  created_at: "2026-04-05T00:00:00Z",
  updated_at: "2026-04-05T00:00:00Z",
};

describe("SeriesAssetStudioPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBalanceCredits = 88;
    mockCanAffordExtract = true;
    mockCanAffordProjectReparse = true;
    mockTaskStoreState = {
      enqueueReceipts: vi.fn(),
      waitForJob: (...args: any[]) => mockWaitForJob(...args),
      fetchProjectJobs: (...args: any[]) => mockFetchProjectJobs(...args),
      jobsById: {},
      jobIdsByProject: {},
    };
    mockFetchProjectJobs.mockResolvedValue([]);
    mockSyncSeriesAssets.mockResolvedValue(baseSeries);
    mockGetSeriesAssetInbox.mockResolvedValue({
      characters: [],
      scenes: [],
      props: [],
      series_version: 7,
    });
    mockUpsertSeriesAssetInbox.mockImplementation((_seriesId: string, payload: any) =>
      Promise.resolve({
        characters: payload.characters || [],
        scenes: payload.scenes || [],
        props: payload.props || [],
        series_version: 7,
      }),
    );
    mockRemoveSeriesAssetInboxItems.mockResolvedValue({
      characters: [],
      scenes: [],
      props: [],
      series_version: 7,
    });
    mockExtractSeriesAssets.mockResolvedValue({
      job_id: "job-series-extract-1",
      task_type: "series.assets.extract",
      status: "queued",
      queue_name: "llm",
      project_id: null,
      resource_type: "series",
      resource_id: "series-1",
      created_at: "2026-04-05T00:00:00Z",
    });
    mockWaitForJob.mockResolvedValue({
      id: "job-series-extract-1",
      task_type: "series.assets.extract",
      status: "succeeded",
      result_json: {
        characters: [
          {
            id: "preview-char-1",
            name: "周野",
            description: "新识别角色",
            aliases: [],
            merge_status: "active",
          },
        ],
        scenes: [],
        props: [],
      },
    });
  });

  it("shows asset studio actions", () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("资产制作")).toBeInTheDocument();
    expect(screen.getByText("自动识别资产")).toBeInTheDocument();
    expect(screen.getByText("新增资产")).toBeInTheDocument();
    expect(screen.queryByText("在剧集级统一沉淀角色、场景与道具资产，识别结果会先预览，再由你确认导入。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动识别资产" })).toHaveClass(
      "studio-action-button",
      "studio-action-button-warm",
    );
    expect(screen.getByRole("button", { name: "新增资产" })).toHaveClass(
      "studio-action-button",
      "studio-action-button-accent",
    );
  });

  it("renders stably on first mount in StrictMode", () => {
    expect(() =>
      render(
        <StrictMode>
          <SeriesAssetStudioPanel
            series={baseSeries as any}
            tab="characters"
            onTabChange={vi.fn()}
            onSeriesUpdated={vi.fn()}
          />
        </StrictMode>,
      ),
    ).not.toThrow();

    expect(screen.getByText("资产制作")).toBeInTheDocument();
    expect(screen.getByText("林夏:idle")).toBeInTheDocument();
  });

  it("keeps asset card and reopened modal in generating state after modal is closed", async () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("林夏:idle")).toBeInTheDocument();

    fireEvent.click(screen.getByText("林夏:idle"));
    fireEvent.click(screen.getByText("开始生成"));

    await waitFor(() => {
      expect(screen.getByText("林夏:generating:排队中")).toBeInTheDocument();
    });
    expect(screen.getByTestId("modal-generating-types").textContent).toContain("\"full_body\"");
    expect(screen.getByTestId("modal-generating-types").textContent).toContain("\"queued\"");

    fireEvent.click(screen.getByText("关闭工作台"));

    await waitFor(() => {
      expect(screen.getByText("林夏:generating:排队中")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("林夏:generating:排队中"));
    expect(screen.getByTestId("modal-generating-types").textContent).toContain("\"full_body\"");
  });

  it("derives generating state from active backend jobs when reopening the panel", () => {
    mockTaskStoreState = {
      ...mockTaskStoreState,
      jobsById: {
        "job-series-1": {
          id: "job-series-1",
          task_type: "series.asset.generate",
          status: "running",
          queue_name: "image",
          priority: 100,
          series_id: "series-1",
          resource_type: "character",
          resource_id: "char-1",
          payload_json: {
            generation_type: "full_body",
            batch_size: 1,
          },
          attempt_count: 1,
          max_attempts: 2,
          created_at: "2026-04-05T00:00:00Z",
        },
      },
      jobIdsByProject: {
        "series-1": ["job-series-1"],
      },
    };

    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText("林夏:generating:生成中")).toBeInTheDocument();

    fireEvent.click(screen.getByText("林夏:generating:生成中"));
    expect(screen.getByTestId("modal-generating-types").textContent).toContain("\"full_body\"");
    expect(screen.getByTestId("modal-generating-types").textContent).toContain("\"running\"");
  });

  it("hydrates active series jobs from backend on mount so restart does not lose generating state", async () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockFetchProjectJobs).toHaveBeenCalledWith(
        undefined,
        ["queued", "claimed", "running", "retry_waiting", "cancel_requested"],
        { seriesId: "series-1", limit: 200 },
      );
    });
  });

  it("creates a new series asset through sync api", async () => {
    const handleSeriesUpdated = vi.fn();

    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={handleSeriesUpdated}
      />,
    );

    fireEvent.click(screen.getByText("新增资产"));
    fireEvent.change(screen.getByPlaceholderText("请输入角色名称"), {
      target: { value: "周野" },
    });
    fireEvent.change(screen.getByPlaceholderText("请输入角色描述"), {
      target: { value: "外冷内热的刑警" },
    });
    fireEvent.click(screen.getByText("创建资产"));

    await waitFor(() => {
      expect(mockSyncSeriesAssets).toHaveBeenCalledTimes(1);
    });

    const [, payload] = mockSyncSeriesAssets.mock.calls[0];
    expect(payload.expected_version).toBe(7);
    expect(payload.characters).toHaveLength(2);
    expect(payload.characters[1]).toMatchObject({
      name: "周野",
      description: "外冷内热的刑警",
    });
    expect(handleSeriesUpdated).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("已新增角色资产「周野」");
  });

  it("shows refreshed extract dialog copy and billing hint", () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("自动识别资产"));

    expect(screen.getByText("开始识别")).toBeInTheDocument();
    expect(screen.queryByText("按剧本处理页的实体提取规则计费")).not.toBeInTheDocument();
    expect(
      screen.queryByText("这一段会复用现有实体提取任务链路，识别完成后会回到当前页面做分组预览。"),
    ).not.toBeInTheDocument();
  });

  it("inherits studio theme tokens in extract and inbox dialogs", () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        theme="dark"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "自动识别资产" }));

    const modalHeading = screen.getByRole("heading", { name: "自动识别资产" });
    const extractDialogRoot = modalHeading.closest(".studio-theme-root");
    expect(extractDialogRoot).toBeTruthy();
    expect(extractDialogRoot).toHaveAttribute("data-studio-theme", "dark");
    expect(extractDialogRoot).toHaveClass("studio-modal-backdrop");
    expect(screen.getByText("输入待识别文本").parentElement).toHaveClass("video-card");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "待确认收件箱" }));

    const inboxDialogRoot = screen
      .getByRole("heading", { name: "待确认资产收件箱" })
      .closest(".studio-theme-root");
    expect(inboxDialogRoot).toBeTruthy();
    expect(inboxDialogRoot).toHaveAttribute("data-studio-theme", "dark");
    expect(inboxDialogRoot).toHaveClass("studio-modal-backdrop");
  });

  it("reuses video workspace segmented buttons in create dialog", () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新增资产" }));

    expect(screen.getByRole("button", { name: "角色" })).toHaveClass(
      "video-segmented-button",
      "video-segmented-button-active",
    );
    expect(screen.getByRole("button", { name: "场景" })).toHaveClass("video-segmented-button");
    expect(screen.getByRole("button", { name: "道具" })).toHaveClass("video-segmented-button");
  });

  it("shows and flips extract billing tooltip for the modal action even when the button is disabled", () => {
    mockBalanceCredits = 1;
    mockCanAffordExtract = false;
    mockCanAffordProjectReparse = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      if ((this as HTMLElement).dataset.testid === "billing-action-wrapper") {
        return {
          x: 120,
          y: 760,
          width: 180,
          height: 44,
          top: 760,
          right: 300,
          bottom: 804,
          left: 120,
          toJSON: () => ({}),
        };
      }
      if ((this as HTMLElement).textContent?.includes("预计消耗6算力豆，当前余额不足")) {
        return {
          x: 0,
          y: 0,
          width: 220,
          height: 42,
          top: 0,
          right: 220,
          bottom: 42,
          left: 0,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      };
    });

    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "自动识别资产" }));

    fireEvent.mouseEnter(screen.getByTestId("billing-action-wrapper"));

    const tooltip = screen.getByText("预计消耗6算力豆，当前余额不足");
    expect(tooltip).toHaveClass("bottom-full", "mb-2");
    expect(tooltip).not.toHaveClass("top-full");
  });

  it("opens shared asset workbench when clicking an asset card", () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "林夏:idle" }));

    expect(screen.getByText("工作台:林夏")).toBeInTheDocument();
  });

  it("extracts preview assets through series task without creating a temporary project", async () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "自动识别资产" }));
    fireEvent.change(screen.getByPlaceholderText("例如：粘贴完整剧本，或按行输入角色设定、场景说明、重要道具信息。"), {
      target: { value: "周野推门走进审讯室。" },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始识别/ }));

    await waitFor(() => {
      expect(mockExtractSeriesAssets).toHaveBeenCalledWith("series-1", "周野推门走进审讯室。");
    });
    await waitFor(() => {
      expect(mockWaitForJob).toHaveBeenCalledWith("job-series-extract-1", { intervalMs: 2000, maxAttempts: 240 });
    });
    expect(screen.getByText("周野")).toBeInTheDocument();
  });

  it("puts extracted assets into pending inbox first and syncs only after explicit inbox confirmation", async () => {
    render(
      <SeriesAssetStudioPanel
        series={baseSeries as any}
        tab="characters"
        onTabChange={vi.fn()}
        onSeriesUpdated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "自动识别资产" }));
    fireEvent.change(screen.getByPlaceholderText("例如：粘贴完整剧本，或按行输入角色设定、场景说明、重要道具信息。"), {
      target: { value: "周野推门走进审讯室。" },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始识别/ }));

    await waitFor(() => {
      expect(screen.getByText("周野")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "加入待确认收件箱" }));

    await waitFor(() => {
      expect(mockSyncSeriesAssets).not.toHaveBeenCalled();
    });
    expect(screen.getByText("收件箱里还有 1 项待人工确认")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "去确认并合并" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并合并到剧集资产" }));

    await waitFor(() => {
      expect(mockSyncSeriesAssets).toHaveBeenCalledTimes(1);
    });
  });

});
