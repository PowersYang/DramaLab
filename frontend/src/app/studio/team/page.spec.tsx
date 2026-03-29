import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListWorkspaceMembers = vi.fn();
const mockInviteWorkspaceMember = vi.fn();

vi.mock("@/components/studio/StudioShell", () => ({
  default: ({ children, title }: any) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: {
    listWorkspaceMembers: (...args: any[]) => mockListWorkspaceMembers(...args),
    inviteWorkspaceMember: (...args: any[]) => mockInviteWorkspaceMember(...args),
    updateWorkspaceMemberRole: vi.fn(),
    deleteWorkspaceMember: vi.fn(),
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      me: {
        current_role_code: "org_admin",
      },
      hasCapability: (capability: string) => capability === "workspace.manage_members",
    }),
}));

import StudioTeamRoutePage from "./page";

describe("StudioTeamRoutePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkspaceMembers.mockResolvedValue([
      {
        membership_id: "m1",
        display_name: "Owner",
        email: "owner@example.com",
        workspace_name: "默认工作区",
        role_code: "org_admin",
        role_name: "组织管理员",
      },
    ]);
    mockInviteWorkspaceMember.mockResolvedValue({ id: "invite-1" });
  });

  it("invites a producer from the team page", async () => {
    render(<StudioTeamRoutePage />);

    await waitFor(() => {
      expect(mockListWorkspaceMembers).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText("team@company.com"), { target: { value: "maker@example.com" } });
    fireEvent.click(screen.getByText("发送邀请"));

    await waitFor(() => {
      expect(mockInviteWorkspaceMember).toHaveBeenCalledWith("maker@example.com", "producer");
    });
  });
});
