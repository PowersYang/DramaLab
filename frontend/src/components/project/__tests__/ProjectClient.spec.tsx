import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_REFRESH_PATH_STORAGE_KEY } from "@/components/project/projectNavigation";

const mockPush = vi.fn();
const mockSelectProject = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: mockPush,
    }),
    usePathname: () => "/studio/projects/project-1",
}));

vi.mock("next/dynamic", () => ({
    default: () => () => <div data-testid="creative-canvas" />,
}));

vi.mock("framer-motion", () => ({
    motion: {
        aside: ({ children, ...props }: any) => <aside {...props}>{children}</aside>,
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
}));

vi.mock("lucide-react", () => ({
    Layout: () => <span />,
    Film: () => <span />,
    Share2: () => <span />,
    Mic: () => <span />,
    Music: () => <span />,
    BookOpen: () => <span />,
    Users: () => <span />,
    Video: () => <span />,
    Sun: () => <span />,
    Moon: () => <span />,
    ChevronRight: () => <span />,
    ChevronLeft: () => <span />,
}));

vi.mock("@/components/layout/PipelineSidebar", () => ({
    default: ({ steps, onStepChange }: any) => (
        <div>
            {steps.map((step: { id: string; label: string }) => (
                <button key={step.id} onClick={() => onStepChange(step.id)}>
                    {step.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("@/components/project/ProjectRightSidebar", () => ({
    default: () => <div data-testid="project-right-sidebar" />,
}));

vi.mock("@/components/modules/ScriptProcessor", () => ({
    default: () => <div>剧本处理内容</div>,
}));

vi.mock("@/components/modules/ConsistencyVault", () => ({
    default: () => <div>资产制作内容</div>,
}));

vi.mock("@/components/modules/StoryboardComposer", () => ({
    default: () => <div>分镜设计内容</div>,
}));

vi.mock("@/components/modules/VideoGenerator", () => ({
    default: () => <div>视频生成内容</div>,
}));

vi.mock("@/components/modules/VideoAssembly", () => ({
    default: () => <div>视频组装内容</div>,
}));

vi.mock("@/components/modules/VoiceActingStudio", () => ({
    default: () => <div>配音制作内容</div>,
}));

vi.mock("@/components/modules/FinalMixStudio", () => ({
    default: () => <div>最终混剪内容</div>,
}));

vi.mock("@/components/modules/ExportStudio", () => ({
    default: () => <div>导出成片内容</div>,
}));

vi.mock("@/components/project/ProjectArtDirectionStatusCard", () => ({
    default: () => <div>美术来源卡片</div>,
}));

vi.mock("@/components/project/ProjectArtDirectionOverridePanel", () => ({
    default: () => <div>项目覆写面板</div>,
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: any) =>
        selector({
            hasHydrated: true,
            selectProject: mockSelectProject,
            currentProject: { id: "project-1", title: "测试项目" },
        }),
}));

vi.mock("@/components/project/projectNavigation", () => ({
    PROJECT_REFRESH_PATH_STORAGE_KEY: "dramalab-project-refresh-path",
    isPageReloadNavigation: vi.fn(() => false),
}));

import ProjectClient from "../ProjectClient";
import { isPageReloadNavigation } from "@/components/project/projectNavigation";

describe("ProjectClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        window.sessionStorage.clear();
    });

    it("opens the script step when entering a project from the workspace", async () => {
        window.localStorage.setItem("dramalab-project-active-step:project-1", "assets");
        vi.mocked(isPageReloadNavigation).mockReturnValue(false);

        render(<ProjectClient id="project-1" />);

        await waitFor(() => {
            expect(screen.getByText("剧本处理内容")).toBeInTheDocument();
        });
        expect(screen.queryByText("资产制作内容")).not.toBeInTheDocument();
        expect(mockSelectProject).toHaveBeenCalledWith("project-1");
    });

    it("restores the previous step after a browser refresh", async () => {
        window.localStorage.setItem("dramalab-project-active-step:project-1", "assets");
        window.sessionStorage.setItem(PROJECT_REFRESH_PATH_STORAGE_KEY, "/studio/projects/project-1");
        vi.mocked(isPageReloadNavigation).mockReturnValue(true);

        render(<ProjectClient id="project-1" />);

        await waitFor(() => {
            expect(screen.getByText("资产制作内容")).toBeInTheDocument();
        });
        expect(screen.queryByText("剧本处理内容")).not.toBeInTheDocument();
    });

    it("does not expose art direction as a pipeline step or top status card anymore", async () => {
        render(<ProjectClient id="project-1" />);

        await waitFor(() => {
            expect(screen.getByText("剧本处理内容")).toBeInTheDocument();
        });
        expect(screen.queryByRole("button", { name: "美术设定" })).not.toBeInTheDocument();
        expect(screen.queryByText("美术来源卡片")).not.toBeInTheDocument();
    });
});
