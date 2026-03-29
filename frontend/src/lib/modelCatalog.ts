"use client";

import { useEffect, useState } from "react";

import { api, type AvailableModelCatalog, type ModelCatalogEntry } from "@/lib/api";
import { I2I_MODELS, I2V_MODELS, type I2VModelConfig, type ModelParamSupport, T2I_MODELS } from "@/store/projectStore";

export interface SimpleModelOption {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
  unavailableReason?: string;
}

export interface AvailableModelView {
  t2i: SimpleModelOption[];
  i2i: SimpleModelOption[];
  i2v: I2VModelConfig[];
}

const fallbackCatalog: AvailableModelView = {
  t2i: T2I_MODELS,
  i2i: I2I_MODELS,
  i2v: I2V_MODELS,
};

const toSimpleOption = (item: ModelCatalogEntry): SimpleModelOption => ({
  id: item.model_id,
  name: item.display_name,
  description: item.description || "",
});

const toI2vConfig = (item: ModelCatalogEntry): I2VModelConfig => {
  const fallback = I2V_MODELS.find((model) => model.id === item.model_id);
  const capabilities = item.capabilities_json || {};
  const params = (capabilities.params || fallback?.params || {}) as ModelParamSupport;
  const duration = capabilities.duration || fallback?.duration || { type: "buttons", options: [5, 10], default: 5 };
  return {
    id: item.model_id,
    name: item.display_name,
    description: item.description || "",
    duration,
    params,
  };
};

const appendLegacySimpleOption = (
  options: SimpleModelOption[],
  selectedId: string | undefined,
  fallbackOptions: SimpleModelOption[],
): SimpleModelOption[] => {
  if (!selectedId || options.some((item) => item.id === selectedId)) {
    return options;
  }
  const fallback = fallbackOptions.find((item) => item.id === selectedId);
  if (!fallback) {
    return options;
  }
  return [
    ...options,
    {
      ...fallback,
      disabled: true,
      unavailableReason: "该模型已被管理员下线，不可继续新建任务。",
    },
  ];
};

const appendLegacyI2vOption = (options: I2VModelConfig[], selectedId: string | undefined): I2VModelConfig[] => {
  if (!selectedId || options.some((item) => item.id === selectedId)) {
    return options;
  }
  const fallback = I2V_MODELS.find((item) => item.id === selectedId);
  if (!fallback) {
    return options;
  }
  return [
    ...options,
    {
      ...fallback,
      description: `${fallback.description}（该模型已被管理员下线，不可继续新建任务）`,
    },
  ];
};

const normalizeCatalog = (payload: AvailableModelCatalog | null | undefined): AvailableModelView => {
  if (!payload) {
    return fallbackCatalog;
  }
  return {
    t2i: payload.t2i?.length ? payload.t2i.map(toSimpleOption) : fallbackCatalog.t2i,
    i2i: payload.i2i?.length ? payload.i2i.map(toSimpleOption) : fallbackCatalog.i2i,
    i2v: payload.i2v?.length ? payload.i2v.map(toI2vConfig) : fallbackCatalog.i2v,
  };
};

export function useAvailableModelCatalog(selected?: { t2i?: string; i2i?: string; i2v?: string }) {
  const [catalog, setCatalog] = useState<AvailableModelView>(() => ({
    t2i: appendLegacySimpleOption(fallbackCatalog.t2i, selected?.t2i, fallbackCatalog.t2i),
    i2i: appendLegacySimpleOption(fallbackCatalog.i2i, selected?.i2i, fallbackCatalog.i2i),
    i2v: appendLegacyI2vOption(fallbackCatalog.i2v, selected?.i2v),
  }));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getAvailableModels()
      .then((payload) => {
        if (cancelled) return;
        const normalized = normalizeCatalog(payload);
        setCatalog({
          t2i: appendLegacySimpleOption(normalized.t2i, selected?.t2i, fallbackCatalog.t2i),
          i2i: appendLegacySimpleOption(normalized.i2i, selected?.i2i, fallbackCatalog.i2i),
          i2v: appendLegacyI2vOption(normalized.i2v, selected?.i2v),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCatalog({
          t2i: appendLegacySimpleOption(fallbackCatalog.t2i, selected?.t2i, fallbackCatalog.t2i),
          i2i: appendLegacySimpleOption(fallbackCatalog.i2i, selected?.i2i, fallbackCatalog.i2i),
          i2v: appendLegacyI2vOption(fallbackCatalog.i2v, selected?.i2v),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.t2i, selected?.i2i, selected?.i2v]);

  return { catalog, loading };
}
