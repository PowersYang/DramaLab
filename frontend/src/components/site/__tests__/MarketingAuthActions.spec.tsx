import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBootstrapAuth = vi.fn();
const mockSignOut = vi.fn();
const mockOpenAuthDialog = vi.fn();

const authenticatedState = {
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

const mockState = {
  ...authenticatedState,
};

type MockAuthState = typeof mockState;
type MockMarketingAuthState = {
  open: typeof mockOpenAuthDialog;
};

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) => selector(mockState),
}));

vi.mock("@/store/marketingAuthStore", () => ({
  useMarketingAuthStore: (selector: (state: MockMarketingAuthState) => unknown) =>
    selector({
      open: mockOpenAuthDialog,
    }),
}));

import MarketingAuthActions from "../MarketingAuthActions";

describe("MarketingAuthActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    Object.assign(mockState, authenticatedState);
  });

  it("shows the role dropdown for authenticated users", () => {
    render(<MarketingAuthActions />);

    expect(screen.getByText("导演")).toBeInTheDocument();
    expect(screen.getByText("进入工作台")).toBeInTheDocument();
  });

  it("shows signin actions immediately while marketing auth is bootstrapping without a local user", () => {
    Object.assign(mockState, {
      authStatus: "idle",
      me: null,
    });

    render(<MarketingAuthActions />);

    expect(screen.getByText("登录")).toBeInTheDocument();
    expect(screen.getByText("注册")).toBeInTheDocument();
    expect(mockBootstrapAuth).toHaveBeenCalledTimes(1);
  });

  it("opens modal state instead of changing route for logged-out actions", () => {
    Object.assign(mockState, {
      authStatus: "anonymous",
      me: null,
    });

    render(<MarketingAuthActions />);

    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(mockOpenAuthDialog).toHaveBeenNthCalledWith(1, "signin");
    expect(mockOpenAuthDialog).toHaveBeenNthCalledWith(2, "signup");
  });

  it("signs out from the marketing dropdown menu", async () => {
    Object.assign(mockState, authenticatedState);
    render(<MarketingAuthActions />);

    fireEvent.click(screen.getByText("导演"));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockOpenAuthDialog).toHaveBeenCalledWith("signin");
    });
  });
});
