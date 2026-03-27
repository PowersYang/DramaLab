"""公共模块对外导出。"""

from .log import get_log_dir, get_logger, get_user_data_dir, logger, setup_logging


def bootstrap_api_environment(*args, **kwargs):
    """延迟导入启动逻辑，避免 common/db/settings 在测试阶段形成循环依赖。"""
    from .bootstrap import bootstrap_api_environment as _bootstrap_api_environment

    return _bootstrap_api_environment(*args, **kwargs)


def signed_response(*args, **kwargs):
    """延迟导入响应封装，避免 settings/common 的初始化互相咬住。"""
    from .responses import signed_response as _signed_response

    return _signed_response(*args, **kwargs)


__all__ = [
    "bootstrap_api_environment",
    "get_log_dir",
    "get_logger",
    "get_user_data_dir",
    "logger",
    "signed_response",
    "setup_logging",
]
