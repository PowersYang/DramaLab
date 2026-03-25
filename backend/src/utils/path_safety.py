"""
路径与标识安全辅助函数。

这些函数原先挂在 legacy pipeline 上。
迁移到 utils 后，业务层就不再需要依赖 pipeline 模块。
"""

from __future__ import annotations

import os
import re


_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")


def validate_safe_id(value: str, label: str = "id") -> str:
    """校验 ID 是否适合放进文件路径或命令参数。"""
    if not value or not _SAFE_ID_RE.match(value):
        raise ValueError(f"Invalid {label}: contains unsafe characters")
    return value


def safe_resolve_path(base_dir: str, untrusted_rel: str) -> str:
    """在给定基目录下解析相对路径，并确保结果不会逃逸出基目录。"""
    base = os.path.realpath(base_dir)
    resolved = os.path.realpath(os.path.join(base, untrusted_rel))
    if not resolved.startswith(base + os.sep) and resolved != base:
        raise ValueError(f"Path escapes base directory: {untrusted_rel}")
    return resolved
