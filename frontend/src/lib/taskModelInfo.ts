import type { TaskJob } from "@/lib/api";

export interface TaskModelInfo {
  requestedModel: string | null;
  resolvedModel: string | null;
  fallbackReason: string | null;
}

export function getTaskModelInfo(job: TaskJob): TaskModelInfo {
  const result = job.result_json || {};
  const requestedModel =
    typeof result.requested_model === "string" && result.requested_model.trim()
      ? result.requested_model.trim()
      : typeof job.payload_json?.requested_model === "string" && job.payload_json.requested_model.trim()
      ? job.payload_json.requested_model.trim()
      : typeof job.payload_json?.model_name === "string" && job.payload_json.model_name.trim()
      ? job.payload_json.model_name.trim()
      : typeof job.payload_json?.model === "string" && job.payload_json.model.trim()
      ? job.payload_json.model.trim()
      : null;
  const resolvedModel =
    typeof result.resolved_model === "string" && result.resolved_model.trim()
      ? result.resolved_model.trim()
      : typeof result.__metrics__?.provider?.model === "string" && result.__metrics__.provider.model.trim()
      ? result.__metrics__.provider.model.trim()
      : typeof result.model === "string" && result.model.trim()
      ? result.model.trim()
      : requestedModel;
  const fallbackReason =
    typeof result.fallback_reason === "string" && result.fallback_reason.trim() ? result.fallback_reason.trim() : null;

  return {
    requestedModel,
    resolvedModel,
    fallbackReason,
  };
}

export function formatTaskModelSummary(job: TaskJob): string | null {
  const info = getTaskModelInfo(job);
  if (!info.requestedModel && !info.resolvedModel) {
    return null;
  }
  if (info.requestedModel && info.resolvedModel && info.requestedModel !== info.resolvedModel) {
    return `请求模型：${info.requestedModel}，实际执行：${info.resolvedModel}`;
  }
  return `执行模型：${info.resolvedModel || info.requestedModel}`;
}
