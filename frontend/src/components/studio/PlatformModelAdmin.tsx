"use client";

import { useEffect, useMemo, useState } from "react";

import { api, type ModelCatalogEntry, type ModelProviderSummary } from "@/lib/api";

interface ProviderDraft {
  enabled: boolean;
  base_url: string;
  credentials: Record<string, string>;
}

interface CatalogDraft {
  enabled: boolean;
  display_name: string;
  description: string;
  sort_order: number;
}

export default function PlatformModelAdmin() {
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [catalogDrafts, setCatalogDrafts] = useState<Record<string, CatalogDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [providerData, catalogData] = await Promise.all([
        api.listModelProviders(),
        api.listModelCatalog(),
      ]);
      setProviders(providerData);
      setCatalog(catalogData);
      setProviderDrafts(
        Object.fromEntries(
          providerData.map((provider) => [
            provider.provider_key,
            {
              enabled: provider.enabled,
              base_url: provider.base_url || "",
              credentials: Object.fromEntries(provider.credential_fields.map((field) => [field, ""])),
            },
          ]),
        ),
      );
      setCatalogDrafts(
        Object.fromEntries(
          catalogData.map((item) => [
            item.model_id,
            {
              enabled: item.enabled,
              display_name: item.display_name,
              description: item.description || "",
              sort_order: item.sort_order,
            },
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const groupedCatalog = useMemo(() => {
    return {
      t2i: catalog.filter((item) => item.task_type === "t2i"),
      i2i: catalog.filter((item) => item.task_type === "i2i"),
      i2v: catalog.filter((item) => item.task_type === "i2v"),
    };
  }, [catalog]);

  const saveProvider = async (provider: ModelProviderSummary) => {
    const draft = providerDrafts[provider.provider_key];
    if (!draft) return;
    setSavingKey(`provider:${provider.provider_key}`);
    try {
      await api.updateModelProvider(provider.provider_key, {
        enabled: draft.enabled,
        base_url: draft.base_url,
        credentials_patch: draft.credentials,
      });
      await load();
    } finally {
      setSavingKey(null);
    }
  };

  const saveCatalog = async (item: ModelCatalogEntry) => {
    const draft = catalogDrafts[item.model_id];
    if (!draft) return;
    setSavingKey(`catalog:${item.model_id}`);
    try {
      await api.updateModelCatalogEntry(item.model_id, {
        enabled: draft.enabled,
        display_name: draft.display_name,
        description: draft.description,
        sort_order: draft.sort_order,
      });
      await load();
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <section className="studio-panel p-6 xl:col-span-2">
        <p className="text-sm text-slate-500">正在加载模型供应商配置...</p>
      </section>
    );
  }

  return (
    <section className="studio-panel p-6 xl:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Platform Admin</p>
      <h2 className="mt-4 text-2xl font-bold text-slate-950">模型提供商管理</h2>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
        这里只有平台超级管理员可见。供应商密钥与模型上下线统一在这里维护，业务工作区只会展示已启用的模型。
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {providers.map((provider) => {
          const draft = providerDrafts[provider.provider_key];
          return (
            <div key={provider.provider_key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{provider.display_name}</div>
                  <div className="mt-1 text-xs text-slate-500">{provider.description || provider.provider_key}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={draft?.enabled || false}
                    onChange={(event) =>
                      setProviderDrafts((prev) => ({
                        ...prev,
                        [provider.provider_key]: { ...prev[provider.provider_key], enabled: event.target.checked },
                      }))
                    }
                  />
                  启用
                </label>
              </div>

              <div className="mt-4 text-xs text-slate-500">
                已配置凭据：
                <span className="ml-1 text-slate-700">{provider.configured_fields.length ? provider.configured_fields.join(", ") : "无"}</span>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Base URL</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    value={draft?.base_url || ""}
                    onChange={(event) =>
                      setProviderDrafts((prev) => ({
                        ...prev,
                        [provider.provider_key]: { ...prev[provider.provider_key], base_url: event.target.value },
                      }))
                    }
                    placeholder="留空表示使用默认地址"
                  />
                </div>
                {provider.credential_fields.map((field) => (
                  <div key={field}>
                    <label className="mb-1 block text-xs font-medium text-slate-600">{field}</label>
                    <input
                      type="password"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      value={draft?.credentials[field] || ""}
                      onChange={(event) =>
                        setProviderDrafts((prev) => ({
                          ...prev,
                          [provider.provider_key]: {
                            ...prev[provider.provider_key],
                            credentials: { ...prev[provider.provider_key].credentials, [field]: event.target.value },
                          },
                        }))
                      }
                      placeholder={provider.configured_fields.includes(field) ? "留空表示保留原值；输入 __CLEAR__ 可清空" : "输入新的凭据值"}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  onClick={() => saveProvider(provider)}
                  disabled={savingKey === `provider:${provider.provider_key}`}
                >
                  {savingKey === `provider:${provider.provider_key}` ? "保存中..." : "保存供应商"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 space-y-6">
        {(["t2i", "i2i", "i2v"] as const).map((taskType) => (
          <div key={taskType} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{taskType}</div>
            <div className="mt-4 space-y-3">
              {groupedCatalog[taskType].map((item) => {
                const draft = catalogDrafts[item.model_id];
                return (
                  <div key={item.model_id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_120px_120px]">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">显示名</label>
                        <input
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                          value={draft?.display_name || ""}
                          onChange={(event) =>
                            setCatalogDrafts((prev) => ({
                              ...prev,
                              [item.model_id]: { ...prev[item.model_id], display_name: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">描述</label>
                        <input
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                          value={draft?.description || ""}
                          onChange={(event) =>
                            setCatalogDrafts((prev) => ({
                              ...prev,
                              [item.model_id]: { ...prev[item.model_id], description: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">排序</label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                          value={draft?.sort_order ?? 100}
                          onChange={(event) =>
                            setCatalogDrafts((prev) => ({
                              ...prev,
                              [item.model_id]: { ...prev[item.model_id], sort_order: Number(event.target.value) || 100 },
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-end gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={draft?.enabled || false}
                            onChange={(event) =>
                              setCatalogDrafts((prev) => ({
                                ...prev,
                                [item.model_id]: { ...prev[item.model_id], enabled: event.target.checked },
                              }))
                            }
                          />
                          启用
                        </label>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{item.model_id} · {item.provider_key}</span>
                      <button
                        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        onClick={() => saveCatalog(item)}
                        disabled={savingKey === `catalog:${item.model_id}`}
                      >
                        {savingKey === `catalog:${item.model_id}` ? "保存中..." : "保存模型"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
