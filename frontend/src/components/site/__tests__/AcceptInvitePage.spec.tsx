import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockGetInvitationPreview = vi.fn();
const mockSendEmailCode = vi.fn();
const mockVerifyEmailCode = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock("@/components/site/MarketingShell", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getInvitationPreview: (...args: any[]) => mockGetInvitationPreview(...args),
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      sendEmailCode: mockSendEmailCode,
      verifyEmailCode: mockVerifyEmailCode,
    }),
}));

import AcceptInvitePage from "../AcceptInvitePage";

describe("AcceptInvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInvitationPreview.mockResolvedValue({
      id: "invite-1",
      email: "maker@example.com",
      role_code: "producer",
      role_name: "制作人员",
      organization_id: "org-1",
      organization_name: "银河短剧",
      workspace_id: "ws-1",
      workspace_name: "默认工作区",
      expires_at: "2026-04-01T00:00:00Z",
      accepted_at: null,
      is_expired: false,
    });
    mockSendEmailCode.mockResolvedValue({ debug_code: "654321" });
    mockVerifyEmailCode.mockResolvedValue({});
  });

  it("loads preview and accepts invite with invitation id", async () => {
    render(<AcceptInvitePage invitationId="invite-1" />);

    await waitFor(() => {
      expect(mockGetInvitationPreview).toHaveBeenCalledWith("invite-1");
    });
    expect(screen.getByText("银河短剧")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("例如：小林制片"), { target: { value: "Maker" } });
    fireEvent.click(screen.getByText("发送验证码"));

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledWith("maker@example.com", "invite_accept");
    });

    fireEvent.change(screen.getByPlaceholderText("输入 6 位验证码"), { target: { value: "654321" } });
    fireEvent.click(screen.getByText("确认加入团队"));

    await waitFor(() => {
      expect(mockVerifyEmailCode).toHaveBeenCalledWith("maker@example.com", "654321", {
        purpose: "invite_accept",
        displayName: "Maker",
        invitationId: "invite-1",
      });
    });
    expect(mockReplace).toHaveBeenCalledWith("/studio");
  });
});
