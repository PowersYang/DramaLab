import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendEmailCode = vi.fn();
const mockGetAuthCaptcha = vi.fn();
const mockVerifyEmailCode = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignUpWithPassword = vi.fn();
const mockResetPasswordWithCode = vi.fn();

interface MockLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  href: string;
}

interface MockAuthState {
  sendEmailCode: typeof mockSendEmailCode;
  getAuthCaptcha: typeof mockGetAuthCaptcha;
  verifyEmailCode: typeof mockVerifyEmailCode;
  signInWithPassword: typeof mockSignInWithPassword;
  signUpWithPassword: typeof mockSignUpWithPassword;
  resetPasswordWithCode: typeof mockResetPasswordWithCode;
}

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: MockLinkProps) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "next" ? "/studio" : null),
  }),
}));

vi.mock("@/components/site/MarketingShell", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) =>
    selector({
      sendEmailCode: mockSendEmailCode,
      getAuthCaptcha: mockGetAuthCaptcha,
      verifyEmailCode: mockVerifyEmailCode,
      signInWithPassword: mockSignInWithPassword,
      signUpWithPassword: mockSignUpWithPassword,
      resetPasswordWithCode: mockResetPasswordWithCode,
    }),
}));

import AuthEntryPage from "../AuthEntryPage";

describe("AuthEntryPage", () => {
  const originalLocation = window.location;

  const renderAuth = async (mode: "signin" | "signup") => {
    render(<AuthEntryPage mode={mode} />);
    await screen.findByAltText("图形验证码");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthCaptcha.mockResolvedValue({ captcha_id: "captcha-1", image_svg: "<svg></svg>", expires_in_seconds: 300, debug_code: "ABCD1" });
    mockSendEmailCode.mockResolvedValue({ status: "sent", target: "owner@example.com", channel: "email", purpose: "signup", debug_code: "123456" });
    mockVerifyEmailCode.mockResolvedValue({ user: { id: "u1" } });
    mockSignInWithPassword.mockResolvedValue({ user: { id: "u1" } });
    mockSignUpWithPassword.mockResolvedValue({ user: { id: "u1" } });
    mockResetPasswordWithCode.mockResolvedValue({ user: { id: "u1" } });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: vi.fn(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("submits password sign in by default", async () => {
    await renderAuth("signin");

    fireEvent.change(screen.getByPlaceholderText("请输入邮箱 / 手机号"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "strong-pass-123" } });
    fireEvent.click(screen.getByLabelText("主登录按钮"));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        channel: "email",
        identifier: "owner@example.com",
        password: "strong-pass-123",
        captchaId: "captcha-1",
        captchaCode: "ABCD1",
      });
    });
  });

  it("submits password signup in the simplified modal", async () => {
    await renderAuth("signup");

    fireEvent.change(screen.getByPlaceholderText("请输入邮箱 / 手机号"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "strong-pass-123" } });

    fireEvent.click(screen.getByLabelText("主注册按钮"));

    await waitFor(() => {
      expect(mockSignUpWithPassword).toHaveBeenCalledWith({
        channel: "email",
        identifier: "owner@example.com",
        password: "strong-pass-123",
        captchaId: "captcha-1",
        captchaCode: "ABCD1",
      });
    });
  });

  it("shows a clear SMTP configuration error when email delivery is unavailable", async () => {
    mockSendEmailCode.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: {
          detail: "Email delivery is not configured. Set SMTP config or enable AUTH_EXPOSE_TEST_CODE for testing.",
        },
      },
    });

    await renderAuth("signin");

    fireEvent.click(screen.getByText("短信登录"));
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.click(screen.getByText("获取验证码"));

    await waitFor(() => {
      expect(screen.getByText("当前环境还没有配置验证码邮件发送，请先补齐 SMTP 配置后再登录。")).toBeInTheDocument();
    });
  });

  it("shows a clear password length error during signup", async () => {
    mockSignUpWithPassword.mockRejectedValueOnce(new Error("Password must be at least 6 characters"));

    await renderAuth("signup");

    fireEvent.change(screen.getByPlaceholderText("请输入邮箱 / 手机号"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "12345" } });
    fireEvent.click(screen.getByLabelText("主注册按钮"));

    await waitFor(() => {
      expect(screen.getByText("密码至少需要 6 位。")).toBeInTheDocument();
    });
  });

  it("submits forgot-password reset flow", async () => {
    mockSendEmailCode.mockResolvedValueOnce({ status: "sent", target: "owner@example.com", channel: "email", purpose: "reset_password", debug_code: "654321" });

    await renderAuth("signin");

    fireEvent.change(screen.getByPlaceholderText("请输入邮箱 / 手机号"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.click(screen.getByText("忘记密码?"));
    fireEvent.click(screen.getByText("发送重置码"));

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledWith("owner@example.com", "reset_password", "email", {
        captchaId: "captcha-1",
        captchaCode: "ABCD1",
      });
    });

    fireEvent.change(screen.getByPlaceholderText("请输入验证码"), { target: { value: "654321" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ZXCV2" } });
    fireEvent.change(screen.getByPlaceholderText("设置新密码"), { target: { value: "new-pass-1" } });
    fireEvent.click(screen.getByLabelText("主登录按钮"));

    await waitFor(() => {
      expect(mockResetPasswordWithCode).toHaveBeenCalledWith({
        channel: "email",
        identifier: "owner@example.com",
        code: "654321",
        newPassword: "new-pass-1",
        captchaId: "captcha-1",
        captchaCode: "ZXCV2",
      });
    });
  });

  it("supports phone password sign in", async () => {
    await renderAuth("signin");

    fireEvent.change(screen.getByPlaceholderText("请输入邮箱 / 手机号"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByPlaceholderText("输入图形验证码"), { target: { value: "ABCD1" } });
    fireEvent.change(screen.getByPlaceholderText("请输入密码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByLabelText("主登录按钮"));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        channel: "phone",
        identifier: "13800138000",
        password: "123456",
        captchaId: "captcha-1",
        captchaCode: "ABCD1",
      });
    });
  });
});
