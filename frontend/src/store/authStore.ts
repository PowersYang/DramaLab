"use client";

import { create } from "zustand";

import { api, setAccessToken, type AuthMeResponse } from "@/lib/api";

type AuthStatus = "idle" | "loading" | "authenticated" | "anonymous";

interface AuthState {
  authStatus: AuthStatus;
  me: AuthMeResponse | null;
  isBootstrapping: boolean;
  bootstrapAuth: () => Promise<AuthMeResponse | null>;
  sendEmailCode: (email: string, purpose?: string) => Promise<{ status: string; email: string; purpose: string; debug_code?: string }>;
  verifyEmailCode: (email: string, code: string, displayName?: string, purpose?: string) => Promise<AuthMeResponse>;
  signOut: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<AuthMeResponse>;
  hasCapability: (capability: string) => boolean;
  hasRole: (roleCode: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authStatus: "idle",
  me: null,
  isBootstrapping: false,

  bootstrapAuth: async () => {
    if (get().isBootstrapping) {
      return get().me;
    }
    set({ isBootstrapping: true, authStatus: get().me ? "authenticated" : "loading" });
    try {
      const payload = await api.refreshSession();
      setAccessToken(payload.session.access_token);
      set({ me: payload.me, authStatus: "authenticated", isBootstrapping: false });
      return payload.me;
    } catch {
      setAccessToken(null);
      set({ me: null, authStatus: "anonymous", isBootstrapping: false });
      return null;
    }
  },

  sendEmailCode: async (email, purpose = "signin") => {
    return await api.sendEmailCode(email, purpose);
  },

  verifyEmailCode: async (email, code, displayName, purpose = "signin") => {
    const payload = await api.verifyEmailCode(email, code, displayName, purpose);
    setAccessToken(payload.session.access_token);
    set({ me: payload.me, authStatus: "authenticated" });
    return payload.me;
  },

  signOut: async () => {
    await api.logout();
    setAccessToken(null);
    set({ me: null, authStatus: "anonymous" });
  },

  switchWorkspace: async (workspaceId: string) => {
    const payload = await api.switchWorkspace(workspaceId);
    setAccessToken(payload.session.access_token);
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
