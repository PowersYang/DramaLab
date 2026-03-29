import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendEmailCode = vi.fn();
const mockVerifyEmailCode = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "next" ? "/studio" : null),
  }),
}));

vi.mock("@/components/site/MarketingShell", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: any) =>
    selector({
      sendEmailCode: mockSendEmailCode,
      verifyEmailCode: mockVerifyEmailCode,
    }),
}));

import AuthEntryPage from "../AuthEntryPage";

describe("AuthEntryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmailCode.mockResolvedValue({ status: "sent", email: "owner@example.com", purpose: "signup", debug_code: "123456" });
    mockVerifyEmailCode.mockResolvedValue({ user: { id: "u1" } });
    vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
  });

  it("submits org admin signup with organization name", async () => {
    render(<AuthEntryPage mode="signup" />);

    fireEvent.click(screen.getByText("创建团队空间"));
    fireEvent.change(screen.getByPlaceholderText("you@studio.com"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("例如：王制片，团队内会显示这个名称"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByPlaceholderText("例如：银河短剧工作室"), { target: { value: "银河短剧" } });

    fireEvent.click(screen.getByText("发送注册验证码"));

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledWith("owner@example.com", "signup");
    });

    fireEvent.change(screen.getByPlaceholderText("输入 6 位验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText("验证并创建账号"));

    await waitFor(() => {
      expect(mockVerifyEmailCode).toHaveBeenCalledWith("owner@example.com", "123456", {
        purpose: "signup",
        displayName: "Owner",
        signupKind: "org_admin",
        organizationName: "银河短剧",
      });
    });
  });
});
