"use client";

import { create } from "zustand";

import type { MarketingAuthMode } from "@/components/site/marketingAuthHref";

interface MarketingAuthState {
  mode: MarketingAuthMode | null;
  open: (mode: MarketingAuthMode) => void;
  close: () => void;
}

export const useMarketingAuthStore = create<MarketingAuthState>((set) => ({
  mode: null,
  open: (mode) => set({ mode }),
  close: () => set({ mode: null }),
}));
