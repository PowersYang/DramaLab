"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";

import {
  api,
  type BillingAccountSummary,
  type BillingPricingRuleSummary,
  type BillingRechargeBonusRuleSummary,
  type BillingTransactionSummary,
  type OrganizationSummary,
  type TaskConcurrencyTaskTypeOption,
} from "@/lib/api";

interface BonusRuleFormState {
  min_recharge_yuan: string;
  max_recharge_yuan: string;
  bonus_credits: string;
  description: string;
}

interface RechargeFormState {
  organization_id: string;
  amount_yuan: string;
  remark: string;
}

interface RechargeRecordRow {
  id: string;
  amount_cents: number;
  base_credits: number;
  bonus_credits: number;
  total_credits: number;
  operator_name: string;
  created_at: string;
  remark: string;
}

type BillingAdminTab = "accounts" | "pricing" | "bonus";

const DEFAULT_BONUS_FORM: BonusRuleFormState = {
  min_recharge_yuan: "",
  max_recharge_yuan: "",
  bonus_credits: "",
  description: "",
};

const DEFAULT_RECHARGE_FORM: RechargeFormState = {
  organization_id: "",
  amount_yuan: "",
  remark: "",
};

function centsToCurrency(cents?: number | null): string {
  return `¥${((cents || 0) / 100).toFixed(2)}`;
}

function creditsToCurrency(credits?: number | null): string {
  return centsToCurrency((credits || 0) * 10);
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function parseYuanToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = Number(trimmed);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }
  return Math.round(normalized * 100);
}

function getRechargeGroupKey(item: BillingTransactionSummary): string {
  const idempotencyKey = item.idempotency_key || "";
  if (idempotencyKey.startsWith("recharge:")) {
    const parts = idempotencyKey.split(":");
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}`;
    }
  }
  return [
    item.organization_id || "",
    item.cash_amount_cents || 0,
    item.operator_user_id || "",
    (item.created_at || "").slice(0, 16),
    item.remark || "",
  ].join("|");
}

function buildRechargeRecords(rows: BillingTransactionSummary[]): RechargeRecordRow[] {
  const groups = new Map<string, BillingTransactionSummary[]>();
  rows
    .filter((item) => item.direction === "credit")
    .forEach((item) => {
      const groupKey = getRechargeGroupKey(item);
      const current = groups.get(groupKey) || [];
      current.push(item);
      groups.set(groupKey, current);
    });

  return Array.from(groups.entries())
    .map(([groupKey, items]) => {
      const rechargeItem = items.find((item) => item.transaction_type === "recharge") || items[0];
      const bonusCredits = items
        .filter((item) => item.transaction_type === "bonus")
        .reduce((sum, item) => sum + item.amount_credits, 0);
      const baseCredits = rechargeItem?.transaction_type === "recharge" ? rechargeItem.amount_credits : 0;
      const amountCents = rechargeItem?.cash_amount_cents || 0;
      return {
        id: groupKey,
        amount_cents: amountCents,
        base_credits: baseCredits,
        bonus_credits: bonusCredits,
        total_credits: baseCredits + bonusCredits,
        operator_name: rechargeItem?.operator_display_name || rechargeItem?.operator_user_id || "系统",
        created_at: rechargeItem?.created_at || items[0]?.created_at || "",
        remark: rechargeItem?.remark || items.find((item) => item.remark)?.remark || "-",
      };
    })
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export default function PlatformBillingAdmin() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [accounts, setAccounts] = useState<BillingAccountSummary[]>([]);
  const [pricingRules, setPricingRules] = useState<BillingPricingRuleSummary[]>([]);
  const [bonusRules, setBonusRules] = useState<BillingRechargeBonusRuleSummary[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskConcurrencyTaskTypeOption[]>([]);
  const [rechargeTransactions, setRechargeTransactions] = useState<BillingTransactionSummary[]>([]);
  const [pricingDrafts, setPricingDrafts] = useState<Record<string, string>>({});
  const [bonusForm, setBonusForm] = useState<BonusRuleFormState>(DEFAULT_BONUS_FORM);
  const [rechargeForm, setRechargeForm] = useState<RechargeFormState>(DEFAULT_RECHARGE_FORM);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBonusModalOpen, setIsBonusModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BillingAdminTab>("accounts");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [organizationData, accountData, pricingData, bonusData, taskTypeData] = await Promise.all([
        api.listOrganizations(),
        api.listBillingAccounts(),
        api.listBillingPricingRules(),
        api.listBillingRechargeBonusRules(),
        api.listTaskConcurrencyTaskTypes(),
      ]);
      setOrganizations(organizationData);
      setAccounts(accountData);
      setPricingRules(pricingData);
      setBonusRules(bonusData);
      setTaskTypes(taskTypeData);
      const nextOrganizationId = selectedOrganizationId || organizationData[0]?.id || "";
      setSelectedOrganizationId(nextOrganizationId);
      setRechargeForm((current) => ({
        ...current,
        organization_id: current.organization_id || nextOrganizationId,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载平台计费配置失败");
    } finally {
      setLoading(false);
    }
  };

  const loadRechargeTransactions = async (organizationId: string) => {
    if (!organizationId) {
      setRechargeTransactions([]);
      return;
    }
    setRechargeLoading(true);
    try {
      const rows = await api.listAdminBillingTransactions({
        organization_id: organizationId,
        direction: "credit",
        limit: 100,
      });
      setRechargeTransactions(rows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载充值记录失败");
    } finally {
      setRechargeLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedOrganizationId) {
      return;
    }
    void loadRechargeTransactions(selectedOrganizationId);
  }, [selectedOrganizationId]);

  const organizationMap = useMemo(
    () => new Map(organizations.map((item) => [item.id, item.name])),
    [organizations],
  );

  const accountsWithName = useMemo(
    () =>
      accounts
        .map((item) => ({
          ...item,
          organization_name: item.organization_id ? organizationMap.get(item.organization_id) || item.organization_id : "未绑定组织",
        }))
        .sort((left, right) => left.organization_name.localeCompare(right.organization_name, "zh-CN")),
    [accounts, organizationMap],
  );

  const selectedAccount = useMemo(
    () => accountsWithName.find((item) => item.organization_id === selectedOrganizationId) || null,
    [accountsWithName, selectedOrganizationId],
  );

  const pricingRuleMap = useMemo(
    () => new Map(pricingRules.map((item) => [item.task_type, item])),
    [pricingRules],
  );

  useEffect(() => {
    if (!taskTypes.length) {
      return;
    }
    const nextDrafts: Record<string, string> = {};
    taskTypes.forEach((item) => {
      nextDrafts[item.task_type] = String(pricingRuleMap.get(item.task_type)?.price_credits ?? 0);
    });
    setPricingDrafts(nextDrafts);
  }, [pricingRuleMap, taskTypes]);

  const rechargeAmountCents = useMemo(
    () => parseYuanToCents(rechargeForm.amount_yuan),
    [rechargeForm.amount_yuan],
  );
  const baseCreditsPreview = rechargeAmountCents == null ? 0 : Math.floor(rechargeAmountCents / 10);
  const matchedBonusRule = useMemo(() => {
    if (rechargeAmountCents == null) {
      return null;
    }
    return bonusRules
      .filter((item) => item.status === "active")
      .sort((left, right) => right.min_recharge_cents - left.min_recharge_cents)
      .find((item) => {
        if (rechargeAmountCents < item.min_recharge_cents) {
          return false;
        }
        if (item.max_recharge_cents != null && rechargeAmountCents > item.max_recharge_cents) {
          return false;
        }
        return true;
      }) || null;
  }, [bonusRules, rechargeAmountCents]);
  const bonusCreditsPreview = matchedBonusRule?.bonus_credits || 0;
  const rechargeRecords = useMemo(
    () => buildRechargeRecords(rechargeTransactions),
    [rechargeTransactions],
  );

  const handlePricingSave = async (taskType: TaskConcurrencyTaskTypeOption) => {
    setError(null);
    setMessage(null);
    const rawValue = (pricingDrafts[taskType.task_type] || "0").trim();
    const priceCredits = Number(rawValue || "0");
    if (!Number.isInteger(priceCredits) || priceCredits < 0) {
      setError("任务定价必须是大于等于 0 的整数。");
      return;
    }
    try {
      setBusyKey(`pricing:${taskType.task_type}`);
      const saved = await api.upsertBillingPricingRule({
        task_type: taskType.task_type,
        price_credits: priceCredits,
        description: taskType.label,
      });
      setPricingRules((prev) => {
        const others = prev.filter((item) => item.id !== saved.id);
        return [...others, saved];
      });
      setMessage(`已保存 ${taskType.label}（${taskType.task_type}）= ${priceCredits} 豆。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存任务定价失败");
    } finally {
      setBusyKey(null);
    }
  };

  const submitBonusRule = async () => {
    setError(null);
    setMessage(null);
    const minRechargeCents = parseYuanToCents(bonusForm.min_recharge_yuan);
    const maxRechargeCents = bonusForm.max_recharge_yuan.trim() ? parseYuanToCents(bonusForm.max_recharge_yuan) : null;
    const bonusCredits = Number(bonusForm.bonus_credits);
    if (minRechargeCents == null) {
      setError("最小充值金额必须是大于等于 0 的金额。");
      return;
    }
    if (maxRechargeCents !== null && (maxRechargeCents == null || maxRechargeCents < minRechargeCents)) {
      setError("最大充值金额必须为空，或是大于等于最小充值金额。");
      return;
    }
    if (!Number.isInteger(bonusCredits) || bonusCredits < 0) {
      setError("赠送算力豆必须是大于等于 0 的整数。");
      return;
    }
    try {
      setBusyKey("bonus:create");
      const saved = await api.upsertBillingRechargeBonusRule({
        min_recharge_cents: minRechargeCents,
        max_recharge_cents: maxRechargeCents,
        bonus_credits: bonusCredits,
        description: bonusForm.description.trim() || undefined,
      });
      setBonusRules((prev) => {
        const others = prev.filter((item) => item.id !== saved.id);
        return [...others, saved];
      });
      setBonusForm(DEFAULT_BONUS_FORM);
      setIsBonusModalOpen(false);
      setMessage(`已新增充值赠送规则：满 ${centsToCurrency(minRechargeCents)} 送 ${bonusCredits} 豆。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存充值赠送规则失败");
    } finally {
      setBusyKey(null);
    }
  };

  const submitManualRecharge = async () => {
    setError(null);
    setMessage(null);
    const amountCents = parseYuanToCents(rechargeForm.amount_yuan);
    if (!rechargeForm.organization_id) {
      setError("请选择充值组织。");
      return;
    }
    if (amountCents == null || amountCents <= 0) {
      setError("充值金额必须大于 0 元。");
      return;
    }
    try {
      setBusyKey("recharge");
      const result = await api.createManualRecharge({
        organization_id: rechargeForm.organization_id,
        amount_cents: amountCents,
        remark: rechargeForm.remark.trim() || undefined,
        idempotency_key: `manual-${Date.now()}`,
      });
      setAccounts((prev) => {
        const others = prev.filter((item) => item.id !== result.account.id);
        return [...others, result.account];
      });
      setRechargeForm((current) => ({ ...current, amount_yuan: "", remark: "" }));
      setMessage(`已充值 ${centsToCurrency(amountCents)}，基础入账 ${result.base_credits} 豆，赠送 ${result.bonus_credits} 豆。`);
      await loadRechargeTransactions(rechargeForm.organization_id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "手工充值失败");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <section className="studio-panel flex min-h-[320px] items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* 页面头部：Tab 导航 */}
      <section className="animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-white/50 backdrop-blur-xl p-2 border border-slate-100 shadow-sm">
          <div className="flex gap-1">
            {(["accounts", "pricing", "bonus"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-all ${
                  activeTab === tab
                    ? "bg-slate-900 text-white shadow-lg shadow-slate-200"
                    : "text-slate-500 hover:bg-white hover:text-slate-900"
                }`}
              >
                {tab === "accounts" ? "组织账本与充值" : tab === "pricing" ? "任务计费标准" : "充值赠送策略"}
              </button>
            ))}
          </div>
          <div className="px-4 text-xs font-bold uppercase tracking-widest text-slate-400">
            Billing Governance
          </div>
        </div>
      </section>

      {/* 组织账本与充值 */}
      {activeTab === "accounts" ? (
        <div className="grid gap-8 lg:grid-cols-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="space-y-8 lg:col-span-4">
            <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
              <div className="border-b border-slate-100 bg-slate-50/30 px-6 py-5">
                <h3 className="text-lg font-bold text-slate-900">手工充值</h3>
                <p className="text-xs text-slate-500 mt-1">为选定组织执行算力豆入账</p>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">选择目标组织</label>
                  <select
                    value={selectedOrganizationId}
                    onChange={(event) => {
                      const organizationId = event.target.value;
                      setSelectedOrganizationId(organizationId);
                      setRechargeForm((prev) => ({ ...prev, organization_id: organizationId }));
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  >
                    {organizations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">充值金额 (元)</label>
                  <div className="relative">
                    <input
                      value={rechargeForm.amount_yuan}
                      onChange={(event) =>
                        setRechargeForm((prev) => ({ ...prev, amount_yuan: event.target.value }))
                      }
                      placeholder="0.00"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 pl-8 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">¥</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-[10px] font-bold text-indigo-600">
                    换算算力豆: {baseCreditsPreview} 豆 (预计赠送 {bonusCreditsPreview} 豆)
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">备注说明</label>
                  <textarea
                    value={rechargeForm.remark}
                    onChange={(event) => setRechargeForm((prev) => ({ ...prev, remark: event.target.value }))}
                    placeholder="选填，如：线下转账单号"
                    rows={2}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  />
                </div>

                <button
                  disabled={rechargeAmountCents === null || rechargeAmountCents <= 0 || busyKey === "recharge"}
                  onClick={() => void submitManualRecharge()}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30"
                >
                  {busyKey === "recharge" ? <Loader2 size={18} className="animate-spin" /> : "执行充值入账"}
                </button>
              </div>
            </section>

            {selectedAccount && (
              <section className="studio-panel border-none bg-indigo-600 p-8 shadow-xl shadow-indigo-500/20 text-white overflow-hidden relative">
                <div className="relative z-10">
                  <div className="text-xs font-bold uppercase tracking-widest text-indigo-200">当前余额</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-4xl font-black">{selectedAccount.balance_credits}</span>
                    <span className="text-sm font-bold text-indigo-200">算力豆</span>
                  </div>
                  <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">累计充值</div>
                      <div className="mt-1 text-lg font-bold">{centsToCurrency(selectedAccount.total_recharged_cents)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">累计赠送</div>
                      <div className="mt-1 text-lg font-bold">{selectedAccount.total_bonus_credits} 豆</div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="space-y-8 lg:col-span-8">
            <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">充值流水记录</h3>
                  <p className="text-sm text-slate-500">展示最近 100 条组织充值与赠送明细</p>
                </div>
                {rechargeLoading && <Loader2 size={18} className="animate-spin text-slate-400" />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      <th className="px-8 py-4">时间与操作人</th>
                      <th className="px-8 py-4">充值金额</th>
                      <th className="px-8 py-4">入账算力豆</th>
                      <th className="px-8 py-4">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/50">
                    {rechargeRecords.map((record) => (
                      <tr key={record.id} className="group hover:bg-slate-50/50 transition-all">
                        <td className="px-8 py-5">
                          <div className="font-bold text-slate-900">{formatDateTime(record.created_at)}</div>
                          <div className="mt-1 text-xs text-slate-400">{record.operator_name} 执行</div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="font-mono font-bold text-slate-900">{centsToCurrency(record.amount_cents)}</div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-indigo-600">+{record.total_credits} 豆</span>
                            {record.bonus_credits > 0 && (
                              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                                含赠送 {record.bonus_credits}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-slate-500 text-xs max-w-[200px] truncate">{record.remark}</td>
                      </tr>
                    ))}
                    {!rechargeRecords.length && !rechargeLoading && (
                      <tr>
                        <td colSpan={4} className="px-8 py-20 text-center">
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <Plus size={32} className="opacity-20" />
                            <p className="font-medium">当前组织暂无充值记录</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      ) : activeTab === "pricing" ? (
        <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">任务计费标准</h3>
              <p className="text-sm text-slate-500">配置不同类型 AI 任务的算力豆消耗价格</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="px-8 py-4">任务类型</th>
                  <th className="px-8 py-4">任务编码</th>
                  <th className="px-8 py-4">当前价格 (豆)</th>
                  <th className="px-8 py-4">设定新价格</th>
                  <th className="px-8 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {taskTypes.map((item) => {
                  const savedRule = pricingRuleMap.get(item.task_type);
                  const savedPrice = savedRule?.price_credits ?? 0;
                  const draftPrice = pricingDrafts[item.task_type] ?? "0";
                  const hasChanged = String(savedPrice) !== draftPrice;

                  return (
                    <tr key={item.task_type} className="group hover:bg-slate-50/50 transition-all">
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900">{item.label}</div>
                      </td>
                      <td className="px-8 py-5">
                        <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
                          {item.task_type}
                        </code>
                      </td>
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900">{savedPrice} 豆</div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <input
                            value={draftPrice}
                            onChange={(event) =>
                              setPricingDrafts((prev) => ({ ...prev, [item.task_type]: event.target.value }))
                            }
                            className={`w-32 rounded-xl border px-4 py-2 text-sm font-bold outline-none transition-all focus:ring-4 ${
                              hasChanged
                                ? "border-amber-200 bg-amber-50 text-amber-900 focus:ring-amber-500/10"
                                : "border-slate-200 bg-white text-slate-900 focus:ring-indigo-500/10"
                            }`}
                          />
                          {hasChanged && <span className="text-[10px] font-bold text-amber-600">待保存</span>}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => void handlePricingSave(item)}
                          disabled={busyKey === `pricing:${item.task_type}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30"
                        >
                          {busyKey === `pricing:${item.task_type}` ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          保存
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">充值赠送策略</h3>
              <p className="text-sm text-slate-500">配置阶梯充值赠送规则，激励用户预充值</p>
            </div>
            <button
              onClick={() => setIsBonusModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95"
            >
              <Plus size={16} /> 新增策略规则
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="px-8 py-4">充值区间 (元)</th>
                  <th className="px-8 py-4">额外赠送</th>
                  <th className="px-8 py-4">策略描述</th>
                  <th className="px-8 py-4 text-right">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {bonusRules
                  .slice()
                  .sort((left, right) => left.min_recharge_cents - right.min_recharge_cents)
                  .map((rule) => (
                    <tr key={rule.id} className="group hover:bg-slate-50/50 transition-all">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2 font-bold text-slate-900">
                          <span>{centsToCurrency(rule.min_recharge_cents)}</span>
                          <span className="text-slate-300">→</span>
                          <span>{rule.max_recharge_cents ? centsToCurrency(rule.max_recharge_cents) : "不限"}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600">
                          <Plus size={12} /> {rule.bonus_credits} 豆
                        </div>
                      </td>
                      <td className="px-8 py-5 text-slate-500 text-xs">{rule.description || "-"}</td>
                      <td className="px-8 py-5 text-right">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          rule.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                        }`}>
                          {rule.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                {!bonusRules.length && (
                  <tr>
                    <td colSpan={4} className="px-8 py-20 text-center text-slate-400 font-medium">
                      当前未配置任何赠送策略
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 全局消息提示 */}
      <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 space-y-3 pointer-events-none">
        {message && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
              <svg size={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            {message}
          </div>
        )}
        {error && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-rose-600 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-rose-600">
              <X size={12} strokeWidth={3} />
            </div>
            {error}
          </div>
        )}
      </div>

      {/* 新增赠送策略 Modal */}
      {isBonusModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md rounded-[2.5rem] bg-white p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="mb-8">
              <h3 className="text-xl font-bold text-slate-900">新增赠送策略</h3>
              <p className="mt-1 text-sm text-slate-500">配置充值金额区间与对应的算力豆奖励</p>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">最小金额 (元)</label>
                  <input
                    value={bonusForm.min_recharge_yuan}
                    onChange={(event) => setBonusForm((prev) => ({ ...prev, min_recharge_yuan: event.target.value }))}
                    placeholder="0"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 ml-1">最大金额 (元)</label>
                  <input
                    value={bonusForm.max_recharge_yuan}
                    onChange={(event) => setBonusForm((prev) => ({ ...prev, max_recharge_yuan: event.target.value }))}
                    placeholder="不限请留空"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 ml-1">赠送算力豆</label>
                <input
                  value={bonusForm.bonus_credits}
                  onChange={(event) => setBonusForm((prev) => ({ ...prev, bonus_credits: event.target.value }))}
                  placeholder="额外奖励的算力豆数量"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 ml-1">策略描述</label>
                <textarea
                  value={bonusForm.description}
                  onChange={(event) => setBonusForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="展示给用户的促销描述"
                  rows={2}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => {
                    setIsBonusModalOpen(false);
                    setBonusForm(DEFAULT_BONUS_FORM);
                  }}
                  className="flex-1 rounded-2xl border border-slate-200 py-4 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
                >
                  取消
                </button>
                <button
                  onClick={() => void submitBonusRule()}
                  disabled={!bonusForm.min_recharge_yuan || !bonusForm.bonus_credits || busyKey === "bonus:create"}
                  className="flex-1 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30"
                >
                  {busyKey === "bonus:create" ? "保存中..." : "确认新增"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
