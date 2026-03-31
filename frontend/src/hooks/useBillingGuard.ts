"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type BillingAccountSummary, type BillingPricingRuleSummary } from "@/lib/api";

interface BillingGuardState {
  account: BillingAccountSummary | null;
  pricingRules: BillingPricingRuleSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getTaskPrice: (taskType: string) => number;
  canAffordTask: (taskType: string) => boolean;
}

const BILLING_CACHE_STORAGE_KEY = "dramalab-billing-cache-v1";
const BILLING_CACHE_REFRESH_WINDOW_MS = 30 * 1000;

interface BillingCacheSnapshot {
  account: BillingAccountSummary | null;
  pricingRules: BillingPricingRuleSummary[];
  loading: boolean;
  error: string | null;
  hydratedAt: number;
}

const EMPTY_CACHE_SNAPSHOT: BillingCacheSnapshot = {
  account: null,
  pricingRules: [],
  loading: true,
  error: null,
  hydratedAt: 0,
};

let billingCacheSnapshot: BillingCacheSnapshot = EMPTY_CACHE_SNAPSHOT;
let billingRefreshPromise: Promise<void> | null = null;
const billingCacheListeners = new Set<(snapshot: BillingCacheSnapshot) => void>();

function emitBillingCacheSnapshot() {
  billingCacheListeners.forEach((listener) => listener(billingCacheSnapshot));
}

function readBillingCacheFromStorage(): BillingCacheSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(BILLING_CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as BillingCacheSnapshot;
    if (!parsed || typeof parsed.hydratedAt !== "number") {
      return null;
    }
    return {
      account: parsed.account ?? null,
      pricingRules: Array.isArray(parsed.pricingRules) ? parsed.pricingRules : [],
      loading: false,
      error: null,
      hydratedAt: parsed.hydratedAt,
    };
  } catch {
    return null;
  }
}

function writeBillingCacheToStorage(snapshot: BillingCacheSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      BILLING_CACHE_STORAGE_KEY,
      JSON.stringify({
        account: snapshot.account,
        pricingRules: snapshot.pricingRules,
        hydratedAt: snapshot.hydratedAt,
      }),
    );
  } catch {
    // 忽略缓存写入失败，避免影响主流程。
  }
}

function getInitialBillingCacheSnapshot(): BillingCacheSnapshot {
  if (billingCacheSnapshot.hydratedAt > 0) {
    return billingCacheSnapshot;
  }

  const storageSnapshot = readBillingCacheFromStorage();
  if (storageSnapshot) {
    billingCacheSnapshot = storageSnapshot;
    return storageSnapshot;
  }

  return billingCacheSnapshot;
}

function shouldRefreshBillingCache(snapshot: BillingCacheSnapshot) {
  if (snapshot.hydratedAt <= 0) {
    return true;
  }
  return Date.now() - snapshot.hydratedAt > BILLING_CACHE_REFRESH_WINDOW_MS;
}

export function useBillingGuard(): BillingGuardState {
  const [snapshot, setSnapshot] = useState<BillingCacheSnapshot>(() => getInitialBillingCacheSnapshot());

  const refresh = async () => {
    if (billingRefreshPromise) {
      await billingRefreshPromise;
      return;
    }

    billingCacheSnapshot = {
      ...billingCacheSnapshot,
      loading: true,
      error: null,
    };
    emitBillingCacheSnapshot();

    billingRefreshPromise = (async () => {
      try {
        const [accountData, pricingData] = await Promise.all([
          api.getBillingAccount(),
          api.listCurrentBillingPricingRules(),
        ]);

        billingCacheSnapshot = {
          account: accountData,
          pricingRules: pricingData,
          loading: false,
          error: null,
          hydratedAt: Date.now(),
        };
        writeBillingCacheToStorage(billingCacheSnapshot);
      } catch (loadError) {
        billingCacheSnapshot = {
          ...billingCacheSnapshot,
          loading: false,
          error: loadError instanceof Error ? loadError.message : "加载算力豆信息失败",
        };
      } finally {
        emitBillingCacheSnapshot();
        billingRefreshPromise = null;
      }
    })();

    await billingRefreshPromise;
  };

  useEffect(() => {
    const handleSnapshotChange = (nextSnapshot: BillingCacheSnapshot) => {
      setSnapshot(nextSnapshot);
    };

    billingCacheListeners.add(handleSnapshotChange);
    setSnapshot(getInitialBillingCacheSnapshot());

    if (shouldRefreshBillingCache(billingCacheSnapshot)) {
      void refresh();
    }

    return () => {
      billingCacheListeners.delete(handleSnapshotChange);
    };
  }, []);

  const pricingMap = useMemo(
    () => new Map(snapshot.pricingRules.map((item) => [item.task_type, item.price_credits])),
    [snapshot.pricingRules],
  );

  const getTaskPrice = (taskType: string) => pricingMap.get(taskType) ?? 0;

  const canAffordTask = (taskType: string) => {
    const price = getTaskPrice(taskType);
    return (snapshot.account?.balance_credits ?? 0) >= price;
  };

  return {
    account: snapshot.account,
    pricingRules: snapshot.pricingRules,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh,
    getTaskPrice,
    canAffordTask,
  };
}
