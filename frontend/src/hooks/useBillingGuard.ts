"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type BillingAccountSummary, type BillingPricingRuleSummary } from "@/lib/api";

interface BillingGuardState {
  account: BillingAccountSummary | null;
  pricingRules: BillingPricingRuleSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getTaskPrice: (taskType: string) => number | null;
  canAffordTask: (taskType: string) => boolean;
}

export function useBillingGuard(): BillingGuardState {
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [pricingRules, setPricingRules] = useState<BillingPricingRuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const [accountData, pricingData] = await Promise.all([
        api.getBillingAccount(),
        api.listCurrentBillingPricingRules(),
      ]);
      setAccount(accountData);
      setPricingRules(pricingData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载算力豆信息失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const pricingMap = useMemo(
    () => new Map(pricingRules.map((item) => [item.task_type, item.price_credits])),
    [pricingRules],
  );

  const getTaskPrice = (taskType: string) => pricingMap.get(taskType) ?? null;

  const canAffordTask = (taskType: string) => {
    const price = getTaskPrice(taskType);
    if (price == null) {
      return true;
    }
    return (account?.balance_credits ?? 0) >= price;
  };

  return {
    account,
    pricingRules,
    loading,
    error,
    refresh,
    getTaskPrice,
    canAffordTask,
  };
}
