import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMe = vi.fn();
const mockRefreshSession = vi.fn();
const mockSetAccessToken = vi.fn();
const mockGetAccessToken = vi.fn(() => null);

vi.mock("@/lib/api", () => ({
  api: {
    getMe: (...args: unknown[]) => mockGetMe(...args),
    refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
    getAuthCaptcha: vi.fn(),
    sendEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    resetPasswordWithCode: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
    switchWorkspace: vi.fn(),
  },
  getAccessToken: () => mockGetAccessToken(),
  setAccessToken: (token: string | null) => mockSetAccessToken(token),
}));

import { useAuthStore } from "./authStore";

describe("authStore.bootstrapAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    useAuthStore.setState({
      authStatus: "idle",
      me: null,
      isBootstrapping: false,
    });
  });

  it("falls back to anonymous when refresh session is unavailable", async () => {
    mockGetMe.mockRejectedValue(new Error("unauthorized"));
    mockRefreshSession.mockResolvedValue(null);

    await expect(useAuthStore.getState().bootstrapAuth()).resolves.toBeNull();

    expect(mockSetAccessToken).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().authStatus).toBe("anonymous");
    expect(useAuthStore.getState().me).toBeNull();
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });
});
