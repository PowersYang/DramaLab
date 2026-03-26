"""
统一的 .env 配置读写入口。
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values, set_key, unset_key

from src.utils import get_user_data_dir


_ENV_PATH_OVERRIDE: Path | None = None


def get_env_path() -> Path:
    """返回当前运行环境对应的 .env 文件路径。"""
    if _ENV_PATH_OVERRIDE is not None:
        return _ENV_PATH_OVERRIDE

    if getattr(sys, "frozen", False):
        config_dir = Path(get_user_data_dir())
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir / ".env"

    # backend/src/settings/env_settings.py -> backend/.env
    return Path(__file__).resolve().parent.parent.parent / ".env"


@lru_cache(maxsize=1)
def _load_env_values() -> dict[str, str]:
    """从 .env 文件读取配置，并缓存到当前进程。"""
    env_path = get_env_path()
    if not env_path.exists():
        return {}
    values = dotenv_values(env_path)
    return {key: value for key, value in values.items() if value is not None}


def reload_env_settings() -> None:
    """清空缓存，下次读取时重新从 .env 文件加载。"""
    _load_env_values.cache_clear()


def get_env(key: str, default: str | None = None) -> str | None:
    """从 .env 文件读取单个配置项。"""
    return _load_env_values().get(key, default)


def get_env_bool(key: str, default: bool = False) -> bool:
    """按布尔语义读取配置项。"""
    value = get_env(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def has_env(key: str) -> bool:
    """判断某个配置项是否已在 .env 中配置。"""
    value = get_env(key)
    return value is not None and value != ""


def get_env_map() -> dict[str, str]:
    """返回当前 .env 文件中的全部配置。"""
    return dict(_load_env_values())


def save_env_values(config: dict[str, object]) -> Path:
    """把配置写入 .env 文件，并刷新缓存。"""
    env_path = get_env_path()
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.touch(exist_ok=True)

    for key, value in config.items():
        if value is None:
            continue
        set_key(str(env_path), key, str(value))

    reload_env_settings()
    return env_path


def remove_env_keys(keys: list[str]) -> Path:
    """从 .env 文件中删除指定键，并刷新缓存。"""
    env_path = get_env_path()
    if env_path.exists():
        for key in keys:
            try:
                unset_key(str(env_path), key)
            except Exception:
                pass
    reload_env_settings()
    return env_path


def override_env_path_for_tests(path: str | os.PathLike[str] | None) -> None:
    """为测试切换 .env 文件路径。"""
    global _ENV_PATH_OVERRIDE
    _ENV_PATH_OVERRIDE = Path(path) if path is not None else None
    reload_env_settings()
