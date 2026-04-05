import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProjectSummaries = vi.fn();
const mockListSeriesSummaries = vi.fn();
const mockListTasks = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/dynamic", () => ({
  default: (loader: any) => {
    const LazyComponent = (props: any) => {
      const Component = loader();
      return typeof Component === "function" ? <Component {...props} /> : null;
    };
    return LazyComponent;
  },
}));

vi.mock("@/components/studio/admin/AdminSummaryStrip", () => ({
  default: ({ items }: any) => (
    <div data-testid="admin-summary-strip">
      {items?.map((item: any) => (
        <span key={item.label}>{item.label}:{item.value}</span>
      ))}
    </div>
  ),
}));

vi.mock("@/components/studio/announcement/AnnouncementBoard", () => ({
  default: () => <div data-testid="announcement-board" />,
}));

vi.mock("@/components/studio/announcement/AnnouncementManagerDialog", () => ({
  default: () => null,
}));

vi.mock("@/components/project/CreateProjectDialog", () => ({
  default: () => <div data-testid="create-project-dialog" />,
}));

vi.mock("@/components/series/ImportFileDialog", () => ({
  default: () => <div data-testid="import-file-dialog" />,
}));

vi.mock("@/components/studio/CreateSeriesDialog", () => ({
  default: () => <div data-testid="create-series-dialog" />,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      authStatus: "authenticated",
      isBootstrapping: false,
      hasCapability: () => false,
    }),
}));

vi.mock("@/store/projectStore", () => ({
  useProjectStore: (selector: any) =>
    selector({
      deleteProject: vi.fn(),
      deleteSeries: vi.fn(),
    }),
}));

vi.mock("@/lib/studioCache", () => ({
  STUDIO_PROJECT_SUMMARIES_CACHE_KEY: "project-summaries",
  STUDIO_SERIES_SUMMARIES_CACHE_KEY: "series-summaries",
  STUDIO_TASK_LIST_CACHE_KEY: "task-list",
  isStudioCacheFresh: () => false,
  loadStudioCacheResource: async (_key: string, loader: () => Promise<any>) => ({
    data: await loader(),
  }),
  readStudioCache: () => null,
  writeStudioCache: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getProjectSummaries: (...args: any[]) => mockGetProjectSummaries(...args),
    listSeriesSummaries: (...args: any[]) => mockListSeriesSummaries(...args),
    listTasks: (...args: any[]) => mockListTasks(...args),
    getSeriesEpisodeBriefs: vi.fn().mockResolvedValue([]),
  },
}));

import StudioDashboardPage from "@/components/studio/StudioDashboardPage";
import StudioProjectsPage from "@/components/studio/StudioProjectsPage";

describe("Studio information architecture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectSummaries.mockResolvedValue([
      {
        id: "project-1",
        title: "第一集",
        status: "processing",
        updated_at: "2026-04-05T09:00:00.000Z",
      },
      {
        id: "project-2",
        title: "第二集",
        status: "completed",
        updated_at: "2026-04-04T09:00:00.000Z",
      },
    ]);
    mockListSeriesSummaries.mockResolvedValue([
      {
        id: "series-1",
        title: "豪门风暴",
        description: "都市短剧",
        episode_count: 1,
        character_count: 2,
        scene_count: 1,
        prop_count: 0,
        frame_count: 6,
        updated_at: "2026-04-05T09:00:00.000Z",
      },
    ]);
    mockListTasks.mockResolvedValue([]);
  });

  it("shows create show as the primary dashboard action", async () => {
    render(<StudioDashboardPage />);

    await waitFor(() => {
      expect(mockGetProjectSummaries).toHaveBeenCalled();
    });

    expect(screen.getByText("新建剧集")).toBeInTheDocument();
    expect(screen.queryByText("新建项目")).not.toBeInTheDocument();
    expect(screen.getByText("进行中项目:1")).toBeInTheDocument();
  });

  it("treats shows as the primary object in the studio ledger", async () => {
    render(<StudioProjectsPage />);

    await waitFor(() => {
      expect(mockListSeriesSummaries).toHaveBeenCalled();
    });

    expect(screen.getByText("剧集列表")).toBeInTheDocument();
    expect(screen.getByText("新建剧集")).toBeInTheDocument();
    expect(screen.queryByText("全部台账")).not.toBeInTheDocument();
    expect(screen.queryByText("独立创作项目")).not.toBeInTheDocument();
    expect(screen.queryByText("全部")).not.toBeInTheDocument();
    expect(screen.queryByText("最近编辑")).not.toBeInTheDocument();
    expect(screen.queryByText("待推进")).not.toBeInTheDocument();
  });
});
