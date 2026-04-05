type VariantWithBatch = {
  id: string;
  url?: string | null;
  created_at?: string | number | null;
  batch_id?: string | null;
};

const parseVariantTimestamp = (value: string | number | undefined | null) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const sortVariantsDesc = <T extends VariantWithBatch>(variants: T[]) =>
  [...variants].sort((left, right) => parseVariantTimestamp(right.created_at) - parseVariantTimestamp(left.created_at));

export const getLatestVariantBatch = <T extends VariantWithBatch>(variants: T[]) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return [];
  }

  const sortedVariants = sortVariantsDesc(variants);
  const latestBatchId = sortedVariants[0]?.batch_id;

  // 中文注释：新数据优先按后端写入的 batch_id 截断为“最近一次生成批次”；
  // 老数据没有 batch_id 时，退回历史兼容策略，只展示最新 4 张。
  if (latestBatchId) {
    return sortedVariants.filter((variant) => variant.batch_id === latestBatchId);
  }

  return sortedVariants.slice(0, 4);
};
