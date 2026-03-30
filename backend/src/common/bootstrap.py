import logging
import os

from ..db import init_database
from src.settings.env_settings import get_env, get_env_path, reload_env_settings
from .log import setup_logging


def bootstrap_api_environment(logger: logging.Logger) -> None:
    """初始化 API 运行时环境。"""
    setup_logging()

    # 启动阶段先重载环境变量，确保 supervisor 或手工改动后的配置能够即时生效。
    reload_env_settings()
    env_path = get_env_path()
    logger.info("STARTUP: env_path=%s cwd=%s", env_path, os.getcwd())

    logger.info(
        "STARTUP: OSS_ENDPOINT=%s, OSS_BUCKET_NAME=%s, OSS_BASE_PATH=%s",
        get_env("OSS_ENDPOINT"),
        get_env("OSS_BUCKET_NAME"),
        get_env("OSS_BASE_PATH"),
    )

    # 数据库初始化单独打点，后续如果启动卡住，能快速判断是否阻塞在建表或连库阶段。
    logger.info("STARTUP: initializing database connection")
    init_database()
    logger.info("STARTUP: database initialization completed")
    # 风格预设已经迁移到数据库，启动时补种默认值，保证新环境首启即可返回预设列表。
    from ..application.services import AuthService, ModelProviderService, SystemService

    SystemService().ensure_default_style_presets()
    auth_service = AuthService()
    auth_service.ensure_default_roles()
    auth_service.ensure_existing_users_have_initial_password()
    model_provider_service = ModelProviderService()
    model_provider_service.ensure_defaults()
    model_provider_service.migrate_from_env()
    logger.info("STARTUP: style preset bootstrap completed")

    # 输出目录在分布式部署里通常会被映射到共享存储，这里显式创建并记录状态，便于排查挂载问题。
    os.makedirs("output", exist_ok=True)
    os.makedirs("output/uploads", exist_ok=True)
    os.makedirs("output/video", exist_ok=True)
    os.makedirs("output/assets", exist_ok=True)
    logger.info("STARTUP: output directories are ready")
