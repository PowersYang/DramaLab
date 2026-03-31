"""
存储 provider。

当前只封装 OSS 上传与对象键判断，避免 workflow 直接依赖具体工具模块。
"""

from ..utils.oss_utils import OSSImageUploader, is_object_key


class StorageProvider:
    """围绕对象存储工具的一层轻量门面。"""

    def __init__(self):
        self._uploader = OSSImageUploader()

    def is_object_key(self, value: str) -> bool:
        """判断一个字符串是否看起来像对象存储键。"""
        return is_object_key(value)

    def upload_image(self, path: str):
        """按默认图片上传策略上传文件。"""
        return self._uploader.upload_image(path)

    def upload_file(self, path: str, sub_path: str):
        """按给定逻辑子路径上传通用文件。"""
        return self._uploader.upload_file(path, sub_path=sub_path)

    def download_file(self, source: str, local_path: str) -> bool:
        """把 OSS 对象键或远程 URL 下载到本地临时文件。"""
        return self._uploader.download_file(source, local_path)

    @property
    def is_configured(self) -> bool:
        """暴露底层存储客户端是否已完成配置。"""
        return self._uploader.is_configured
