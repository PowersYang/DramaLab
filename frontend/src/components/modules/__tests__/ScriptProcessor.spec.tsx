import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScriptProcessor from "../ScriptProcessor";
import { api, crudApi } from "@/lib/api";

const mockAnalyzeProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockProjectStoreState = {
    currentProject: {
        id: "project-1",
        title: "夜色追凶",
        originalText: "林夏在雨夜追查真相",
        characters: [],
        scenes: [],
        props: [],
        frames: [],
    },
    updateProject: mockUpdateProject,
    analyzeProject: mockAnalyzeProject,
};

vi.mock("framer-motion", () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("lucide-react", () => {
    const Icon = (props: any) => <span {...props} />;
    return {
        User: Icon,
        MapPin: Icon,
        Box: Icon,
        Save: Icon,
        Sparkles: Icon,
        Plus: Icon,
        Trash2: Icon,
        Wand2: Icon,
    };
});

vi.mock("@/lib/api", () => ({
    api: {
        getProject: vi.fn(),
        updateAssetAttributes: vi.fn(),
    },
    crudApi: {
        createCharacter: vi.fn(),
        createScene: vi.fn(),
        createProp: vi.fn(),
        deleteCharacter: vi.fn(),
        deleteScene: vi.fn(),
        deleteProp: vi.fn(),
    },
}));

vi.mock("@/lib/projectAssets", () => ({
    getEffectiveProjectCharacters: (project: any) => project.characters || [],
    getProjectCharacterSourceHint: () => "角色资产来自当前项目",
    isSeriesProject: () => false,
}));

vi.mock("@/hooks/useBillingGuard", () => ({
    useBillingGuard: () => ({
        account: { balance_credits: 42 },
        pricingRules: [],
        loading: false,
        error: null,
        refresh: vi.fn(),
        getTaskPrice: (taskType: string) => (taskType === "project.reparse" ? 6 : 0),
        canAffordTask: (taskType: string) => taskType === "project.reparse",
    }),
}));

vi.mock("@/components/billing/BillingActionButton", () => ({
    default: ({ children, priceCredits, balanceCredits, wrapperClassName, tooltipText, tooltipClassName, costClassName, ...props }: any) => (
        <button {...props}>{children}</button>
    ),
}));

vi.mock("@/components/modules/panelHeaderStyles", () => ({
    PANEL_HEADER_CLASS: "panel-header",
    PANEL_TITLE_CLASS: "panel-title",
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: any) =>
        selector(mockProjectStoreState),
}));

describe("ScriptProcessor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProjectStoreState.currentProject = {
            id: "project-1",
            title: "夜色追凶",
            originalText: "林夏在雨夜追查真相",
            characters: [],
            scenes: [],
            props: [],
            frames: [],
        };
    });

    it("shows the extract entities action and reuses the project analyze flow", async () => {
        mockAnalyzeProject.mockResolvedValue(undefined);

        render(
            <div className="studio-theme-root" data-studio-theme="light">
                <ScriptProcessor />
            </div>,
        );

        const extractButton = screen.getByRole("button", { name: "提取实体" });
        expect(extractButton).toBeInTheDocument();
        expect(extractButton).toHaveClass("studio-action-button", "studio-action-button-warm");
        expect(extractButton.className).not.toContain("text-amber-100");
        expect(extractButton.className).not.toContain("bg-amber-500/15");

        fireEvent.click(extractButton);

        await waitFor(() => {
            expect(mockAnalyzeProject).toHaveBeenCalledWith("林夏在雨夜追查真相");
        });
    });

    it("shows a clear hint when series-shared scene deletion keeps entity", async () => {
        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
        const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
        const sceneProject = {
            ...mockProjectStoreState.currentProject,
            series_id: "series-1",
            scenes: [{ id: "scene-1", name: "医院走廊", description: "共享场景" }],
        };
        mockProjectStoreState.currentProject = sceneProject as any;
        (api.getProject as any).mockResolvedValue(sceneProject);

        render(
            <div className="studio-theme-root" data-studio-theme="light">
                <ScriptProcessor />
            </div>,
        );

        const deleteButton = screen.getByTitle("Delete");
        fireEvent.click(deleteButton);

        await waitFor(() => {
            expect(crudApi.deleteScene).toHaveBeenCalledWith("project-1", "scene-1");
        });
        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("剧集共享场景"));
        });
        expect(confirmSpy).toHaveBeenCalled();
    });
});
