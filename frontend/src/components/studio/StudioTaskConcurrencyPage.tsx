"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import { api, type OrganizationSummary, type TaskConcurrencyLimitSummary, type TaskConcurrencyTaskTypeOption } from "@/lib/api";

export default function StudioTaskConcurrencyPage() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskConcurrencyTaskTypeOption[]>([]);
  const [limits, setLimits] = useState<TaskConcurrencyLimitSummary[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const [organizationData, taskTypeData, limitData] = await Promise.all([
        api.listOrganizations(),
        api.listTaskConcurrencyTaskTypes(),
        api.listTaskConcurrencyLimits(),
      ]);
      setOrganizations(organizationData);
      setTaskTypes(taskTypeData);
      setLimits(limitData);
      setSelectedOrganizationId((current) => current || organizationData[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载任务并发配置失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const selectedOrganization = useMemo(
    () => organizations.find((item) => item.id === selectedOrganizationId) || null,
    [organizations, selectedOrganizationId],
  );

  const limitMap = useMemo(
    () =>
      new Map(
        limits.map((item) => [`${item.organization_id}::${item.task_type}`, item]),
      ),
    [limits],
  );

  useEffect(() => {
    if (!selectedOrganizationId) {
      setDrafts({});
      return;
    }
    const nextDrafts: Record<string, string> = {};
    taskTypes.forEach((item) => {
      const existing = limitMap.get(`${selectedOrganizationId}::${item.task_type}`);
      nextDrafts[item.task_type] = existing ? String(existing.max_concurrency) : "";
    });
    setDrafts(nextDrafts);
  }, [limitMap, selectedOrganizationId, taskTypes]);

  const handleSave = async (taskType: string) => {
    if (!selectedOrganizationId) return;
    setMessage(null);
    setError(null);
    const rawValue = (drafts[taskType] || "").trim();
    try {
      setSavingKey(taskType);
      if (!rawValue) {
        if (!limitMap.get(`${selectedOrganizationId}::${taskType}`)) {
          setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 当前就是不限流。`);
          return;
        }
        await api.deleteTaskConcurrencyLimit(selectedOrganizationId, taskType);
        setLimits((prev) =>
          prev.filter((item) => !(item.organization_id === selectedOrganizationId && item.task_type === taskType)),
        );
        setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 已恢复为不限流。`);
        return;
      }

      const maxConcurrency = Number(rawValue);
      if (!Number.isInteger(maxConcurrency) || maxConcurrency < 0) {
        throw new Error("并发上限必须是大于等于 0 的整数。");
      }

      const updated = await api.upsertTaskConcurrencyLimit({
        organization_id: selectedOrganizationId,
        task_type: taskType,
        max_concurrency: maxConcurrency,
      });
      setLimits((prev) => {
        const others = prev.filter((item) => !(item.organization_id === updated.organization_id && item.task_type === updated.task_type));
        return [...others, updated];
      });
      setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 并发上限已更新为 ${maxConcurrency}。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存任务并发限制失败");
    } finally {
      setSavingKey(null);
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

      <section className="studio-panel overflow-hidden">
        <div className="admin-ledger-head !border-b-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <h3 className="text-xl font-semibold studio-strong">组织级任务并发管理</h3>
            <button
              onClick={() => void load(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              刷新配置
            </button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6 lg:px-8">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
            <label className="space-y-2 text-sm text-slate-600">
              选择组织
              <select
                value={selectedOrganizationId}
                onChange={(event) => setSelectedOrganizationId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-900 outline-none"
              >
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="admin-governance-callout text-sm leading-7">
              <div className="font-semibold text-slate-900">{selectedOrganization?.name || "未选择组织"}</div>
              <p className="mt-1">
                留空表示该任务类型不限制并发；输入 `0` 表示暂停该组织该任务类型的新执行，仅保留排队。
              </p>
            </div>
          </div>

          <div className="admin-governance-table">
            <table className="bg-white text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3 font-semibold">任务类型</th>
                  <th className="px-4 py-3 font-semibold">编码</th>
                  <th className="px-4 py-3 font-semibold">并发上限</th>
                  <th className="px-4 py-3 font-semibold">当前状态</th>
                  <th className="px-4 py-3 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taskTypes.map((item) => {
                  const saved = limitMap.get(`${selectedOrganizationId}::${item.task_type}`);
                  return (
                    <tr key={item.task_type} className="text-slate-700">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{item.label}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.task_type}</td>
                      <td className="px-4 py-3">
                        <input
                          value={drafts[item.task_type] || ""}
                          onChange={(event) =>
                            setDrafts((prev) => ({ ...prev, [item.task_type]: event.target.value }))
                          }
                          inputMode="numeric"
                          placeholder="留空为不限流"
                          className="w-40 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-900 outline-none"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {saved ? `已限制为 ${saved.max_concurrency}` : "当前不限流"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            onClick={() => void handleSave(item.task_type)}
                            disabled={!selectedOrganizationId || savingKey === item.task_type}
                            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {savingKey === item.task_type ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
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
                      当前没有可配置的任务类型。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
