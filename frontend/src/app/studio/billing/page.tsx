"use client";

import { useEffect, useMemo, useState } from "react";
import { Coins, Loader2, RefreshCw } from "lucide-react";

import { api, type BillingAccountSummary, type BillingTransactionSummary } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  recharge: "充值入账",
  bonus: "充值赠送",
  task_debit: "任务扣费",
  manual_adjust: "人工调整",
  refund: "退款返还",
  reversal: "冲正",
};

export default function StudioBillingRoutePage() {
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const me = useAuthStore((state) => state.me);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [transactions, setTransactions] = useState<BillingTransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const [accountData, transactionData] = await Promise.all([
        api.getBillingAccount(),
        api.listBillingTransactions({ limit: 20 }),
      ]);
      setAccount(accountData);
      setTransactions(transactionData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载账务信息失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!hasCapability("workspace.manage_billing")) {
      return;
    }
    void load(true);
  }, [hasCapability]);

  const grouped = useMemo(
    () => ({
      recharges: transactions.filter((item) => item.direction === "credit"),
      debits: transactions.filter((item) => item.direction === "debit"),
    }),
    [transactions],
  );

  const currentOrganizationName = useMemo(() => {
    const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
    return currentWorkspace?.organization_name || account?.organization_id || "未绑定组织";
  }, [account?.organization_id, me]);

  if (!hasCapability("workspace.manage_billing")) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看计费与套餐配置的权限。普通制作人员与个人空间用户不会暴露账单、额度和企业套餐配置入口。
      </section>
    );
  }

  if (loading) {
    return (
      <section className="studio-panel flex min-h-[320px] items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <section className="studio-panel p-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        </section>
      ) : null}

      <section className="studio-panel overflow-hidden">
        <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(191,161,74,0.14),_transparent_38%),linear-gradient(135deg,_#fffdf7_0%,_#f6f1e7_100%)] px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Billing</p>
              <h2 className="text-2xl font-bold text-slate-950">组织算力豆账本</h2>
              <p className="max-w-3xl text-sm leading-7 text-slate-600">
                当前页已经接入真实账本与流水接口。现在可以查看当前组织余额、最近充值/赠送记录，以及每次生成任务的扣豆明细。
              </p>
            </div>
            <button
              onClick={() => void load(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新账本
            </button>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-6 lg:grid-cols-3 lg:px-8">
          <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">当前组织</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{currentOrganizationName}</p>
              </div>
              <div className="rounded-full bg-amber-100 p-3 text-amber-700">
                <Coins size={18} />
              </div>
            </div>
            <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{account?.balance_credits ?? 0}</p>
            <p className="mt-1 text-sm text-slate-500">当前可用算力豆余额</p>
          </article>

          <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">累计充值</p>
            <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">¥{((account?.total_recharged_cents ?? 0) / 100).toFixed(2)}</p>
            <p className="mt-1 text-sm text-slate-500">累计充值人民币金额</p>
          </article>

          <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">累计赠送 / 消耗</p>
            <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">
              {account?.total_bonus_credits ?? 0}
              <span className="mx-2 text-slate-300">/</span>
              {account?.total_consumed_credits ?? 0}
            </p>
            <p className="mt-1 text-sm text-slate-500">赠送豆数 / 已消耗豆数</p>
          </article>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="studio-panel overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-950">最近入账记录</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {grouped.recharges.length ? grouped.recharges.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-6 py-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">{TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}</div>
                  <div className="mt-1 text-slate-500">{new Date(item.created_at).toLocaleString("zh-CN")}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-emerald-700">+{item.amount_credits} 豆</div>
                  <div className="mt-1 text-slate-500">{item.cash_amount_cents ? `¥${(item.cash_amount_cents / 100).toFixed(2)}` : "系统入账"}</div>
                </div>
              </div>
            )) : (
              <div className="px-6 py-8 text-sm text-slate-500">当前组织还没有充值或赠送记录。</div>
            )}
          </div>
        </div>

        <div className="studio-panel overflow-hidden">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-950">最近扣费记录</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {grouped.debits.length ? grouped.debits.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-6 py-4 text-sm">
                <div>
                  <div className="font-semibold text-slate-900">{item.task_type || TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}</div>
                  <div className="mt-1 text-slate-500">{new Date(item.created_at).toLocaleString("zh-CN")}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-rose-700">-{item.amount_credits} 豆</div>
                  <div className="mt-1 text-slate-500">余额 {item.balance_after}</div>
                </div>
              </div>
            )) : (
              <div className="px-6 py-8 text-sm text-slate-500">当前组织还没有任务扣费记录。</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
