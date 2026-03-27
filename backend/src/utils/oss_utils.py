import os
import oss2
import time
import requests
from typing import Optional
from src.common.log import get_logger
from src.settings.env_settings import get_env

logger = get_logger(__name__)

# OSS 相关默认配置
DEFAULT_OSS_BASE_PATH = "lumenx"
SIGN_URL_EXPIRES_DISPLAY = 7200  # 前端展示用，默认 2 小时
SIGN_URL_EXPIRES_API = 1800      # AI 接口调用用，默认 30 分钟


def is_oss_configured() -> bool:
    """检查 OSS 基础配置是否齐全。"""
    required = [
        get_env("ALIBABA_CLOUD_ACCESS_KEY_ID"),
        get_env("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
        get_env("OSS_ENDPOINT"),
        get_env("OSS_BUCKET_NAME")
    ]
    return all(required)


def get_oss_base_path() -> str:
    """读取 OSS 根路径；未配置时使用默认值。"""
    return get_env("OSS_BASE_PATH", DEFAULT_OSS_BASE_PATH).rstrip("/")


def is_object_key(value: str) -> bool:
    """判断一个字符串是否为 OSS 对象键，而不是完整 URL 或本地路径。"""
    if not value or not isinstance(value, str):
        return False
    # 完整 URL 一定不是对象键
    if value.startswith(("http://", "https://", "blob:", "data:")):
        return False
    # 空串或纯空白直接排除
    if not value.strip():
        return False
    
    # 常见本地相对路径前缀直接排除，避免误把本地文件当成对象键去签名
    local_prefixes = (
        "assets/", "storyboard/", "video/", "audio/", "export/", "uploads/", "output/", "outputs/",
        "/assets/", "/storyboard/", "/video/", "/audio/", "/export/", "/uploads/", "/output/", "/outputs/"
    )
    if value.startswith(local_prefixes):
        return False
    
    # 根路径做一次清洗，避免用户配置里混入引号和多余斜杠
    base_path = get_oss_base_path().strip("'\"/")
    
    # 对象键必须以 OSS 根路径开头，例如 `lumenx/...`
    # 这里不要再加“模糊兜底”，否则很容易误判本地路径
    return value.startswith(f"{base_path}/")









def is_local_path(value: str) -> bool:
    """判断字符串是否像本地文件路径。"""
    if not value or not isinstance(value, str):
        return False
    if value.startswith("http://") or value.startswith("https://"):
        return False
    # 常见相对路径前缀直接视为本地路径
    return value.startswith(("assets/", "storyboard/", "video/", "audio/", "export/", "uploads/", "output/"))


class OSSImageUploader:
    """
    OSS 上传器，采用“私有 OSS + 动态签名”策略。

    核心原则：
    - 上传后只保存对象键，不直接保存完整 URL
    - 需要访问时再按场景动态生成签名地址
    - 同时兼容前端展示和 AI 接口调用
    """
    
    _instance = None
    
    def __new__(cls):
        """单例复用 OSS 连接，避免重复初始化。"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
            cls._instance._url_cache = {}  # (object_key, expires) -> (signed_url, timestamp)
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
            
        self.access_key_id = get_env("ALIBABA_CLOUD_ACCESS_KEY_ID")
        self.access_key_secret = get_env("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
        self.endpoint = get_env("OSS_ENDPOINT")
        self.bucket_name = get_env("OSS_BUCKET_NAME")
        self.base_path = get_oss_base_path()
        
        # 启动时把关键状态打印出来，便于桌面端排查配置问题
        print(f"DEBUG: OSS init - ID={'***' if self.access_key_id else 'None'}, Secret={'***' if self.access_key_secret else 'None'}, Endpoint={self.endpoint}, Bucket={self.bucket_name}, Base={self.base_path}")
        
        if not all([self.access_key_id, self.access_key_secret, self.endpoint, self.bucket_name]):
            logger.warning("OSS credentials not fully configured. OSS upload will be disabled.")
            print("DEBUG: OSS init - FAILED: missing credentials")
            self.bucket = None
        else:
            try:
                self.auth = oss2.Auth(self.access_key_id, self.access_key_secret)
                # 把连接超时压短，避免网络异常时长时间卡死
                self.bucket = oss2.Bucket(
                    self.auth, 
                    self.endpoint, 
                    self.bucket_name,
                    connect_timeout=5  # 5 seconds connection timeout
                )
                logger.info(f"OSS initialized: bucket={self.bucket_name}, base_path={self.base_path}")
                print(f"DEBUG: OSS init - SUCCESS: bucket={self.bucket_name}")
            except Exception as e:
                logger.error(f"Failed to initialize OSS bucket: {e}")
                print(f"DEBUG: OSS init - ERROR: {e}")
                self.bucket = None
        
        self._initialized = True

    
    @classmethod
    def reset_instance(cls):
        """重置单例，适合在凭证变更后强制重新初始化。"""
        cls._instance = None
    
    @property
    def is_configured(self) -> bool:
        """检查 OSS 是否已初始化完成并可用。"""
        return self.bucket is not None
    
    def _build_object_key(self, sub_path: str, filename: str) -> str:
        """按根路径、子路径和文件名拼出完整对象键。"""
        parts = [self.base_path]
        if sub_path:
            parts.append(sub_path.strip("/"))
        parts.append(filename)
        return "/".join(parts)
    
    def upload_file(self, local_path: str, sub_path: str = "", custom_filename: str = None) -> Optional[str]:
        """上传文件到 OSS，并返回对象键。"""
        if not self.bucket:
            logger.warning("OSS not configured, cannot upload file.")
            return None
        
        if not os.path.exists(local_path):
            logger.error(f"File not found: {local_path}")
            return None
        
        try:
            filename = custom_filename or os.path.basename(local_path)
            object_key = self._build_object_key(sub_path, filename)
            
            logger.info(f"Uploading to OSS: {local_path} -> {object_key}")
            
            with open(local_path, 'rb') as f:
                result = self.bucket.put_object(object_key, f)
            
            if result.status == 200:
                logger.info(f"Upload success: {object_key}")
                return object_key
            else:
                logger.error(f"Upload failed with status: {result.status}")
                return None
                
        except Exception as e:
            logger.error(f"OSS upload error: {e}")
            return None
    
    def generate_signed_url(self, object_key: str, expires: int = SIGN_URL_EXPIRES_DISPLAY) -> str:
        """为私有 OSS 对象生成带时效的签名地址。"""
        if not self.bucket:
            logger.warning("OSS not configured, cannot generate signed URL.")
            return ""
        
        try:
            # 如果缓存里的签名地址还足够新，就直接复用
            cache_key = (object_key, expires)
            now = time.time()
            if cache_key in self._url_cache:
                cached_url, timestamp = self._url_cache[cache_key]
                # 至少还剩 10 分钟有效期时继续复用
                if now - timestamp < (expires - 600):
                    return cached_url

            url = self.bucket.sign_url('GET', object_key, expires, slash_safe=True)

            # 统一升级成 HTTPS，部分 AI 接口只接受 HTTPS 资源地址
            if url.startswith("http://"):
                url = "https://" + url[7:]

            # 更新缓存
            self._url_cache[cache_key] = (url, now)
            return url
        except Exception as e:
            logger.error(f"Failed to generate signed URL for {object_key}: {e}")
            return ""
    
    def sign_url_for_display(self, object_key: str) -> str:
        """生成给前端展示用的签名地址。"""
        signed_url = self.generate_signed_url(object_key, SIGN_URL_EXPIRES_DISPLAY)
        # print(f"DEBUG: sign_url_for_display('{object_key}') -> '{signed_url}'")
        return signed_url


    
    def sign_url_for_api(self, object_key: str) -> str:
        """生成给 AI 接口调用用的签名地址。"""
        return self.generate_signed_url(object_key, SIGN_URL_EXPIRES_API)
    
    def object_exists(self, object_key: str) -> bool:
        """检查对象是否存在于 OSS。"""
        if not self.bucket:
            return False
        try:
            return self.bucket.object_exists(object_key)
        except:
            return False

    def download_file(self, source: str, local_path: str) -> bool:
        """
        把 OSS 对象或远程 URL 落成本地文件。

        仅用于 FFmpeg、导出等仍必须依赖本地路径的运行时环节。
        """
        if not source:
            return False

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        try:
            if is_object_key(source):
                if not self.bucket:
                    logger.warning("OSS not configured, cannot download object: %s", source)
                    return False
                self.bucket.get_object_to_file(source, local_path)
                return True

            if source.startswith(("http://", "https://")):
                response = requests.get(source, stream=True, timeout=60)
                response.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                return True
        except Exception as e:
            logger.error(f"Failed to download source {source} to {local_path}: {e}")

        return False
    
    # 兼容旧调用方式的包装方法
    def upload_image(self, local_image_path: str, sub_path: str = "assets") -> Optional[str]:
        """兼容旧接口：上传图片并返回对象键。"""
        return self.upload_file(local_image_path, sub_path)
    
    def upload_video(self, local_video_path: str, sub_path: str = "video") -> Optional[str]:
        """兼容旧接口：上传视频并返回对象键。"""
        return self.upload_file(local_video_path, sub_path)
    
    def get_oss_url(self, object_key: str, use_public_url: bool = False) -> str:
        """
        兼容旧接口：获取 OSS 地址。

        在当前私有 OSS 策略下，始终返回签名地址；
        `use_public_url` 仅为兼容保留，已不建议使用。
        """
        if use_public_url:
            logger.warning("Public URLs are deprecated. Using signed URL instead for security.")
        return self.sign_url_for_display(object_key)


def sign_oss_urls_in_data(data, uploader: OSSImageUploader = None):
    """
    递归遍历数据结构，把其中的 OSS 对象键替换成签名地址。

    这是“动态签名”方案的核心入口，通常在 API 返回前统一调用。
    """
    if uploader is None:
        uploader = OSSImageUploader()
    
    if not uploader.is_configured:
        # 没配 OSS 时保持原样返回，本地模式不做处理
        return data
    
    def process_value(value):
        if isinstance(value, str):
            if is_object_key(value):
                signed_url = uploader.sign_url_for_display(value)
                return signed_url if signed_url else value
            return value
        elif isinstance(value, dict):
            return {k: process_value(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [process_value(item) for item in value]
        else:
            return value
    
    return process_value(data)


def convert_local_path_to_object_key(local_path: str, project_id: str = None) -> str:
    """把本地相对路径转换成标准 OSS 对象键格式。"""
    base_path = get_oss_base_path()
    
    # 如果路径里带了 output/ 前缀，先裁掉
    if local_path.startswith("output/"):
        local_path = local_path[7:]
    
    # 按是否带项目 ID 拼出最终对象键
    if project_id:
        return f"{base_path}/{project_id}/{local_path}"
    else:
        return f"{base_path}/{local_path}"
