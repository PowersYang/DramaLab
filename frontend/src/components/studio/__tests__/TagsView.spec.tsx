import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio/tasks",
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("lucide-react", () => ({
  X: () => <span />,
  ChevronLeft: () => <span />,
  ChevronRight: () => <span />,
}));

import TagsView from "../TagsView";
import { useStudioUiStore } from "@/store/studioUiStore";

describe("TagsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    useStudioUiStore.setState({ visitedViews: [] });
  });

  it("does not duplicate the same tag when parent rerenders with a new meta object", () => {
    const { rerender } = render(<TagsView currentMeta={{ title: "生产调度中心", path: "/studio/tasks" }} />);

    rerender(<TagsView currentMeta={{ title: "生产调度中心", path: "/studio/tasks" }} />);

    expect(screen.getAllByText("生产调度中心")).toHaveLength(1);
    expect(useStudioUiStore.getState().visitedViews).toEqual([
      {
        title: "生产调度中心",
        path: "/studio/tasks",
        name: "生产调度中心",
      },
    ]);
  });
});
