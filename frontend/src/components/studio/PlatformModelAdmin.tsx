"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type ModelCatalogEntry, type ModelProviderSummary } from "@/lib/api";

type TaskType = "t2i" | "i2i" | "i2v";

interface ProviderFormState {
  provider_key: string;
  display_name: string;
  description: string;
  enabled: boolean;
  base_url: string;
  credential_fields_text: string;
  credential_values: Record<string, string>;
  settings_json_text: string;
}

interface CatalogFormState {
  model_id: string;
  task_type: TaskType;
  provider_key: string;
  display_name: string;
  description: string;
  enabled: boolean;
  is_public: boolean;
  sort_order: number;
  capabilities_json_text: string;
  default_settings_json_text: string;
}

const DEFAULT_PROVIDER_FORM: ProviderFormState = {
  provider_key: "",
  display_name: "",
  description: "",
  enabled: false,
  base_url: "",
  credential_fields_text: "",
  credential_values: {},
  settings_json_text: "{}",
};

const DEFAULT_CATALOG_FORM: CatalogFormState = {
  model_id: "",
  task_type: "i2v",
  provider_key: "",
  display_name: "",
  description: "",
  enabled: true,
  is_public: true,
  sort_order: 100,
  capabilities_json_text: "{}",
  default_settings_json_text: "{}",
};

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyJson(value: Record<string, unknown> | undefined | null): string {
  return JSON.stringify(value || {}, null, 2);
}

function parseJsonField(label: string, value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`${label} 必须是 JSON 对象`);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} 解析失败`);
  }
}

function buildProviderForm(provider: ModelProviderSummary): ProviderFormState {
  return {
    provider_key: provider.provider_key,
    display_name: provider.display_name,
    description: provider.description || "",
    enabled: provider.enabled,
    base_url: provider.base_url || "",
    credential_fields_text: provider.credential_fields.join(", "),
    credential_values: Object.fromEntries(provider.credential_fields.map((field) => [field, ""])),
    settings_json_text: stringifyJson(provider.settings_json),
  };
}

function buildCatalogForm(item: ModelCatalogEntry): CatalogFormState {
  return {
    model_id: item.model_id,
    task_type: (item.task_type as TaskType) || "i2v",
    provider_key: item.provider_key,
    display_name: item.display_name,
    description: item.description || "",
    enabled: item.enabled,
    is_public: item.is_public,
    sort_order: item.sort_order,
    capabilities_json_text: stringifyJson(item.capabilities_json),
    default_settings_json_text: stringifyJson(item.default_settings_json),
  };
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-3xl rounded-[1.75rem] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h3 className="text-lg font-bold text-slate-950">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600"
          >
            关闭
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export default function PlatformModelAdmin() {
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<"create" | "edit">("create");
  const [catalogMode, setCatalogMode] = useState<"create" | "edit">("create");
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(DEFAULT_PROVIDER_FORM);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(DEFAULT_CATALOG_FORM);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerData, catalogData] = await Promise.all([api.listModelProviders(), api.listModelCatalog()]);
      setProviders(providerData);
      setCatalog(catalogData);
      setCatalogForm((prev) =>
        prev.provider_key || !providerData.length ? prev : { ...prev, provider_key: providerData[0].provider_key },
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载模型配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const providerFields = useMemo(
    () => parseCommaSeparatedList(providerForm.credential_fields_text),
    [providerForm.credential_fields_text],
  );

  const sortedCatalog = useMemo(
    () =>
      [...catalog].sort((left, right) => {
        if (left.sort_order !== right.sort_order) {
          return left.sort_order - right.sort_order;
        }
        return left.model_id.localeCompare(right.model_id);
      }),
    [catalog],
  );

  const providerMap = useMemo(
    () => new Map(providers.map((item) => [item.provider_key, item])),
    [providers],
  );

  const openCreateProviderModal = () => {
    setProviderMode("create");
    setProviderForm(DEFAULT_PROVIDER_FORM);
    setProviderModalOpen(true);
  };

  const openEditProviderModal = (provider: ModelProviderSummary) => {
    setProviderMode("edit");
    setProviderForm(buildProviderForm(provider));
    setProviderModalOpen(true);
  };

  const closeProviderModal = () => {
    if (busyKey?.startsWith("provider:")) return;
    setProviderModalOpen(false);
    setProviderMode("create");
    setProviderForm(DEFAULT_PROVIDER_FORM);
  };

  const openCreateCatalogModal = () => {
    setCatalogMode("create");
    setCatalogForm({
      ...DEFAULT_CATALOG_FORM,
      provider_key: providers[0]?.provider_key || "",
    });
    setCatalogModalOpen(true);
  };

  const openEditCatalogModal = (item: ModelCatalogEntry) => {
    setCatalogMode("edit");
    setCatalogForm(buildCatalogForm(item));
    setCatalogModalOpen(true);
  };

  const closeCatalogModal = () => {
    if (busyKey?.startsWith("catalog:")) return;
    setCatalogModalOpen(false);
    setCatalogMode("create");
    setCatalogForm({
      ...DEFAULT_CATALOG_FORM,
      provider_key: providers[0]?.provider_key || "",
    });
  };

  const handleProviderFieldChange = (field: string, value: string) => {
    setProviderForm((prev) => ({
      ...prev,
      credential_values: {
        ...prev.credential_values,
        [field]: value,
      },
    }));
  };

  const handleProviderCredentialFieldsChange = (value: string) => {
    const nextFields = parseCommaSeparatedList(value);
    setProviderForm((prev) => ({
      ...prev,
      credential_fields_text: value,
      credential_values: Object.fromEntries(nextFields.map((field) => [field, prev.credential_values[field] || ""])),
    }));
  };

  const saveProvider = async () => {
    setError(null);
    setSuccessMessage(null);
    const providerKey = providerForm.provider_key.trim().toUpperCase();
    const credentialFields = parseCommaSeparatedList(providerForm.credential_fields_text);
    if (!providerKey) {
      setError("供应商编码不能为空。");
      return;
    }
    if (!providerForm.display_name.trim()) {
      setError("供应商名称不能为空。");
      return;
    }
    try {
      const settingsJson = parseJsonField("供应商设置", providerForm.settings_json_text);
      const credentialsPatch = Object.fromEntries(
        credentialFields.map((field) => [field, providerForm.credential_values[field] || ""]),
      );
      setBusyKey(`provider:${providerMode}:${providerKey}`);
      if (providerMode === "create") {
        await api.createModelProvider({
          provider_key: providerKey,
          display_name: providerForm.display_name.trim(),
          description: providerForm.description.trim() || undefined,
          enabled: providerForm.enabled,
          base_url: providerForm.base_url.trim() || undefined,
          credential_fields: credentialFields,
          credentials_patch: credentialsPatch,
          settings_json: settingsJson,
        });
        setSuccessMessage(`已创建供应商 ${providerKey}`);
      } else {
        await api.updateModelProvider(providerKey, {
          display_name: providerForm.display_name.trim(),
          description: providerForm.description.trim(),
          enabled: providerForm.enabled,
          base_url: providerForm.base_url.trim(),
          credentials_patch: credentialsPatch,
          settings_patch: settingsJson,
        });
        setSuccessMessage(`已更新供应商 ${providerKey}`);
      }
      await load();
      closeProviderModal();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存供应商失败");
    } finally {
      setBusyKey(null);
    }
  };

  const deleteProvider = async (providerKey: string) => {
    if (!window.confirm(`确认删除供应商 ${providerKey} 吗？请先删除关联模型。`)) return;
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey(`provider:delete:${providerKey}`);
      await api.deleteModelProvider(providerKey);
      setSuccessMessage(`已删除供应商 ${providerKey}`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除供应商失败");
    } finally {
      setBusyKey(null);
    }
  };

  const saveCatalog = async () => {
    setError(null);
    setSuccessMessage(null);
    const modelId = catalogForm.model_id.trim();
    if (!modelId) {
      setError("模型 ID 不能为空。");
      return;
    }
    if (!catalogForm.provider_key) {
      setError("请选择模型供应商。");
      return;
    }
    if (!catalogForm.display_name.trim()) {
      setError("模型名称不能为空。");
      return;
    }
    try {
      const capabilitiesJson = parseJsonField("模型能力", catalogForm.capabilities_json_text);
      const defaultSettingsJson = parseJsonField("默认参数", catalogForm.default_settings_json_text);
      setBusyKey(`catalog:${catalogMode}:${modelId}`);
      const payload = {
        task_type: catalogForm.task_type,
        provider_key: catalogForm.provider_key,
        display_name: catalogForm.display_name.trim(),
        description: catalogForm.description.trim() || undefined,
        enabled: catalogForm.enabled,
        is_public: catalogForm.is_public,
        sort_order: Number(catalogForm.sort_order) || 100,
        capabilities_json: capabilitiesJson,
        default_settings_json: defaultSettingsJson,
      };
      if (catalogMode === "create") {
        await api.createModelCatalogEntry({
          model_id: modelId,
          ...payload,
        });
        setSuccessMessage(`已创建模型 ${modelId}`);
      } else {
        await api.updateModelCatalogEntry(modelId, payload);
        setSuccessMessage(`已更新模型 ${modelId}`);
      }
      await load();
      closeCatalogModal();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存模型失败");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleModelStatus = async (item: ModelCatalogEntry) => {
    setError(null);
    setSuccessMessage(null);
    const provider = providerMap.get(item.provider_key);
    if (provider && !provider.enabled) {
      setError(`厂商 ${provider.display_name} 当前已关闭，请先启用厂商后再操作模型。`);
      return;
    }
    const nextEnabled = !item.enabled;
    try {
      setBusyKey(`catalog:toggle:${item.model_id}`);
      const updated = await api.updateModelCatalogEntry(item.model_id, { enabled: nextEnabled });
      setCatalog((prev) => prev.map((entry) => (entry.model_id === item.model_id ? updated : entry)));
      setSuccessMessage(`${item.display_name} 已${nextEnabled ? "启用" : "停用"}`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "切换模型状态失败");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleProviderStatus = async (provider: ModelProviderSummary) => {
    setError(null);
    setSuccessMessage(null);
    const nextEnabled = !provider.enabled;
    try {
      setBusyKey(`provider:toggle:${provider.provider_key}`);
      const updated = await api.updateModelProvider(provider.provider_key, { enabled: nextEnabled });
      setProviders((prev) =>
        prev.map((entry) => (entry.provider_key === provider.provider_key ? updated : entry)),
      );
      // 中文注释：供应商停用会在后端级联关闭所属模型，这里同步更新前端本地态，避免重新整页加载。
      if (!nextEnabled) {
        setCatalog((prev) =>
          prev.map((entry) =>
            entry.provider_key === provider.provider_key ? { ...entry, enabled: false } : entry,
          ),
        );
      }
      setSuccessMessage(`${provider.display_name} 已${nextEnabled ? "启用" : "停用"}`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "切换厂商状态失败");
    } finally {
      setBusyKey(null);
    }
  };

  const deleteModel = async (modelId: string) => {
    if (!window.confirm(`确认删除模型 ${modelId} 吗？`)) return;
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey(`catalog:delete:${modelId}`);
      await api.deleteModelCatalogEntry(modelId);
      setSuccessMessage(`已删除模型 ${modelId}`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除模型失败");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <section className="studio-panel p-6">
        <p className="text-sm text-slate-500">正在加载模型配置...</p>
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
      {successMessage ? (
        <section className="studio-panel p-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        </section>
      ) : null}

      <section className="studio-panel p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-950">厂商管理</h2>
          <button
            onClick={openCreateProviderModal}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            新增厂商
          </button>
        </div>

        <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">厂商编码</th>
                <th className="px-4 py-3 font-semibold">厂商名称</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">凭据字段</th>
                <th className="px-4 py-3 font-semibold">Base URL</th>
                <th className="px-4 py-3 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providers.map((provider) => (
                <tr key={provider.provider_key} className="text-slate-700">
                  <td className="px-4 py-3 font-mono text-xs">{provider.provider_key}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{provider.display_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{provider.description || "-"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void toggleProviderStatus(provider)}
                      disabled={busyKey === `provider:toggle:${provider.provider_key}`}
                      aria-pressed={provider.enabled}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                        provider.enabled ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                          provider.enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                      <span className="sr-only">{provider.enabled ? "停用厂商" : "启用厂商"}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">{provider.credential_fields.join(", ") || "-"}</td>
                  <td className="px-4 py-3 max-w-[260px] break-all">{provider.base_url || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditProviderModal(provider)}
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => void deleteProvider(provider.provider_key)}
                        disabled={busyKey === `provider:delete:${provider.provider_key}`}
                        className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!providers.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    还没有厂商配置。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="studio-panel p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-950">模型管理</h2>
          <button
            onClick={openCreateCatalogModal}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
          >
            新增模型
          </button>
        </div>

        <div className="overflow-x-auto rounded-[1.5rem] border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">供应商</th>
                <th className="px-4 py-3 font-semibold">模型类型</th>
                <th className="px-4 py-3 font-semibold">模型名称</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">编辑</th>
                <th className="px-4 py-3 font-semibold">删除</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {sortedCatalog.map((item) => {
                const provider = providerMap.get(item.provider_key);
                const effectivelyEnabled = Boolean(provider?.enabled) && item.enabled;
                const providerDisabled = provider ? !provider.enabled : false;
                return (
                  <tr key={item.model_id} className="text-slate-700">
                    <td className="px-4 py-3">{provider?.display_name || item.provider_key}</td>
                    <td className="px-4 py-3 uppercase">{item.task_type}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{item.display_name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{item.model_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void toggleModelStatus(item)}
                        disabled={providerDisabled || busyKey === `catalog:toggle:${item.model_id}`}
                        aria-pressed={effectivelyEnabled}
                        title={providerDisabled ? "厂商关闭时，模型不可单独开启" : undefined}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                          effectivelyEnabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                            effectivelyEnabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                        <span className="sr-only">{effectivelyEnabled ? "停用模型" : "启用模型"}</span>
                      </button>
                      {providerDisabled ? (
                        <p className="mt-1 text-xs text-slate-500">厂商已关闭，模型跟随关闭</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEditCatalogModal(item)}
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        编辑
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => void deleteModel(item.model_id)}
                        disabled={busyKey === `catalog:delete:${item.model_id}`}
                        className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!sortedCatalog.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    还没有模型配置。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={providerModalOpen}
        title={providerMode === "create" ? "新增厂商" : "编辑厂商"}
        onClose={closeProviderModal}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="text-sm text-slate-600">
            供应商编码
            <input
              value={providerForm.provider_key}
              disabled={providerMode === "edit"}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, provider_key: event.target.value.toUpperCase() }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
              placeholder="例如 DASHSCOPE"
            />
          </label>
          <label className="text-sm text-slate-600">
            供应商名称
            <input
              value={providerForm.display_name}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, display_name: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-600 lg:col-span-2">
            描述
            <input
              value={providerForm.description}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-600">
            Base URL
            <input
              value={providerForm.base_url}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, base_url: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
              placeholder="留空使用默认地址"
            />
          </label>
          <label className="text-sm text-slate-600">
            凭据字段
            <input
              value={providerForm.credential_fields_text}
              onChange={(event) => handleProviderCredentialFieldsChange(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
              placeholder="例如 api_key, secret_key"
            />
          </label>
          {providerFields.length ? (
            <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
              {providerFields.map((field) => (
                <label key={field} className="text-sm text-slate-600">
                  {field}
                  <input
                    type="password"
                    value={providerForm.credential_values[field] || ""}
                    onChange={(event) => handleProviderFieldChange(field, event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
                    placeholder={providerMode === "edit" ? "留空保留；输入 __CLEAR__ 清空" : "输入凭据"}
                  />
                </label>
              ))}
            </div>
          ) : null}
          <label className="text-sm text-slate-600 lg:col-span-2">
            供应商设置 JSON
            <textarea
              value={providerForm.settings_json_text}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, settings_json_text: event.target.value }))}
              className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={providerForm.enabled}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            启用该厂商
          </label>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void saveProvider()}
            disabled={busyKey?.startsWith("provider:") || false}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {providerMode === "create" ? "创建厂商" : "保存厂商"}
          </button>
          <button
            onClick={closeProviderModal}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            取消
          </button>
        </div>
      </Modal>

      <Modal
        open={catalogModalOpen}
        title={catalogMode === "create" ? "新增模型" : "编辑模型"}
        onClose={closeCatalogModal}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="text-sm text-slate-600">
            模型 ID
            <input
              value={catalogForm.model_id}
              disabled={catalogMode === "edit"}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, model_id: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
              placeholder="例如 wan2.6-i2v"
            />
          </label>
          <label className="text-sm text-slate-600">
            模型名称
            <input
              value={catalogForm.display_name}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, display_name: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-600">
            模型类型
            <select
              value={catalogForm.task_type}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, task_type: event.target.value as TaskType }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            >
              <option value="t2i">t2i</option>
              <option value="i2i">i2i</option>
              <option value="i2v">i2v</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            供应商
            <select
              value={catalogForm.provider_key}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, provider_key: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            >
              <option value="">请选择供应商</option>
              {providers.map((provider) => (
                <option key={provider.provider_key} value={provider.provider_key}>
                  {provider.display_name} ({provider.provider_key})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600 lg:col-span-2">
            描述
            <input
              value={catalogForm.description}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-600">
            排序
            <input
              type="number"
              value={catalogForm.sort_order}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, sort_order: Number(event.target.value) || 100 }))}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
            />
          </label>
          <div className="flex items-end gap-6 text-sm font-medium text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={catalogForm.enabled}
                disabled={Boolean(catalogForm.provider_key) && !providerMap.get(catalogForm.provider_key)?.enabled}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              启用
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={catalogForm.is_public}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, is_public: event.target.checked }))}
              />
              对业务前台公开
            </label>
          </div>
          {catalogForm.provider_key && !providerMap.get(catalogForm.provider_key)?.enabled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              当前供应商已关闭，模型不能单独启用。请先开启供应商，再修改模型启用状态。
            </div>
          ) : null}
          <label className="text-sm text-slate-600">
            能力 JSON
            <textarea
              value={catalogForm.capabilities_json_text}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, capabilities_json_text: event.target.value }))}
              className="mt-2 min-h-[140px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="text-sm text-slate-600">
            默认参数 JSON
            <textarea
              value={catalogForm.default_settings_json_text}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, default_settings_json_text: event.target.value }))}
              className="mt-2 min-h-[140px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900"
            />
          </label>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void saveCatalog()}
            disabled={busyKey?.startsWith("catalog:") || false}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {catalogMode === "create" ? "创建模型" : "保存模型"}
          </button>
          <button
            onClick={closeCatalogModal}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            取消
          </button>
        </div>
      </Modal>
    </div>
  );
}
