import logging
import os

from ..db import init_database
from src.settings.env_settings import get_env, get_env_path, reload_env_settings
from ..utils import setup_logging


def bootstrap_api_environment(logger: logging.Logger) -> None:
    """初始化 API 运行时环境。"""
    setup_logging()

    reload_env_settings()
    env_path = get_env_path()

    logger.info(
        "STARTUP: OSS_ENDPOINT=%s, OSS_BUCKET_NAME=%s, OSS_BASE_PATH=%s",
        get_env("OSS_ENDPOINT"),
        get_env("OSS_BUCKET_NAME"),
        get_env("OSS_BASE_PATH"),
    )

    init_database()
    os.makedirs("output", exist_ok=True)
    os.makedirs("output/uploads", exist_ok=True)
    os.makedirs("output/video", exist_ok=True)
    os.makedirs("output/assets", exist_ok=True)
