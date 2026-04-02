"""任务执行器计费 metrics 辅助函数。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def clone_metrics(metrics: dict[str, Any] | None) -> dict[str, Any] | None:
    """复制一份 metrics，避免执行器在补充资源信息时反向污染 provider 内部状态。"""
    if not metrics:
        return None
    return deepcopy(metrics)


def attach_resource_metrics(
    metrics: dict[str, Any] | None,
    *,
    operation: str,
    resource: dict[str, Any] | None = None,
    artifacts: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """在 provider 采样结果上补充任务上下文，统一形成计费落库所需结构。"""
    if not metrics:
        return None
    payload = clone_metrics(metrics) or {}
    payload.setdefault("version", "v1")
    payload["operation"] = operation
    if resource:
        payload["resource"] = {**(payload.get("resource") or {}), **resource}
    if artifacts:
        payload["artifacts"] = {**(payload.get("artifacts") or {}), **artifacts}
    return payload
