import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateProject = vi.fn();

vi.mock("framer-motion", () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
}));

vi.mock("lucide-react", () => {
    const Icon = (props: any) => <span {...props} />;
    return {
        X: Icon,
        RefreshCw: Icon,
        Lock: Icon,
        Video: Icon,
        Sparkles: Icon,
        Eye: Icon,
        ChevronLeft: Icon,
        User: Icon,
        Check: Icon,
        Image: Icon,
    };
});

vi.mock("@/components/billing/BillingActionButton", () => ({
    default: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/hooks/useBillingGuard", () => ({
    useBillingGuard: () => ({
        account: { balance_credits: 100 },
        getTaskPrice: () => 1,
        canAffordTask: () => true,
    }),
}));

vi.mock("@/lib/api", () => ({
    api: {
        selectAssetVariant: vi.fn(),
        getProject: vi.fn(),
    },
}));

vi.mock("@/lib/modelCatalog", () => ({
    useAvailableModelCatalog: () => ({
        catalog: { t2i: [], i2i: [], i2v: [], llm: [] },
        loading: false,
    }),
}));

vi.mock("@/lib/utils", () => ({
    getAssetUrl: (value?: string | null) => value || "",
    normalizeComparableAssetPath: (value?: string | null) => value || "",
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: any) =>
        selector({
            currentProject: {
                id: "project-1",
                model_settings: {
                    t2i_model: "wan2.5-t2i-preview",
                },
                video_tasks: [],
                characters: [],
            },
            updateProject: mockUpdateProject,
        }),
}));

import CharacterWorkbench from "../CharacterWorkbench";

describe("CharacterWorkbench", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does not render a model selector in the workbench modal", () => {
        render(
            <CharacterWorkbench
                asset={{
                    id: "character-1",
                    name: "测试角色",
                    description: "角色描述",
                    full_body_asset: {
                        selected_id: "variant-1",
                        variants: [
                            {
                                id: "variant-1",
                                url: "/variant-1.png",
                                created_at: "2026-04-05T00:00:00Z",
                            },
                        ],
                    },
                }}
                onClose={vi.fn()}
                onUpdateDescription={vi.fn()}
                onGenerate={vi.fn()}
                generatingTypes={[]}
                staticModelOptions={[
                    {
                        id: "wan2.5-t2i-preview",
                        name: "Wan 2.5",
                        description: "默认生图模型",
                    },
                ]}
            />,
        );

        expect(screen.queryByText("本次生图模型")).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue("Wan 2.5")).not.toBeInTheDocument();
    });

    it("defaults to motion mode when the active panel already has generated motion videos", () => {
        render(
            <CharacterWorkbench
                asset={{
                    id: "character-1",
                    name: "测试角色",
                    description: "角色描述",
                    full_body_image_url: "/variant-1.png",
                    full_body_asset: {
                        selected_id: "variant-1",
                        variants: [
                            {
                                id: "variant-1",
                                url: "/variant-1.png",
                                created_at: "2026-04-05T00:00:00Z",
                            },
                        ],
                    },
                    full_body: {
                        image_variants: [],
                        video_variants: [
                            {
                                id: "video-1",
                                url: "/motion-1.mp4",
                                created_at: "2026-04-05T01:00:00Z",
                            },
                        ],
                    },
                }}
                onClose={vi.fn()}
                onUpdateDescription={vi.fn()}
                onGenerate={vi.fn()}
                onGenerateVideo={vi.fn()}
                generatingTypes={[]}
            />,
        );

        expect(screen.getByText("生成时长")).toBeInTheDocument();
        expect(screen.queryByText("立即生成动态参考")).not.toBeInTheDocument();
        expect(screen.getByText("生成动态参考")).toBeInTheDocument();
    });

    it("shows a motion empty state instead of leaving the preview rail blank", async () => {
        render(
            <CharacterWorkbench
                asset={{
                    id: "character-1",
                    name: "测试角色",
                    description: "角色描述",
                    full_body_image_url: "/variant-1.png",
                    full_body_asset: {
                        selected_id: "variant-1",
                        variants: [
                            {
                                id: "variant-1",
                                url: "/variant-1.png",
                                created_at: "2026-04-05T00:00:00Z",
                            },
                        ],
                    },
                }}
                onClose={vi.fn()}
                onUpdateDescription={vi.fn()}
                onGenerate={vi.fn()}
                onGenerateVideo={vi.fn()}
                generatingTypes={[]}
            />,
        );

        screen.getByRole("button", { name: "动态" }).click();

        expect(await screen.findByText("还没有动态参考视频")).toBeInTheDocument();
    });

    it("hides previous static variants while a new generation batch is running", () => {
        render(
            <CharacterWorkbench
                asset={{
                    id: "character-1",
                    name: "测试角色",
                    description: "角色描述",
                    full_body_asset: {
                        selected_id: "variant-old",
                        variants: [
                            {
                                id: "variant-old",
                                url: "/variant-old.png",
                                created_at: "2026-04-05T00:00:00Z",
                            },
                        ],
                    },
                }}
                onClose={vi.fn()}
                onUpdateDescription={vi.fn()}
                onGenerate={vi.fn()}
                generatingTypes={[{ type: "full_body", batchSize: 4 }]}
            />,
        );

        expect(screen.queryByAltText("Variant")).not.toBeInTheDocument();
        expect(screen.getAllByText("Generating")).toHaveLength(4);
        expect(screen.getByText("4 RECORDS")).toBeInTheDocument();
    });
});
