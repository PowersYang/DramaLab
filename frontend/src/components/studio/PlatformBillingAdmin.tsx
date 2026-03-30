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
    <div className="space-y-6">
      {error ? (
        <section className="studio-panel p-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        </section>
      ) : null}
      {message ? (
        <section className="studio-panel p-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
        </section>
      ) : null}

      <section className="studio-panel p-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "accounts", label: "组织账本与手工充值" },
            { key: "pricing", label: "任务定价规则" },
            { key: "bonus", label: "充值赠送规则" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveTab(item.key as BillingAdminTab)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === item.key
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-950"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "accounts" ? (
      <section className="studio-panel p-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-950">组织账本与手工充值</h2>
          <p className="mt-1 text-sm text-slate-500">充值金额以元为单位录入，系统会按 1 元 = 10 算力豆自动换算，并展示所选组织的充值统计和充值记录。</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <label className="space-y-2 text-sm text-slate-600">
            选择组织
            <select
              value={selectedOrganizationId}
              onChange={(event) => {
                const organizationId = event.target.value;
                setSelectedOrganizationId(organizationId);
                setRechargeForm((prev) => ({ ...prev, organization_id: organizationId }));
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-900 outline-none"
            >
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">当前余额</p>
              <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{selectedAccount?.balance_credits ?? 0}</p>
              <p className="mt-1 text-sm text-slate-500">算力豆</p>
            </article>
            <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">累计充值金额</p>
              <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{centsToCurrency(selectedAccount?.total_recharged_cents)}</p>
              <p className="mt-1 text-sm text-slate-500">数据库累计统计</p>
            </article>
            <article className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">累计赠送金额</p>
              <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{creditsToCurrency(selectedAccount?.total_bonus_credits)}</p>
              <p className="mt-1 text-sm text-slate-500">共赠送 {selectedAccount?.total_bonus_credits ?? 0} 豆</p>
            </article>
          </div>
        </div>

        <div className="mt-6 grid gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,240px)_auto_minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">充值金额（元）</label>
            <input
              value={rechargeForm.amount_yuan}
              onChange={(event) => setRechargeForm((prev) => ({ ...prev, amount_yuan: event.target.value }))}
              placeholder="例如 100"
              inputMode="decimal"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </div>
          <div className="flex items-end pb-3 text-sm font-semibold text-emerald-700">
            预计基础入账 {baseCreditsPreview} 豆
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">备注</label>
            <input
              value={rechargeForm.remark}
              onChange={(event) => setRechargeForm((prev) => ({ ...prev, remark: event.target.value }))}
              placeholder="例如线下补款、商务赠送"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
            />
          </div>
          <button
            onClick={() => void submitManualRecharge()}
            disabled={busyKey === "recharge"}
            className="self-end rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busyKey === "recharge" ? "充值中..." : "手工充值"}
          </button>
        </div>

        <div className="mt-3 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-semibold">
            {rechargeForm.amount_yuan.trim() || "0"} 元 = {baseCreditsPreview} 算力豆
          </span>
          <span className="ml-3">
            当前命中赠送规则：{bonusCreditsPreview} 豆
          </span>
          <span className="ml-3">
            合计到账：{baseCreditsPreview + bonusCreditsPreview} 豆
          </span>
        </div>

        <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">组织</th>
                <th className="px-4 py-3 font-semibold">余额</th>
                <th className="px-4 py-3 font-semibold">累计充值金额</th>
                <th className="px-4 py-3 font-semibold">累计赠送金额</th>
                <th className="px-4 py-3 font-semibold">累计赠送豆数</th>
                <th className="px-4 py-3 font-semibold">累计消耗</th>
                <th className="px-4 py-3 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accountsWithName.map((item) => (
                <tr
                  key={item.id}
                  className={item.organization_id === selectedOrganizationId ? "bg-amber-50/60" : undefined}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">{item.organization_name}</td>
                  <td className="px-4 py-3 text-slate-700">{item.balance_credits} 豆</td>
                  <td className="px-4 py-3 text-slate-700">{centsToCurrency(item.total_recharged_cents)}</td>
                  <td className="px-4 py-3 text-slate-700">{creditsToCurrency(item.total_bonus_credits)}</td>
                  <td className="px-4 py-3 text-slate-700">{item.total_bonus_credits} 豆</td>
                  <td className="px-4 py-3 text-slate-700">{item.total_consumed_credits} 豆</td>
                  <td className="px-4 py-3 text-slate-700">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">充值金额</th>
                <th className="px-4 py-3 font-semibold">基础算力豆</th>
                <th className="px-4 py-3 font-semibold">赠送算力豆</th>
                <th className="px-4 py-3 font-semibold">合计到账</th>
                <th className="px-4 py-3 font-semibold">充值人</th>
                <th className="px-4 py-3 font-semibold">充值时间</th>
                <th className="px-4 py-3 font-semibold">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rechargeLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    正在加载充值记录...
                  </td>
                </tr>
              ) : rechargeRecords.length ? (
                rechargeRecords.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-slate-700">{centsToCurrency(item.amount_cents)}</td>
                    <td className="px-4 py-3 text-slate-700">{item.base_credits} 豆</td>
                    <td className="px-4 py-3 text-slate-700">{item.bonus_credits} 豆</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.total_credits} 豆</td>
                    <td className="px-4 py-3 text-slate-700">{item.operator_name}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(item.created_at)}</td>
                    <td className="px-4 py-3 text-slate-700">{item.remark || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    当前组织还没有充值记录。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {activeTab === "pricing" ? (
      <section className="studio-panel p-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-950">任务定价规则</h2>
          <p className="mt-1 text-sm text-slate-500">默认列出全部异步任务类型。未配置的任务默认按 0 豆展示，可直接在表格中修改后保存。</p>
        </div>

        <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">任务类型名称</th>
                <th className="px-4 py-3 font-semibold">任务编码</th>
                <th className="px-4 py-3 font-semibold">默认消费算力豆</th>
                <th className="px-4 py-3 font-semibold">当前状态</th>
                <th className="px-4 py-3 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {taskTypes.map((item) => {
                const savedRule = pricingRuleMap.get(item.task_type);
                return (
                  <tr key={item.task_type}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.task_type}</td>
                    <td className="px-4 py-3">
                      <input
                        value={pricingDrafts[item.task_type] || "0"}
                        onChange={(event) => setPricingDrafts((prev) => ({ ...prev, [item.task_type]: event.target.value }))}
                        inputMode="numeric"
                        className="w-36 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-900 outline-none"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {savedRule ? `已配置 ${savedRule.price_credits} 豆` : "默认 0 豆"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => void handlePricingSave(item)}
                          disabled={busyKey === `pricing:${item.task_type}`}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busyKey === `pricing:${item.task_type}` ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          保存
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!taskTypes.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    当前没有可配置的异步任务类型。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {activeTab === "bonus" ? (
      <section className="studio-panel p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-950">充值赠送规则</h2>
            <p className="mt-1 text-sm text-slate-500">默认按 table 展示所有充值赠送规则，可通过右上角按钮新增规则。</p>
          </div>
          <button
            onClick={() => setIsBonusModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus size={16} />
            新建规则
          </button>
        </div>

        <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">最小充值金额</th>
                <th className="px-4 py-3 font-semibold">最大充值金额</th>
                <th className="px-4 py-3 font-semibold">赠送算力豆</th>
                <th className="px-4 py-3 font-semibold">等值金额</th>
                <th className="px-4 py-3 font-semibold">说明</th>
                <th className="px-4 py-3 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bonusRules
                .slice()
                .sort((left, right) => left.min_recharge_cents - right.min_recharge_cents)
                .map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-slate-700">{centsToCurrency(item.min_recharge_cents)}</td>
                    <td className="px-4 py-3 text-slate-700">{item.max_recharge_cents == null ? "不限" : centsToCurrency(item.max_recharge_cents)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{item.bonus_credits} 豆</td>
                    <td className="px-4 py-3 text-slate-700">{creditsToCurrency(item.bonus_credits)}</td>
                    <td className="px-4 py-3 text-slate-700">{item.description || "-"}</td>
                    <td className="px-4 py-3 text-slate-700">{item.status}</td>
                  </tr>
                ))}
              {!bonusRules.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    当前还没有充值赠送规则。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {isBonusModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-xl rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-bold text-slate-950">新增充值赠送规则</h3>
                <p className="mt-1 text-sm text-slate-500">填写充值区间和赠送算力豆数量，保存后立即生效。</p>
              </div>
              <button
                onClick={() => {
                  setIsBonusModalOpen(false);
                  setBonusForm(DEFAULT_BONUS_FORM);
                }}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-600">
                  最小充值金额（元）
                  <input
                    value={bonusForm.min_recharge_yuan}
                    onChange={(event) => setBonusForm((prev) => ({ ...prev, min_recharge_yuan: event.target.value }))}
                    inputMode="decimal"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  最大充值金额（元，可留空）
                  <input
                    value={bonusForm.max_recharge_yuan}
                    onChange={(event) => setBonusForm((prev) => ({ ...prev, max_recharge_yuan: event.target.value }))}
                    inputMode="decimal"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none"
                  />
                </label>
              </div>

              <label className="space-y-2 text-sm text-slate-600">
                赠送算力豆
                <input
                  value={bonusForm.bonus_credits}
                  onChange={(event) => setBonusForm((prev) => ({ ...prev, bonus_credits: event.target.value }))}
                  inputMode="numeric"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none"
                />
              </label>

              <label className="space-y-2 text-sm text-slate-600">
                规则说明
                <input
                  value={bonusForm.description}
                  onChange={(event) => setBonusForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="例如大额充值赠送"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-5">
              <button
                onClick={() => {
                  setIsBonusModalOpen(false);
                  setBonusForm(DEFAULT_BONUS_FORM);
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                取消
              </button>
              <button
                onClick={() => void submitBonusRule()}
                disabled={busyKey === "bonus:create"}
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busyKey === "bonus:create" ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
