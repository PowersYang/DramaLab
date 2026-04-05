import axiosLib from "axios";

import type { TaskJob } from "@/lib/api";
import { getTaskModelInfo } from "@/lib/taskModelInfo";

export function formatTaskFailureMessage(job: TaskJob, fallbackMessage: string) {
  const modelInfo = getTaskModelInfo(job);
  const parts = [job.error_message || fallbackMessage];

  if (modelInfo.requestedModel && modelInfo.resolvedModel && modelInfo.requestedModel !== modelInfo.resolvedModel) {
    parts.push(`请求模型：${modelInfo.requestedModel}`);
    parts.push(`实际执行：${modelInfo.resolvedModel}`);
  } else if (modelInfo.resolvedModel || modelInfo.requestedModel) {
    parts.push(`执行模型：${modelInfo.resolvedModel || modelInfo.requestedModel}`);
  }

  if (modelInfo.fallbackReason) {
    parts.push(modelInfo.fallbackReason);
  }

  return parts.filter(Boolean).join("\n");
}

export function formatRequestFailureMessage(error: unknown, fallbackMessage: string) {
  if (!axiosLib.isAxiosError(error)) {
    return error instanceof Error ? error.message : fallbackMessage;
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return `${fallbackMessage}: ${detail.trim()}`;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return `${fallbackMessage}: ${error.message.trim()}`;
  }

  return fallbackMessage;
}
