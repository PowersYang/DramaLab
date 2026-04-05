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
    logger.info("启动：环境配置路径=%s 当前工作目录=%s", env_path, os.getcwd())

    logger.info(
        "启动：对象存储配置 端点=%s 桶=%s 路径前缀=%s",
        get_env("OSS_ENDPOINT"),
        get_env("OSS_BUCKET_NAME"),
        get_env("OSS_BASE_PATH"),
    )

    # 数据库初始化单独打点，后续如果启动卡住，能快速判断是否阻塞在建表或连库阶段。
    logger.info("启动：开始初始化数据库连接")
    init_database()
    logger.info("启动：数据库初始化完成")
    # 风格预设已经迁移到数据库，启动时补种默认值，保证新环境首启即可返回预设列表。
    from ..application.services import AuthService, SystemService

    SystemService().ensure_default_style_presets()
    auth_service = AuthService()
    auth_service.ensure_default_roles()
    auth_service.ensure_existing_users_have_initial_password()
    logger.info("启动：默认风格预设初始化完成")

    # 运行时产物统一走临时文件 + OSS，不再依赖仓库内 output 挂载目录。
    logger.info("启动：已禁用本地输出目录挂载；运行时产物统一使用临时文件 + 对象存储")
