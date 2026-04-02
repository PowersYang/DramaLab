"use client";

import { Boxes, LayoutGrid, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, type ModelCatalogEntry, type ModelProviderSummary } from "@/lib/api";

type TaskType = "t2i" | "i2i" | "i2v" | "llm";

interface ProviderFormState {
  provider_key: string;
  display_name: string;
  description: string;
  enabled: boolean;
  base_url: string;
  client_base_path: string;
  credential_fields_text: string;
  default_text_model: string;
  supported_text_models_text: string;
  is_default_text_provider: boolean;
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
  client_base_path: "",
  credential_fields_text: "",
  default_text_model: "",
  supported_text_models_text: "",
  is_default_text_provider: false,
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
  const settings = provider.settings_json || {};
  return {
    provider_key: provider.provider_key,
    display_name: provider.display_name,
    description: provider.description || "",
    enabled: provider.enabled,
    base_url: provider.base_url || "",
    client_base_path: typeof settings.client_base_path === "string" ? settings.client_base_path : "",
    credential_fields_text: provider.credential_fields.join(", "),
    default_text_model: typeof settings.default_text_model === "string" ? settings.default_text_model : "",
    supported_text_models_text: Array.isArray(settings.supported_text_models) ? settings.supported_text_models.join(", ") : "",
    is_default_text_provider: Boolean(settings.is_default_text_provider ?? settings.default_for_text),
    credential_values: Object.fromEntries(provider.credential_fields.map((field) => [field, ""])),
    settings_json_text: stringifyJson(settings),
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

function buildProviderSettingsPayload(form: ProviderFormState): Record<string, unknown> {
  const settingsJson = parseJsonField("供应商设置", form.settings_json_text);
  const nextSettings: Record<string, unknown> = { ...settingsJson };
  nextSettings._credential_fields = parseCommaSeparatedList(form.credential_fields_text);
  if (form.client_base_path.trim()) {
    nextSettings.client_base_path = form.client_base_path.trim();
  } else {
    nextSettings.client_base_path = null;
  }
  if (form.default_text_model.trim()) {
    nextSettings.default_text_model = form.default_text_model.trim();
  } else {
    nextSettings.default_text_model = null;
  }
  const supportedTextModels = parseCommaSeparatedList(form.supported_text_models_text);
  if (supportedTextModels.length) {
    nextSettings.supported_text_models = supportedTextModels;
  } else {
    nextSettings.supported_text_models = null;
  }
  if (form.is_default_text_provider) {
    nextSettings.is_default_text_provider = true;
    nextSettings.default_for_text = null;
  } else {
    nextSettings.is_default_text_provider = null;
    nextSettings.default_for_text = null;
  }
  return nextSettings;
}

function getTaskTypeLabel(taskType: TaskType): string {
  if (taskType === "t2i") return "文本生成图";
  if (taskType === "i2i") return "图片重绘";
  if (taskType === "i2v") return "图片生成视频";
  return "大语言模型";
}

function getTaskTypeBadgeClass(taskType: TaskType): string {
  if (taskType === "i2v") return "bg-indigo-100 text-indigo-700";
  if (taskType === "llm") return "bg-fuchsia-100 text-fuchsia-700";
  if (taskType === "i2i") return "bg-cyan-100 text-cyan-700";
  return "bg-amber-100 text-amber-700";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="w-full max-w-3xl rounded-[2.5rem] bg-white shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-all"
          >
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-8">{children}</div>
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
  const [providerQuery, setProviderQuery] = useState("");
  const [providerSelected, setProviderSelected] = useState<Set<string>>(new Set());
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogProviderFilter, setCatalogProviderFilter] = useState("");
  const [catalogSelected, setCatalogSelected] = useState<Set<string>>(new Set());
  const [catalogBulkSortOrder, setCatalogBulkSortOrder] = useState("");

  const providerSelectAllRef = useRef<HTMLInputElement | null>(null);
  const catalogSelectAllRef = useRef<HTMLInputElement | null>(null);

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

  const filteredProviders = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter((item) => {
      const hay = `${item.provider_key} ${item.display_name} ${item.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [providerQuery, providers]);

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return sortedCatalog.filter((item) => {
      if (catalogProviderFilter && item.provider_key !== catalogProviderFilter) {
        return false;
      }
      if (!q) return true;
      const providerName = providerMap.get(item.provider_key)?.display_name || item.provider_key;
      const hay = `${item.model_id} ${item.display_name} ${providerName} ${item.task_type} ${item.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalogProviderFilter, catalogQuery, providerMap, sortedCatalog]);

  useEffect(() => {
    const allowed = new Set(providers.map((item) => item.provider_key));
    setProviderSelected((prev) => new Set(Array.from(prev).filter((key) => allowed.has(key))));
  }, [providers]);

  useEffect(() => {
    const allowed = new Set(sortedCatalog.map((item) => item.model_id));
    setCatalogSelected((prev) => new Set(Array.from(prev).filter((id) => allowed.has(id))));
  }, [sortedCatalog]);

  const providerVisibleKeys = useMemo(() => filteredProviders.map((item) => item.provider_key), [filteredProviders]);
  const providerAllSelected = providerVisibleKeys.length > 0 && providerVisibleKeys.every((key) => providerSelected.has(key));
  const providerSomeSelected =
    providerVisibleKeys.some((key) => providerSelected.has(key)) && !providerAllSelected;

  const catalogVisibleIds = useMemo(() => filteredCatalog.map((item) => item.model_id), [filteredCatalog]);
  const catalogAllSelected = catalogVisibleIds.length > 0 && catalogVisibleIds.every((id) => catalogSelected.has(id));
  const catalogSomeSelected = catalogVisibleIds.some((id) => catalogSelected.has(id)) && !catalogAllSelected;

  useEffect(() => {
    if (!providerSelectAllRef.current) return;
    providerSelectAllRef.current.indeterminate = providerSomeSelected;
  }, [providerSomeSelected]);

  useEffect(() => {
    if (!catalogSelectAllRef.current) return;
    catalogSelectAllRef.current.indeterminate = catalogSomeSelected;
  }, [catalogSomeSelected]);

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
      const settingsJson = buildProviderSettingsPayload(providerForm);
      const createSettingsJson = Object.fromEntries(
        Object.entries(settingsJson).filter(([, value]) => value !== null),
      );
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
          settings_json: createSettingsJson,
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

  const toggleProviderSelected = (providerKey: string) => {
    setProviderSelected((prev) => {
      const next = new Set(prev);
      if (next.has(providerKey)) {
        next.delete(providerKey);
      } else {
        next.add(providerKey);
      }
      return next;
    });
  };

  const toggleProviderSelectAllVisible = () => {
    setProviderSelected((prev) => {
      const next = new Set(prev);
      const shouldSelectAll = !providerVisibleKeys.every((key) => next.has(key));
      providerVisibleKeys.forEach((key) => {
        if (shouldSelectAll) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  };

  const clearProviderSelection = () => setProviderSelected(new Set());

  const bulkSetProvidersEnabled = async (enabled: boolean) => {
    const keys = Array.from(providerSelected);
    if (!keys.length) {
      setError("请先勾选需要批量操作的厂商。");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey(`provider:bulk:${enabled ? "enable" : "disable"}`);
      let ok = 0;
      const failures: string[] = [];
      for (const providerKey of keys) {
        try {
          await api.updateModelProvider(providerKey, { enabled });
          ok += 1;
        } catch {
          failures.push(providerKey);
        }
      }
      await load();
      clearProviderSelection();
      if (failures.length) {
        setError(`批量${enabled ? "启用" : "停用"}：成功 ${ok}，失败 ${failures.length}（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
      } else {
        setSuccessMessage(`已批量${enabled ? "启用" : "停用"} ${ok} 个厂商。`);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const bulkDeleteProviders = async () => {
    const keys = Array.from(providerSelected);
    if (!keys.length) {
      setError("请先勾选需要批量删除的厂商。");
      return;
    }
    if (!window.confirm(`确认删除已选 ${keys.length} 个厂商吗？请确保已删除它们关联的模型。`)) return;
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey("provider:bulk:delete");
      let ok = 0;
      const failures: string[] = [];
      for (const providerKey of keys) {
        try {
          await api.deleteModelProvider(providerKey);
          ok += 1;
        } catch {
          failures.push(providerKey);
        }
      }
      await load();
      clearProviderSelection();
      if (failures.length) {
        setError(`批量删除：成功 ${ok}，失败 ${failures.length}（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
      } else {
        setSuccessMessage(`已批量删除 ${ok} 个厂商。`);
      }
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

  const toggleCatalogSelected = (modelId: string) => {
    setCatalogSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleCatalogSelectAllVisible = () => {
    setCatalogSelected((prev) => {
      const next = new Set(prev);
      const shouldSelectAll = !catalogVisibleIds.every((id) => next.has(id));
      catalogVisibleIds.forEach((id) => {
        if (shouldSelectAll) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  };

  const clearCatalogSelection = () => setCatalogSelected(new Set());

  const bulkSetModelsEnabled = async (enabled: boolean) => {
    const ids = Array.from(catalogSelected);
    if (!ids.length) {
      setError("请先勾选需要批量操作的模型。");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey(`catalog:bulk:${enabled ? "enable" : "disable"}`);
      let ok = 0;
      const failures: string[] = [];
      const skipped: string[] = [];
      for (const modelId of ids) {
        const item = sortedCatalog.find((entry) => entry.model_id === modelId);
        if (!item) continue;
        const provider = providerMap.get(item.provider_key);
        if (enabled && provider && !provider.enabled) {
          skipped.push(modelId);
          continue;
        }
        try {
          await api.updateModelCatalogEntry(modelId, { enabled });
          ok += 1;
        } catch {
          failures.push(modelId);
        }
      }
      await load();
      clearCatalogSelection();
      if (failures.length) {
        setError(`批量${enabled ? "启用" : "停用"}：成功 ${ok}，失败 ${failures.length}（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
        return;
      }
      if (skipped.length) {
        setSuccessMessage(`已批量${enabled ? "启用" : "停用"} ${ok} 个模型；跳过 ${skipped.length} 个（厂商未启用）。`);
        return;
      }
      setSuccessMessage(`已批量${enabled ? "启用" : "停用"} ${ok} 个模型。`);
    } finally {
      setBusyKey(null);
    }
  };

  const bulkDeleteModels = async () => {
    const ids = Array.from(catalogSelected);
    if (!ids.length) {
      setError("请先勾选需要批量删除的模型。");
      return;
    }
    if (!window.confirm(`确认删除已选 ${ids.length} 个模型吗？`)) return;
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey("catalog:bulk:delete");
      let ok = 0;
      const failures: string[] = [];
      for (const modelId of ids) {
        try {
          await api.deleteModelCatalogEntry(modelId);
          ok += 1;
        } catch {
          failures.push(modelId);
        }
      }
      await load();
      clearCatalogSelection();
      if (failures.length) {
        setError(`批量删除：成功 ${ok}，失败 ${failures.length}（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
      } else {
        setSuccessMessage(`已批量删除 ${ok} 个模型。`);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const bulkSetModelsSortOrder = async () => {
    const ids = Array.from(catalogSelected);
    if (!ids.length) {
      setError("请先勾选需要批量设置排序值的模型。");
      return;
    }
    const rawValue = catalogBulkSortOrder.trim();
    const sortOrder = Number(rawValue);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      setError("排序值必须是大于等于 0 的整数。");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    try {
      setBusyKey("catalog:bulk:sort");
      let ok = 0;
      const failures: string[] = [];
      for (const modelId of ids) {
        try {
          await api.updateModelCatalogEntry(modelId, { sort_order: sortOrder });
          ok += 1;
        } catch {
          failures.push(modelId);
        }
      }
      await load();
      if (failures.length) {
        setError(`批量设置排序：成功 ${ok}，失败 ${failures.length}（${failures.slice(0, 6).join(", ")}${failures.length > 6 ? "..." : ""}）。`);
      } else {
        setSuccessMessage(`已批量设置 ${ok} 个模型的排序值为 ${sortOrder}。`);
      }
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
          <p className="text-sm font-bold text-slate-400">正在同步模型配置...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      {/* 厂商管理部分 */}
      <section className="animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
          <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Boxes size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">厂商管理</h3>
                <p className="text-sm text-slate-500">配置模型供应商、API 密钥与基础连接参数</p>
              </div>
            </div>
            <button
              onClick={openCreateProviderModal}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 shadow-lg shadow-slate-200"
            >
              <Plus size={16} /> 新增厂商
            </button>
          </div>

          <div className="px-8 py-4 border-b border-slate-100 bg-white/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <Search size={14} className="text-slate-400" />
                  <input
                    value={providerQuery}
                    onChange={(event) => setProviderQuery(event.target.value)}
                    placeholder="搜索厂商编码 / 名称"
                    className="w-56 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                {providerSelected.size > 0 && (
                  <div className="flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/60 px-4 py-2 text-xs font-bold text-indigo-700">
                    已选 {providerSelected.size}
                    <button
                      onClick={clearProviderSelection}
                      className="ml-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-indigo-700 hover:bg-white transition-all"
                    >
                      清空
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void bulkSetProvidersEnabled(true)}
                  disabled={!providerSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-600 active:scale-95 disabled:opacity-30"
                >
                  批量启用
                </button>
                <button
                  onClick={() => void bulkSetProvidersEnabled(false)}
                  disabled={!providerSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:border-amber-200 hover:text-amber-700 disabled:opacity-30"
                >
                  批量停用
                </button>
                <button
                  onClick={() => void bulkDeleteProviders()}
                  disabled={!providerSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-rose-100 px-4 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                  批量删除
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="w-14 px-8 py-4">
                    <input
                      ref={providerSelectAllRef}
                      type="checkbox"
                      checked={providerAllSelected}
                      onChange={toggleProviderSelectAllVisible}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                      aria-label="全选（当前筛选）"
                    />
                  </th>
                  <th className="px-8 py-4">厂商编码</th>
                  <th className="px-8 py-4">厂商名称</th>
                  <th className="px-8 py-4">状态</th>
                  <th className="px-8 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {filteredProviders.map((provider) => {
                  const isSelected = providerSelected.has(provider.provider_key);
                  return (
                  <tr
                    key={provider.provider_key}
                    className={`group hover:bg-slate-50/60 transition-all ${isSelected ? "bg-indigo-50/40" : ""}`}
                  >
                    <td className="w-14 px-8 py-5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleProviderSelected(provider.provider_key)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                        aria-label={`选择 ${provider.provider_key}`}
                      />
                    </td>
                    <td className="px-8 py-5">
                      <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-500">
                        {provider.provider_key}
                      </code>
                    </td>
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-900">{provider.display_name}</div>
                      <div className="mt-1 text-xs text-slate-400 truncate max-w-xs">{provider.description || "暂无描述"}</div>
                    </td>
                    <td className="px-8 py-5">
                      <button
                        onClick={() => void toggleProviderStatus(provider)}
                        disabled={busyKey === `provider:toggle:${provider.provider_key}` || Boolean(busyKey?.startsWith("provider:bulk"))}
                        aria-pressed={provider.enabled}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all disabled:opacity-50 ${
                          provider.enabled ? "bg-emerald-500" : "bg-slate-200"
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-all ${
                          provider.enabled ? "translate-x-6" : "translate-x-1"
                        }`} />
                        <span className="sr-only">{provider.enabled ? "停用厂商" : "启用厂商"}</span>
                      </button>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditProviderModal(provider)}
                          disabled={Boolean(busyKey)}
                          className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition-all hover:border-indigo-200 hover:text-indigo-600"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => void deleteProvider(provider.provider_key)}
                          disabled={busyKey === `provider:delete:${provider.provider_key}` || Boolean(busyKey)}
                          className="rounded-xl bg-white border border-rose-100 px-4 py-2 text-xs font-bold text-rose-500 transition-all hover:bg-rose-50 disabled:opacity-30"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );})}
                {!filteredProviders.length && (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-slate-400 font-medium">
                      没有匹配的厂商配置。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 模型目录部分 */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
        <div className="studio-panel overflow-hidden border-none bg-white/60 backdrop-blur-xl shadow-sm transition-all hover:shadow-md">
          <div className="border-b border-slate-100 bg-slate-50/30 px-8 py-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <LayoutGrid size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">模型管理</h3>
                <p className="text-sm text-slate-500">管理各厂商下的具体模型规格、可见性与参数策略</p>
              </div>
            </div>
            <button
              onClick={openCreateCatalogModal}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 shadow-lg shadow-slate-200"
            >
              <Plus size={16} /> 新增模型
            </button>
          </div>

          <div className="px-8 py-4 border-b border-slate-100 bg-white/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <Search size={14} className="text-slate-400" />
                  <input
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="搜索模型 ID / 名称 / 厂商"
                    className="w-64 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                <select
                  value={catalogProviderFilter}
                  onChange={(event) => setCatalogProviderFilter(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                >
                  <option value="">全部厂商</option>
                  {providers.map((provider) => (
                    <option key={provider.provider_key} value={provider.provider_key}>
                      {provider.display_name}
                    </option>
                  ))}
                </select>

                {catalogSelected.size > 0 && (
                  <div className="flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/60 px-4 py-2 text-xs font-bold text-indigo-700">
                    已选 {catalogSelected.size}
                    <button
                      onClick={clearCatalogSelection}
                      className="ml-1 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black text-indigo-700 hover:bg-white transition-all"
                    >
                      清空
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">排序</span>
                  <input
                    value={catalogBulkSortOrder}
                    onChange={(event) => setCatalogBulkSortOrder(event.target.value)}
                    placeholder="例如 100"
                    className="w-24 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                <button
                  onClick={() => void bulkSetModelsSortOrder()}
                  disabled={!catalogSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:border-indigo-200 hover:text-indigo-600 disabled:opacity-30"
                >
                  批量设排序
                </button>
                <button
                  onClick={() => void bulkSetModelsEnabled(true)}
                  disabled={!catalogSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-600 active:scale-95 disabled:opacity-30"
                >
                  批量启用
                </button>
                <button
                  onClick={() => void bulkSetModelsEnabled(false)}
                  disabled={!catalogSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:border-amber-200 hover:text-amber-700 disabled:opacity-30"
                >
                  批量停用
                </button>
                <button
                  onClick={() => void bulkDeleteModels()}
                  disabled={!catalogSelected.size || Boolean(busyKey)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-rose-100 px-4 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                  批量删除
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="w-14 px-8 py-4">
                    <input
                      ref={catalogSelectAllRef}
                      type="checkbox"
                      checked={catalogAllSelected}
                      onChange={toggleCatalogSelectAllVisible}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                      aria-label="全选（当前筛选）"
                    />
                  </th>
                  <th className="px-8 py-4">模型展示</th>
                  <th className="px-8 py-4">归属厂商</th>
                  <th className="px-8 py-4">类型与范围</th>
                  <th className="px-8 py-4">状态</th>
                  <th className="px-8 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/50">
                {filteredCatalog.map((item) => {
                  const provider = providerMap.get(item.provider_key);
                  const effectivelyEnabled = Boolean(provider?.enabled) && item.enabled;
                  const providerDisabled = provider ? !provider.enabled : false;
                  const isSelected = catalogSelected.has(item.model_id);
                  return (
                    <tr
                      key={item.model_id}
                      className={`group hover:bg-slate-50/60 transition-all ${isSelected ? "bg-indigo-50/40" : ""}`}
                    >
                      <td className="w-14 px-8 py-5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCatalogSelected(item.model_id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 accent-indigo-600"
                          aria-label={`选择 ${item.model_id}`}
                        />
                      </td>
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900">{item.display_name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-slate-300">#{item.sort_order}</span>
                          <code className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                            {item.model_id}
                          </code>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          {provider?.display_name || item.provider_key}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            getTaskTypeBadgeClass(item.task_type as TaskType)
                          }`}>
                            {getTaskTypeLabel(item.task_type as TaskType)}
                          </span>
                          {item.is_public && (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              Public
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => void toggleModelStatus(item)}
                            disabled={providerDisabled || busyKey === `catalog:toggle:${item.model_id}` || Boolean(busyKey?.startsWith("catalog:bulk"))}
                            aria-pressed={effectivelyEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all disabled:opacity-50 ${
                              effectivelyEnabled ? "bg-emerald-500" : "bg-slate-200"
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-all ${
                              effectivelyEnabled ? "translate-x-6" : "translate-x-1"
                            }`} />
                            <span className="sr-only">{effectivelyEnabled ? "停用模型" : "启用模型"}</span>
                          </button>
                          {providerDisabled && (
                            <span className="text-[9px] font-bold text-amber-600">厂商已关</span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEditCatalogModal(item)}
                            disabled={Boolean(busyKey)}
                            className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition-all hover:border-indigo-200 hover:text-indigo-600"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => void deleteModel(item.model_id)}
                            disabled={busyKey === `catalog:delete:${item.model_id}` || Boolean(busyKey)}
                            className="rounded-xl bg-white border border-rose-100 px-4 py-2 text-xs font-bold text-rose-500 transition-all hover:bg-rose-50 disabled:opacity-30"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filteredCatalog.length && (
                  <tr>
                    <td colSpan={6} className="px-8 py-20 text-center text-slate-400 font-medium">
                      没有匹配的模型配置。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 全局消息提示 */}
      <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 space-y-3 pointer-events-none">
        {successMessage && (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex items-center gap-3 rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            {successMessage}
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

      {/* 厂商配置 Modal */}
      <Modal
        open={providerModalOpen}
        title={providerMode === "create" ? "新增厂商配置" : "编辑厂商配置"}
        onClose={closeProviderModal}
      >
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">厂商编码 (provider_key)</label>
              <input
                value={providerForm.provider_key}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, provider_key: event.target.value.toUpperCase() }))}
                disabled={providerMode === "edit"}
                placeholder="例如: OPENAI"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">厂商展示名称</label>
              <input
                value={providerForm.display_name}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, display_name: event.target.value }))}
                placeholder="例如: OpenAI"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">基础 API 地址 (Base URL)</label>
            <input
              value={providerForm.base_url}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, base_url: event.target.value }))}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">客户端路径后缀</label>
            <input
              value={providerForm.client_base_path}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, client_base_path: event.target.value }))}
              placeholder="/compatible-mode/v1"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
            <p className="text-[11px] leading-5 text-slate-400">
              用于 OpenAI 兼容客户端类调用。比如 DashScope 这里通常配置为 <code>/compatible-mode/v1</code>。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">鉴权字段定义 (英文逗号分隔)</label>
            <input
              value={providerForm.credential_fields_text}
              onChange={(event) => handleProviderCredentialFieldsChange(event.target.value)}
              placeholder="api_key, organization_id"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">默认文本模型</label>
              <input
                value={providerForm.default_text_model}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, default_text_model: event.target.value }))}
                placeholder="例如: gpt-4o / qwen3.5-plus"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">支持的文本模型 (英文逗号分隔)</label>
              <input
                value={providerForm.supported_text_models_text}
                onChange={(event) => setProviderForm((prev) => ({ ...prev, supported_text_models_text: event.target.value }))}
                placeholder="gpt-4o, gpt-4.1-mini"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          {providerFields.length > 0 && (
            <div className="rounded-2xl bg-amber-50/50 p-6 border border-amber-100 space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-700">API 凭据配置</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {providerFields.map((field) => (
                  <div key={field} className="space-y-2">
                    <label className="text-xs font-bold text-amber-600/80 ml-1">{field}</label>
                    <input
                      type="password"
                      value={providerForm.credential_values[field] || ""}
                      onChange={(event) => handleProviderFieldChange(field, event.target.value)}
                      placeholder={providerMode === "edit" ? "留空保留；输入 __CLEAR__ 清空" : "请输入密钥"}
                      className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-mono text-slate-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">厂商描述</label>
            <textarea
              value={providerForm.description}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={2}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">供应商设置 JSON</label>
            <textarea
              value={providerForm.settings_json_text}
              onChange={(event) => setProviderForm((prev) => ({ ...prev, settings_json_text: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`flex h-6 w-11 items-center rounded-full p-1 transition-all ${providerForm.enabled ? "bg-indigo-600" : "bg-slate-200"}`}>
                  <div className={`h-4 w-4 rounded-full bg-white transition-all ${providerForm.enabled ? "translate-x-5" : "translate-x-0"}`} />
                </div>
                <input
                  type="checkbox"
                  checked={providerForm.enabled}
                  onChange={(event) => setProviderForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                  className="hidden"
                />
                <span className="text-sm font-bold text-slate-700">启用该厂商</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={providerForm.is_default_text_provider}
                  onChange={(event) => setProviderForm((prev) => ({ ...prev, is_default_text_provider: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-bold text-slate-700">设为默认文本供应商</span>
              </label>
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeProviderModal}
                className="rounded-2xl border border-slate-200 px-6 py-4 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={() => void saveProvider()}
                disabled={!!busyKey}
                className="rounded-2xl bg-slate-900 px-10 py-4 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30 shadow-lg shadow-slate-200"
              >
                {busyKey?.startsWith("provider:") ? "正在保存..." : "保存厂商配置"}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 模型目录 Modal */}
      <Modal
        open={catalogModalOpen}
        title={catalogMode === "create" ? "新增模型目录项" : "编辑模型目录项"}
        onClose={closeCatalogModal}
      >
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">模型唯一标识 (model_id)</label>
              <input
                value={catalogForm.model_id}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, model_id: event.target.value }))}
                disabled={catalogMode === "edit"}
                placeholder="例如: gpt-4o"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">展示名称</label>
              <input
                value={catalogForm.display_name}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, display_name: event.target.value }))}
                placeholder="例如: GPT-4o (Vision)"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">归属厂商</label>
              <select
                value={catalogForm.provider_key}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, provider_key: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              >
                <option value="">请选择供应商</option>
                {providers.map((p) => (
                  <option key={p.provider_key} value={p.provider_key}>
                    {p.display_name} ({p.provider_key})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">任务类型</label>
              <select
                value={catalogForm.task_type}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, task_type: event.target.value as TaskType }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              >
                <option value="t2i">文本生成图 (T2I)</option>
                <option value="i2i">图片重绘 (I2I)</option>
                <option value="i2v">图片生成视频 (I2V)</option>
                <option value="llm">大语言模型 (LLM)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 ml-1">模型描述</label>
            <input
              value={catalogForm.description}
              onChange={(event) => setCatalogForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="简短描述模型能力"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">排序权重 (越小越靠前)</label>
              <input
                type="number"
                value={catalogForm.sort_order}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, sort_order: Number(event.target.value) || 100 }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-4 pt-8">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={catalogForm.enabled}
                  disabled={Boolean(catalogForm.provider_key) && !providerMap.get(catalogForm.provider_key)?.enabled}
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-bold text-slate-700">启用该项</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={catalogForm.is_public}
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, is_public: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-bold text-slate-700">对业务前台公开</span>
              </label>
            </div>
          </div>

          {catalogForm.provider_key && !providerMap.get(catalogForm.provider_key)?.enabled && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              当前供应商已关闭，模型不能单独启用。请先开启供应商，再修改模型启用状态。
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">能力定义 (JSON)</label>
              <textarea
                value={catalogForm.capabilities_json_text}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, capabilities_json_text: event.target.value }))}
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 ml-1">默认参数 (JSON)</label>
              <textarea
                value={catalogForm.default_settings_json_text}
                onChange={(event) => setCatalogForm((prev) => ({ ...prev, default_settings_json_text: event.target.value }))}
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-mono text-slate-600 outline-none focus:border-indigo-500 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={closeCatalogModal}
              className="rounded-2xl border border-slate-200 px-6 py-4 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
            >
              取消
            </button>
            <button
              onClick={() => void saveCatalog()}
              disabled={!!busyKey}
              className="rounded-2xl bg-slate-900 px-10 py-4 text-sm font-bold text-white transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-30 shadow-lg shadow-slate-200"
            >
              {busyKey?.startsWith("catalog:") ? "正在保存..." : "保存模型项"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
