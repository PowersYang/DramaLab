import logging
import os
import sys


logger = logging.getLogger(__name__)
LOG_FORMAT = "%(asctime)s | %(levelname)s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
_LEVEL_NAME_CN = {
    "DEBUG": "调试",
    "INFO": "信息",
    "WARNING": "警告",
    "ERROR": "错误",
    "CRITICAL": "致命",
}


class _ChineseLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        original = record.levelname
        try:
            record.levelname = _LEVEL_NAME_CN.get(record.levelname, record.levelname)
            return super().format(record)
        finally:
            record.levelname = original


def get_user_data_dir() -> str:
    """返回应用的用户数据目录。"""
    return os.path.join(os.path.expanduser("~"), ".dramalab")


def get_log_dir() -> str:
    """返回日志目录，并确保目录存在。"""
    log_dir = os.path.join(get_user_data_dir(), "logs")
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def setup_logging(level: int = logging.INFO, log_file: str | None = None) -> None:
    """配置日志系统。"""
    root_logger = logging.getLogger()
    if root_logger.handlers and log_file is None:
        return

    handlers: list[logging.Handler] = []

    if log_file is None:
        log_file = os.path.join(get_log_dir(), "app.log")

    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)

        file_handler = logging.FileHandler(log_file, mode="a", encoding="utf-8")
        file_handler.setFormatter(_ChineseLogFormatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT))
        handlers.append(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(_ChineseLogFormatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT))
    handlers.append(console_handler)

    logging.basicConfig(
        level=level,
        format=LOG_FORMAT,
        datefmt=LOG_DATE_FORMAT,
        handlers=handlers,
    )

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(logging.CRITICAL + 1)


def get_logger(name: str) -> logging.Logger:
    """按名称获取 logger。"""
    return logging.getLogger(name)
