"use client";

import { create } from "zustand";

import {
  api,
  getAccessToken,
  setAccessToken,
  type AuthCaptchaPayload,
  type AuthMeResponse,
  type CaptchaVerificationOptions,
  type ChangePasswordOptions,
  type PasswordSignInOptions,
  type PasswordSignUpOptions,
  type ResetPasswordOptions,
  type VerifyEmailCodeOptions,
} from "@/lib/api";

type AuthStatus = "idle" | "loading" | "authenticated" | "anonymous";

const AUTH_SNAPSHOT_STORAGE_KEY = "dramalab-auth-snapshot-v1";

interface AuthSnapshot {
  accessToken: string | null;
  me: AuthMeResponse | null;
}

const readAuthSnapshot = (): AuthSnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUTH_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AuthSnapshot | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      me: parsed.me ?? null,
    };
  } catch (error) {
    console.error("Failed to read auth snapshot:", error);
    return null;
  }
};

const writeAuthSnapshot = (snapshot: AuthSnapshot) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(AUTH_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.error("Failed to write auth snapshot:", error);
  }
};

const clearAuthSnapshot = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(AUTH_SNAPSHOT_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear auth snapshot:", error);
  }
};

interface AuthState {
  authStatus: AuthStatus;
  me: AuthMeResponse | null;
  isBootstrapping: boolean;
  restoreSnapshot: () => void;
  bootstrapAuth: () => Promise<AuthMeResponse | null>;
  getAuthCaptcha: () => Promise<AuthCaptchaPayload>;
  sendEmailCode: (
    target: string,
    purpose?: string,
    channel?: "email" | "phone",
    captcha?: CaptchaVerificationOptions,
  ) => Promise<{ status: string; target: string; channel: "email" | "phone"; purpose: string; debug_code?: string }>;
  verifyEmailCode: (target: string, code: string, options?: VerifyEmailCodeOptions) => Promise<AuthMeResponse>;
  signInWithPassword: (payload: PasswordSignInOptions) => Promise<AuthMeResponse>;
  signUpWithPassword: (payload: PasswordSignUpOptions) => Promise<AuthMeResponse>;
  resetPasswordWithCode: (payload: ResetPasswordOptions) => Promise<AuthMeResponse>;
  changePassword: (payload: ChangePasswordOptions) => Promise<AuthMeResponse>;
  signOut: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<AuthMeResponse>;
  hasCapability: (capability: string) => boolean;
  hasRole: (roleCode: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // 中文注释：首屏必须让服务端和客户端输出一致，避免在模块初始化阶段读取 sessionStorage 触发 hydration mismatch。
  authStatus: "idle",
  me: null,
  isBootstrapping: false,

  restoreSnapshot: () => {
    const snapshot = readAuthSnapshot();
    if (!snapshot?.me) {
      return;
    }

    if (snapshot.accessToken) {
      setAccessToken(snapshot.accessToken);
    }

    // 中文注释：先用本地快照秒开工作台壳层，再在后台静默校验会话，避免首进工作台时整页被鉴权恢复阻塞。
    set({
      me: snapshot.me,
      authStatus: "authenticated",
    });
  },

  bootstrapAuth: async () => {
    if (get().isBootstrapping) {
      return get().me;
    }

    // 中文注释：缓存恢复放到挂载后的 bootstrap 流程里做，这样不会让浏览器首帧和 SSR 首帧出现不同结构。
    const snapshot = readAuthSnapshot();
    if (snapshot?.accessToken) {
      setAccessToken(snapshot.accessToken);
    }

    set({
      me: snapshot?.me ?? get().me,
      isBootstrapping: true,
      authStatus: snapshot?.me ?? get().me ? "authenticated" : "loading",
    });

    try {
      try {
        const me = await api.getMe();
        writeAuthSnapshot({ accessToken: getAccessToken(), me });
        set({ me, authStatus: "authenticated", isBootstrapping: false });
        return me;
      } catch {
        const payload = await api.refreshSession();
        // 中文注释：refresh 接口在无会话时会返回 null，这里直接收敛到外层匿名态分支，不再把正常未登录场景当成运行时错误。
        if (!payload) {
          throw new Error("No active auth session");
        }
        setAccessToken(payload.session.access_token);
        writeAuthSnapshot({ accessToken: payload.session.access_token, me: payload.me });
        set({ me: payload.me, authStatus: "authenticated", isBootstrapping: false });
        return payload.me;
      }
    } catch {
      setAccessToken(null);
      clearAuthSnapshot();
      set({ me: null, authStatus: "anonymous", isBootstrapping: false });
      return null;
    }
  },

  getAuthCaptcha: async () => {
    return await api.getAuthCaptcha();
  },

  sendEmailCode: async (target, purpose = "signin", channel = "email", captcha) => {
    return await api.sendEmailCode(target, purpose, channel, captcha);
  },

  verifyEmailCode: async (target, code, options = {}) => {
    const payload = await api.verifyEmailCode(target, code, options);
    setAccessToken(payload.session.access_token);
    writeAuthSnapshot({ accessToken: payload.session.access_token, me: payload.me });
    set({ me: payload.me, authStatus: "authenticated" });
    return payload.me;
  },

  signInWithPassword: async (payload) => {
    const result = await api.signInWithPassword(payload);
    setAccessToken(result.session.access_token);
    writeAuthSnapshot({ accessToken: result.session.access_token, me: result.me });
    set({ me: result.me, authStatus: "authenticated" });
    return result.me;
  },

  signUpWithPassword: async (payload) => {
    const result = await api.signUpWithPassword(payload);
    setAccessToken(result.session.access_token);
    writeAuthSnapshot({ accessToken: result.session.access_token, me: result.me });
    set({ me: result.me, authStatus: "authenticated" });
    return result.me;
  },

  resetPasswordWithCode: async (payload) => {
    const result = await api.resetPasswordWithCode(payload);
    setAccessToken(result.session.access_token);
    writeAuthSnapshot({ accessToken: result.session.access_token, me: result.me });
    set({ me: result.me, authStatus: "authenticated" });
    return result.me;
  },

  changePassword: async (payload) => {
    const me = await api.changePassword(payload);
    writeAuthSnapshot({ accessToken: getAccessToken(), me });
    set({ me, authStatus: "authenticated" });
    return me;
  },

  signOut: async () => {
    await api.logout();
    setAccessToken(null);
    clearAuthSnapshot();
    set({ me: null, authStatus: "anonymous" });
  },

  switchWorkspace: async (workspaceId: string) => {
    const payload = await api.switchWorkspace(workspaceId);
    setAccessToken(payload.session.access_token);
    writeAuthSnapshot({ accessToken: payload.session.access_token, me: payload.me });
    set({ me: payload.me, authStatus: "authenticated" });
    return payload.me;
  },

  hasCapability: (capability: string) => {
    return Boolean(get().me?.capabilities.includes(capability));
  },

  hasRole: (roleCode: string) => {
    const me = get().me;
    if (!me) return false;
    return me.current_role_code === roleCode || me.user.platform_role === roleCode;
  },
}));
