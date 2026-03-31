"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Coins, CreditCard, Loader2, Receipt, Wallet } from "lucide-react";

import AdminSummaryStrip from "@/components/studio/admin/AdminSummaryStrip";
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

const TASK_TYPE_LABELS: Record<string, string> = {
  "audio.generate.project": "项目音频生成",
  "audio.generate.line": "单句音频生成",
  "art_direction.analyze": "艺术风格分析",
  "asset.generate": "资产生成",
  "asset.generate_batch": "资产批量生成",
  "asset.motion_ref.generate": "动作参考生成",
  "media.merge": "媒体合成",
  "mix.generate.bgm": "背景音乐生成",
  "mix.generate.sfx": "音效生成",
  "project.export": "项目导出",
  "project.reparse": "剧本重新解析",
  "project.sync_descriptions": "同步资产描述",
  "series.asset.generate": "系列资产生成",
  "series.assets.import": "系列资产导入",
  "series.import.confirm": "导入确认",
  "series.import.preview": "导入预览",
  "storyboard.analyze": "分镜分析",
  "storyboard.generate_all": "生成全部分镜",
  "storyboard.refine_prompt": "分镜提示词优化",
  "storyboard.render": "分镜渲染",
  "video.generate.project": "项目视频生成",
  "video.generate.frame": "分镜视频生成",
  "video.generate.asset": "资产视频生成",
  "video.polish_prompt": "视频提示词润色",
  "video.polish_r2v_prompt": "R2V 提示词润色",
  "t2i": "文生图",
  "i2i": "图生图",
  "i2v": "图生视频",
  "r2v": "视频重绘",
};

const PAGE_SIZE = 10;

function formatTransactionAmount(item: BillingTransactionSummary): string {
  if (item.amount_credits === 0) {
    return "0 豆";
  }
  return `${item.direction === "credit" ? "+" : "-"}${item.amount_credits} 豆`;
}

export default function StudioBillingRoutePage() {
  const hasCapability = useAuthStore((state) => state.hasCapability);
  const me = useAuthStore((state) => state.me);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [credits, setCredits] = useState<BillingTransactionSummary[]>([]);
  const [debits, setDebits] = useState<BillingTransactionSummary[]>([]);
  const [creditOffset, setCreditOffset] = useState(0);
  const [debitOffset, setDebitOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creditLoading, setCreditLoading] = useState(false);
  const [debitLoading, setDebitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canViewAllBillingData = me?.is_platform_super_admin || me?.current_role_code === "org_admin";

  const loadAccount = async () => {
    try {
      const accountData = await api.getBillingAccount();
      setAccount(accountData);
    } catch (loadError) {
      console.error("加载账户信息失败", loadError);
    }
  };

  const loadCredits = async () => {
    setCreditLoading(true);
    try {
      const data = await api.listBillingTransactions({
        limit: PAGE_SIZE,
        direction: "credit",
        offset: creditOffset,
      });
      setCredits(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载入账记录失败");
    } finally {
      setCreditLoading(false);
    }
  };

  const loadDebits = async () => {
    setDebitLoading(true);
    try {
      const data = await api.listBillingTransactions({
        limit: PAGE_SIZE,
        direction: "debit",
        offset: debitOffset,
      });
      setDebits(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载扣费记录失败");
    } finally {
      setDebitLoading(false);
    }
  };

  useEffect(() => {
    if (!hasCapability("workspace.view")) return;
    setLoading(true);
    Promise.all([loadAccount(), loadCredits(), loadDebits()]).finally(() => setLoading(false));
  }, [hasCapability]);

  useEffect(() => {
    if (loading) return;
    void loadCredits();
  }, [creditOffset]);

  useEffect(() => {
    if (loading) return;
    void loadDebits();
  }, [debitOffset]);

  const currentOrganizationName = useMemo(() => {
    const currentWorkspace = me?.workspaces.find((item) => item.workspace_id === me.current_workspace_id);
    return currentWorkspace?.organization_name || account?.organization_id || "未绑定组织";
  }, [account?.organization_id, me]);

  const summaryItems = useMemo(
    () => [
      {
        label: "当前余额",
        value: account?.balance_credits ?? 0,
        note: "当前可用算力豆余额",
        icon: Wallet,
      },
      {
        label: "累计充值",
        value: `¥${((account?.total_recharged_cents ?? 0) / 100).toFixed(2)}`,
        note: canViewAllBillingData ? "累计充值人民币金额" : "个人可见范围内的充值金额",
        icon: CreditCard,
      },
      {
        label: "累计赠送",
        value: account?.total_bonus_credits ?? 0,
        note: "平台赠送或活动入账的算力豆",
        icon: Coins,
      },
      {
        label: "累计消耗",
        value: account?.total_consumed_credits ?? 0,
        note: "任务执行与系统扣费累计消耗",
        icon: Receipt,
      },
    ],
    [account?.balance_credits, account?.total_bonus_credits, account?.total_consumed_credits, account?.total_recharged_cents, canViewAllBillingData],
  );

  if (!hasCapability("workspace.view")) {
    return (
      <section className="studio-panel rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-5 text-sm leading-7 text-amber-800">
        你当前没有查看组织算力豆账本的权限。
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
        <section className="studio-panel p-4 rounded-none">
          <div className="rounded-none border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        </section>
      ) : null}

      <AdminSummaryStrip items={summaryItems} />

      <section className={`grid gap-6 ${canViewAllBillingData ? "xl:grid-cols-2" : "xl:grid-cols-1"}`}>
        {canViewAllBillingData ? (
          <section className="studio-panel flex flex-col overflow-hidden rounded-none">
            <div className="admin-ledger-head">
              <div>
                <h3 className="text-xl font-semibold studio-strong">最近入账记录</h3>
                <p className="mt-1 text-sm studio-muted">包含充值、赠送和人工补录等入账动作。</p>
              </div>
              {creditLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <span className="admin-status-badge admin-status-badge-neutral">{credits.length} 条</span>
              )}
            </div>
            <div className="admin-governance-table flex-1 border-0 rounded-none">
              <table className="bg-white text-sm">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>时间</th>
                    <th>金额 / 豆数</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody className={creditLoading ? "opacity-50" : ""}>
                  {credits.length ? credits.map((item) => (
                    <tr key={item.id}>
                      <td className="font-semibold text-slate-900">{TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}</td>
                      <td className="text-slate-700">{new Date(item.created_at).toLocaleString("zh-CN")}</td>
                      <td className="text-emerald-700 font-semibold">
                        {formatTransactionAmount(item)}
                        <div className="mt-1 text-xs text-slate-500">{item.cash_amount_cents ? `¥${(item.cash_amount_cents / 100).toFixed(2)}` : "系统入账"}</div>
                      </td>
                      <td className="text-slate-700">{item.remark || "-"}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">当前组织还没有充值或赠送记录。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-4">
              <div className="text-xs text-slate-500">
                当前第 {Math.floor(creditOffset / PAGE_SIZE) + 1} 页
              </div>
              <div className="flex gap-2">
                <button
                  disabled={creditOffset === 0 || creditLoading}
                  onClick={() => setCreditOffset(Math.max(0, creditOffset - PAGE_SIZE))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  disabled={credits.length < PAGE_SIZE || creditLoading}
                  onClick={() => setCreditOffset(creditOffset + PAGE_SIZE)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="studio-panel flex flex-col overflow-hidden rounded-none">
          <div className="admin-ledger-head">
            <div>
              <h3 className="text-xl font-semibold studio-strong">{canViewAllBillingData ? "最近扣费记录" : "我的扣费记录"}</h3>
              <p className="mt-1 text-sm studio-muted">查看任务执行后的扣费结果与余额变化。</p>
            </div>
            {debitLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : (
              <span className="admin-status-badge admin-status-badge-neutral">{debits.length} 条</span>
            )}
          </div>
          <div className="admin-governance-table flex-1 border-0 rounded-none">
            <table className="bg-white text-sm">
              <thead>
                <tr>
                  <th>扣费类型</th>
                  <th>时间</th>
                  <th>豆数变化</th>
                  <th>余额</th>
                </tr>
              </thead>
              <tbody className={debitLoading ? "opacity-50" : ""}>
                {debits.length ? debits.map((item) => (
                  <tr key={item.id}>
                    <td className="font-semibold text-slate-900">
                      {TASK_TYPE_LABELS[item.task_type || ""] || item.task_type || TRANSACTION_TYPE_LABELS[item.transaction_type] || item.transaction_type}
                    </td>
                    <td className="text-slate-700">{new Date(item.created_at).toLocaleString("zh-CN")}</td>
                    <td className={item.amount_credits === 0 ? "text-slate-700 font-semibold" : "text-rose-700 font-semibold"}>{formatTransactionAmount(item)}</td>
                    <td className="text-slate-700">{item.balance_after}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">{canViewAllBillingData ? "当前组织还没有任务扣费记录。" : "你当前还没有算力豆扣费记录。"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-4">
            <div className="text-xs text-slate-500">
              当前第 {Math.floor(debitOffset / PAGE_SIZE) + 1} 页
            </div>
            <div className="flex gap-2">
              <button
                disabled={debitOffset === 0 || debitLoading}
                onClick={() => setDebitOffset(Math.max(0, debitOffset - PAGE_SIZE))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                disabled={debits.length < PAGE_SIZE || debitLoading}
                onClick={() => setDebitOffset(debitOffset + PAGE_SIZE)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
