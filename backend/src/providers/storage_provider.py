"""
存储 provider。

当前只封装 OSS 上传与对象键判断，避免 workflow 直接依赖具体工具模块。
"""

from ..utils.oss_utils import OSSImageUploader, is_object_key


class StorageProvider:
    def __init__(self):
        self._uploader = OSSImageUploader()

    def is_object_key(self, value: str) -> bool:
        return is_object_key(value)

    def upload_image(self, path: str):
        return self._uploader.upload_image(path)

    def upload_file(self, path: str, sub_path: str):
        return self._uploader.upload_file(path, sub_path=sub_path)

    @property
    def is_configured(self) -> bool:
        return self._uploader.is_configured
