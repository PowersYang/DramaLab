"""临时媒资文件工具。

所有需要本地文件句柄的链路只允许使用临时文件，
禁止再把业务产物持久化到仓库工作目录。
"""

import os
import shutil
import tempfile
from contextlib import contextmanager
from typing import BinaryIO, Iterator


def suffix_from_filename(filename: str | None, default: str = "") -> str:
    """从文件名中提取扩展名，缺失时回退到默认值。"""
    if not filename:
        return default
    suffix = os.path.splitext(filename)[1]
    return suffix or default


def create_temp_file_path(*, prefix: str = "dramalab-", suffix: str = "") -> str:
    """创建一个可复用的临时文件路径，并立即释放文件句柄。"""
    fd, path = tempfile.mkstemp(prefix=prefix, suffix=suffix)
    os.close(fd)
    return path


def remove_temp_file(path: str | None) -> None:
    """安全删除临时文件；不存在时静默跳过。"""
    if not path:
        return
    try:
        if os.path.exists(path):
            os.remove(path)
    except FileNotFoundError:
        return


@contextmanager
def staged_upload_file(file_obj: BinaryIO, filename: str | None, *, prefix: str = "dramalab-upload-") -> Iterator[str]:
    """把上传流先写入临时文件，供后续 OSS 上传或模型调用复用。"""
    temp_path = create_temp_file_path(prefix=prefix, suffix=suffix_from_filename(filename))
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file_obj, buffer)
        yield temp_path
    finally:
        remove_temp_file(temp_path)
