import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBootstrapAuth = vi.fn();
const mockSignOut = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

const mockState = {
  authStatus: "authenticated",
  me: {
    user: {
      id: "user-1",
      email: "owner@example.com",
      display_name: "王制片",
      auth_provider: "email",
      status: "active",
      created_at: "2026-03-30T00:00:00Z",
      updated_at: "2026-03-30T00:00:00Z",
    },
    current_workspace_id: "workspace-1",
    current_role_name: "导演",
    is_platform_super_admin: false,
    capabilities: [],
    workspaces: [
      {
        workspace_id: "workspace-1",
        workspace_name: "银河短剧工作室",
        role_name: "导演",
      },
    ],
    memberships: [],
  },
  bootstrapAuth: mockBootstrapAuth,
  signOut: mockSignOut,
};

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: any) => selector(mockState),
}));

import MarketingAuthActions from "../MarketingAuthActions";

describe("MarketingAuthActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  it("shows the role dropdown for authenticated users", () => {
    render(<MarketingAuthActions />);

    expect(screen.getByText("导演")).toBeInTheDocument();
    expect(screen.getByText("进入工作台")).toBeInTheDocument();
  });

  it("signs out from the marketing dropdown menu", async () => {
    render(<MarketingAuthActions />);

    fireEvent.click(screen.getByText("导演"));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/signin");
    });
  });
});
