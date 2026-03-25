import logging
import os

from dotenv import load_dotenv

from ..utils import setup_logging


def bootstrap_api_environment(logger: logging.Logger) -> None:
    """初始化 API 运行时环境。"""
    setup_logging()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(project_root, ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path, override=True)

    logger.info(
        "STARTUP: OSS_ENDPOINT=%s, OSS_BUCKET_NAME=%s, OSS_BASE_PATH=%s",
        os.getenv("OSS_ENDPOINT"),
        os.getenv("OSS_BUCKET_NAME"),
        os.getenv("OSS_BASE_PATH"),
    )

    os.makedirs("output", exist_ok=True)
    os.makedirs("output/uploads", exist_ok=True)
    os.makedirs("output/video", exist_ok=True)
    os.makedirs("output/assets", exist_ok=True)
