import os

from .oss_utils import is_object_key


def resolve_reference_image_input(reference_url: str | None) -> str | None:
    """把参考图统一归一化成模型层可消费的输入。"""
    # 中文注释：这里只接受三类来源：
    # 1. OSS 对象键
    # 2. 可直接访问的 HTTP(S) URL
    # 3. 运行时显式传入、当前进程确实可访问的本地临时文件
    if not reference_url:
        return None
    if reference_url.startswith("http"):
        return reference_url
    if is_object_key(reference_url):
        return reference_url
    if os.path.exists(reference_url):
        return reference_url
    return None
