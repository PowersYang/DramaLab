import logging
import sys
import os

# 用户级数据目录，统一存日志、配置和运行数据
def get_user_data_dir() -> str:
    """返回应用的用户数据目录。"""
    return os.path.join(os.path.expanduser("~"), ".lumen-x")


def get_log_dir() -> str:
    """返回日志目录，并确保目录存在。"""
    log_dir = os.path.join(get_user_data_dir(), "logs")
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def setup_logging(level=logging.INFO, log_file=None):
    """配置日志系统。"""
    handlers = []
    
    # 没指定日志文件时，默认写到用户目录
    if log_file is None:
        log_file = os.path.join(get_log_dir(), "app.log")
    
    # 需要写文件时，补一个文件处理器
    if log_file:
        # 先确保日志目录存在
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        
        file_handler = logging.FileHandler(log_file, mode='a', encoding='utf-8')
        file_handler.setFormatter(
            logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        )
        handlers.append(file_handler)
    
    # 同时保留控制台输出，桌面端会再做重定向
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(
        logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    )
    handlers.append(console_handler)
    
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=handlers
    )


def get_logger(name):
    """按名称获取 logger。"""
    return logging.getLogger(name)
