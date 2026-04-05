import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetStylePresets = vi.fn();
const mockGetUserArtStyles = vi.fn();
const mockSaveUserArtStyles = vi.fn();
const mockSaveArtDirection = vi.fn();
const mockUpdateProject = vi.fn();

const mockProject = {
    id: "project-1",
    art_direction: {
        selected_style_id: "preset-realistic",
        style_config: {
            id: "preset-realistic",
            name: "写实电影感",
            description: "默认预设",
            positive_prompt: "cinematic lighting",
            negative_prompt: "blurry",
            is_custom: false,
        },
        custom_styles: [
            {
                id: "deleted-style",
                name: "已删除旧风格",
                description: "项目里遗留的旧数据",
                positive_prompt: "old prompt",
                negative_prompt: "old negative",
                is_custom: true,
            },
        ],
        ai_recommendations: [],
    },
};

vi.mock("next/link", () => ({
    default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("framer-motion", () => ({
    motion: {
        div: ({ children, ...props }: any) => {
            const { layout, ...rest } = props;
            return <div {...rest}>{children}</div>;
        },
    },
}));

vi.mock("lucide-react", () => ({
    Sparkles: (props: any) => <span data-testid="icon-sparkles" {...props} />,
    SwatchBook: (props: any) => <span data-testid="icon-swatch-book" {...props} />,
    Check: (props: any) => <span data-testid="icon-check" {...props} />,
    Loader2: (props: any) => <span data-testid="icon-loader" {...props} />,
    Plus: (props: any) => <span data-testid="icon-plus" {...props} />,
}));

vi.mock("@/lib/api", () => ({
    api: {
        getStylePresets: (...args: any[]) => mockGetStylePresets(...args),
        getUserArtStyles: (...args: any[]) => mockGetUserArtStyles(...args),
        saveUserArtStyles: (...args: any[]) => mockSaveUserArtStyles(...args),
        saveArtDirection: (...args: any[]) => mockSaveArtDirection(...args),
    },
}));

vi.mock("@/store/projectStore", () => ({
    useProjectStore: (selector: any) => selector({
        currentProject: mockProject,
        updateProject: mockUpdateProject,
    }),
}));

import ArtDirection from "../ArtDirection";

describe("ArtDirection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetStylePresets.mockResolvedValue({ presets: [] });
        mockGetUserArtStyles.mockResolvedValue({
            styles: [
                {
                    id: "active-style",
                    name: "数据库当前风格",
                    description: "只应该显示后端风格库结果",
                    positive_prompt: "fresh prompt",
                    negative_prompt: "bad anatomy",
                    is_custom: true,
                },
            ],
        });
        mockSaveUserArtStyles.mockResolvedValue({ styles: [] });
        mockSaveArtDirection.mockResolvedValue(mockProject);
        vi.stubGlobal("alert", vi.fn());
    });

    it("renders only styles returned by the backend user style library", async () => {
        render(<ArtDirection />);

        await waitFor(() => {
            expect(screen.getByText("数据库当前风格")).toBeInTheDocument();
        });

        expect(screen.queryByText("已删除旧风格")).not.toBeInTheDocument();
    });

    it("reloads styles from the backend after saving a custom style", async () => {
        mockGetUserArtStyles
            .mockResolvedValueOnce({ styles: [] })
            .mockResolvedValueOnce({
                styles: [
                    {
                        id: "server-style",
                        name: "服务端新风格",
                        description: "保存后应立即按数据库结果回显",
                        positive_prompt: "server prompt",
                        negative_prompt: "server negative",
                        is_custom: true,
                    },
                ],
            });

        render(<ArtDirection />);

        await waitFor(() => {
            expect(mockGetUserArtStyles).toHaveBeenCalledTimes(1);
        });

        fireEvent.click(screen.getByText("添加自定义风格"));
        fireEvent.change(screen.getByPlaceholderText("例如：浮世绘 / 赛博朋克 / 国风水墨"), {
            target: { value: "本地草稿风格" },
        });
        fireEvent.change(screen.getByPlaceholderText("例如：电影感光影、强细节、清晰线条、统一风格词…"), {
            target: { value: "local prompt" },
        });
        fireEvent.click(screen.getByText("保存自定义风格"));

        await waitFor(() => {
            expect(mockSaveUserArtStyles).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(mockGetUserArtStyles).toHaveBeenCalledTimes(2);
            expect(screen.getByText("服务端新风格")).toBeInTheDocument();
        });

        expect(screen.queryByText("本地草稿风格")).not.toBeInTheDocument();
    });
});
