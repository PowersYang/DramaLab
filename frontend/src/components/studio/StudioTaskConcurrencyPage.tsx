"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Loader2, RefreshCw, Save, X } from "lucide-react";

import { api, type OrganizationSummary, type TaskConcurrencyLimitSummary, type TaskConcurrencyTaskTypeOption } from "@/lib/api";

export default function StudioTaskConcurrencyPage() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskConcurrencyTaskTypeOption[]>([]);
  const [limits, setLimits] = useState<TaskConcurrencyLimitSummary[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedTaskTypes, setSelectedTaskTypes] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!taskTypes.length) {
      setSelectedTaskTypes(new Set());
      return;
    }
    const allowed = new Set(taskTypes.map((item) => item.task_type));
    setSelectedTaskTypes((prev) => new Set(Array.from(prev).filter((key) => allowed.has(key))));
  }, [taskTypes]);

  const selectedCount = selectedTaskTypes.size;
  const allCount = taskTypes.length;
  const allSelected = allCount > 0 && selectedCount === allCount;
  const someSelected = selectedCount > 0 && selectedCount < allCount;

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleSelected = (taskType: string) => {
    setSelectedTaskTypes((prev) => {
      const next = new Set(prev);
      if (next.has(taskType)) {
        next.delete(taskType);
      } else {
        next.add(taskType);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedTaskTypes((prev) => {
      if (prev.size === taskTypes.length) {
        return new Set();
      }
      return new Set(taskTypes.map((item) => item.task_type));
    });
  };

  const clearSelection = () => setSelectedTaskTypes(new Set());

  type SaveOneResult =
    | { action: "noop" }
    | { action: "deleted" }
    | { action: "upserted"; maxConcurrency: number };

  const saveOne = async (taskType: string, rawValue: string) => {
    if (!selectedOrganizationId) {
      return { action: "noop" } as SaveOneResult;
    }
    try {
      if (!rawValue) {
        if (!limitMap.get(`${selectedOrganizationId}::${taskType}`)) {
        return { action: "noop" as const };
        }
        await api.deleteTaskConcurrencyLimit(selectedOrganizationId, taskType);
        setLimits((prev) =>
          prev.filter((item) => !(item.organization_id === selectedOrganizationId && item.task_type === taskType)),
        );
        return { action: "deleted" as const };
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
      return { action: "upserted" as const, maxConcurrency };
    } catch (saveError) {
      throw saveError;
    }
  };

  const handleSave = async (taskType: string) => {
    if (!selectedOrganizationId) return;
    setMessage(null);
    setError(null);
    const rawValue = (drafts[taskType] || "").trim();
    try {
      setSavingKey(taskType);
      const result = await saveOne(taskType, rawValue);
      if (result.action === "noop") {
        setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 当前就是不限流。`);
        return;
      }
      if (result.action === "deleted") {
        setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 已恢复为不限流。`);
        return;
      }
      setMessage(`${selectedOrganization?.name || "当前组织"} 的 ${taskType} 并发上限已更新为 ${result.maxConcurrency}。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存任务并发限制失败");
    } finally {
      setSavingKey(null);
    }
  };

  const applyBulkValue = () => {
    setMessage(null);
    setError(null);
    if (!selectedCount) {
      setError("请先勾选需要批量操作的任务类型。");
      return;
    }
    const raw = bulkValue.trim();
    if (raw) {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        setError("批量并发上限必须是大于等于 0 的整数，或留空表示不限流。");
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        selectedTaskTypes.forEach((taskType) => {
          next[taskType] = String(value);
        });
        return next;
      });
      setMessage(`已将并发上限 ${value} 应用到已选 ${selectedCount} 项。`);
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      selectedTaskTypes.forEach((taskType) => {
        next[taskType] = "";
      });
      return next;
    });
    setMessage(`已将已选 ${selectedCount} 项设为不限流（留空）。`);
  };

  const saveBatch = async (keys: string[], label: string) => {
    if (!selectedOrganizationId) return;
    setMessage(null);
    setError(null);
    if (!keys.length) {
      setError("没有需要保存的项目。");
      return;
    }
    try {
      setSavingKey("bulk");
      let ok = 0;
      const failures: string[] = [];
      for (const taskType of keys) {
        const raw = (drafts[taskType] || "").trim();
        try {
          await saveOne(taskType, raw);
          ok += 1;
        } catch {
          failures.push(taskType);
        }
      }
      if (failures.length) {
        setError(`${label}：成功 ${ok} 项，失败 ${failures.length} 项（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
      } else {
        setMessage(`${label}：已保存 ${ok} 项。`);
      }
    } finally {
      setSavingKey(null);
    }
  };

  const saveSelected = async () => {
    await saveBatch(Array.from(selectedTaskTypes), "批量保存已选");
  };

  const savePending = async () => {
    const changed = taskTypes
      .map((item) => item.task_type)
      .filter((key) => {
        const saved = limitMap.get(`${selectedOrganizationId}::${key}`);
        const savedStr = saved ? String(saved.max_concurrency) : "";
        return (drafts[key] || "").trim() !== savedStr;
      });
    await saveBatch(changed, "批量保存待保存项");
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
      {/* 顶部：组织选择与概览 */}
      <section className="animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-[2.5rem] bg-white/60 backdrop-blur-xl p-6 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">组织级任务并发管理</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Concurrency Governance</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">目标组织:</span>
            <select
              value={selectedOrganizationId}
              onChange={(event) => setSelectedOrganizationId(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
            >
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => void load(false)}
              disabled={refreshing}
              className="ml-2 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all disabled:opacity-50"
            >
              <RefreshCw size={20} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </section>

      {/* 主体：并发配置列表 */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
        <div className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
          <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900">执行队列配置</h3>
              <p className="text-sm text-slate-500">定义各任务类型的并发上限，超出上限的任务将进入等待队列</p>
            </div>
            <div className="flex items-center gap-3">
              {selectedCount > 0 && (
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/60 px-4 py-2 text-xs font-bold text-indigo-700">
                  已选 {selectedCount} 项
                  <button
                    onClick={clearSelection}
                    className="ml-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-indigo-700 hover:bg-white transition-all"
                  >
                    清空
                  </button>
                </div>
              )}
              <button
                onClick={() => void savePending()}
                disabled={savingKey !== null}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-30"
              >
                <Save size={12} />
                保存待保存
              </button>
            </div>
          </div>

          <div className="px-8 py-4 border-b border-slate-100 bg-white/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">批量</span>
                  <input
                    value={bulkValue}
                    onChange={(event) => setBulkValue(event.target.value)}
                    placeholder="并发位(留空不限流)"
                    className="w-44 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                <button
                  onClick={applyBulkValue}
                  disabled={!selectedCount || savingKey !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30"
                >
                  应用到已选
                </button>
                <button
                  onClick={() => void saveSelected()}
                  disabled={!selectedCount || savingKey !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-30"
                >
                  <Save size={12} />
                  保存已选
                </button>
              </div>

              <div className="text-[10px] font-bold text-slate-400">勾选后可批量设并发 / 批量保存</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="w-14 px-8 py-4">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                      aria-label="全选"
                    />
                  </th>
                  <th className="px-8 py-4">任务类型</th>
                  <th className="px-8 py-4">任务编码</th>
                  <th className="px-8 py-4">当前限制</th>
                  <th className="px-8 py-4">设定并发位</th>
                  <th className="px-8 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {taskTypes.map((item) => {
                  const saved = limitMap.get(`${selectedOrganizationId}::${item.task_type}`);
                  const savedLimitStr = saved ? String(saved.max_concurrency) : "";
                  const draftLimit = drafts[item.task_type] || "";
                  const hasChanged = draftLimit !== savedLimitStr;
                  const isSelected = selectedTaskTypes.has(item.task_type);

                  return (
                    <tr
                      key={item.task_type}
                      className={`group hover:bg-slate-50/60 transition-all ${isSelected ? "bg-indigo-50/40" : ""}`}
                    >
                      <td className="w-14 px-8 py-5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(item.task_type)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                          aria-label={`选择 ${item.task_type}`}
                        />
                      </td>
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900">{item.label}</div>
                      </td>
                      <td className="px-8 py-5">
                        <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
                          {item.task_type}
                        </code>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${saved ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="font-bold text-slate-900">{saved ? `${saved.max_concurrency} 位` : "不限流"}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <input
                            value={draftLimit}
                            onChange={(event) =>
                              setDrafts((prev) => ({ ...prev, [item.task_type]: event.target.value }))
                            }
                            placeholder="留空为不限流"
                            disabled={savingKey !== null}
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
                          onClick={() => void handleSave(item.task_type)}
                          disabled={!selectedOrganizationId || savingKey !== null}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30"
                        >
                          {savingKey === item.task_type ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Save size={12} />
                          )}
                          更新
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 全局消息提示 */}
      <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 space-y-3 pointer-events-none">
        {message && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check size={12} strokeWidth={3} />
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
    </div>
  );
}
