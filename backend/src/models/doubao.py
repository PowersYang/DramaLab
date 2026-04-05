import time
import logging
import base64
import os
from typing import Tuple

import requests

from .base import VideoGenModel
from ..application.services.model_provider_service import ModelProviderService

# 尝试加载 Ark SDK；若环境未安装则延后在运行时报错
try:
    from volcenginesdkarkruntime import Ark
except ImportError:
    Ark = None

logger = logging.getLogger(__name__)

class DoubaoModel(VideoGenModel):
    def __init__(self, config: dict):
        super().__init__(config)
        service = ModelProviderService()
        provider = service.get_provider_config("ARK")
        self.api_key = service.get_provider_credential("ARK", "api_key")
        self.model_name = config.get('params', {}).get('model_name', provider.settings_json.get('default_video_model', 'doubao-seedance-1-0-pro-fast-251015'))
        
        if not self.api_key:
            logger.warning("平台模型配置缺少 ARK 凭证")
            
        if Ark:
            self.client = Ark(
                base_url=service.get_provider_base_url("ARK"),
                api_key=self.api_key
            )
        else:
            self.client = None
            logger.error("未安装 volcenginesdkarkruntime，无法调用 ARK 客户端")

    def _encode_image_to_base64(self, image_path: str) -> str:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        """通过 Ark SDK 调用豆包视频模型生成视频。"""
        if not self.client:
            raise RuntimeError("Ark client not initialized. Please install volcenginesdkarkruntime.")

        img_url = kwargs.get('img_url')
        if not img_url:
            raise ValueError("Doubao SeeDance model requires an input image (img_url).")

        # 兼容 `file://` 前缀的本地图片地址
        if img_url.startswith("file://"):
            local_path = img_url[7:]
            # 本地文件转成 base64 data URL 传给接口
            base64_image = self._encode_image_to_base64(local_path)
            # 根据扩展名推断 MIME 类型
            ext = os.path.splitext(local_path)[1].lower()
            mime_type = "image/png" if ext == ".png" else "image/jpeg"
            final_image_url = f"data:{mime_type};base64,{base64_image}"
        else:
            final_image_url = img_url

        logger.info("正在调用豆包模型生成视频：模型=%s 提示词=%s", self.model_name, prompt)
        start_time = time.time()

        try:
            # 先创建异步任务
            create_result = self.client.content_generation.tasks.create(
                model=self.model_name,
                content=[
                    {
                        "type": "text",
                        "text": f"{prompt} --resolution 720p --duration 5 --camerafixed false --watermark false"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": final_image_url
                        }
                    }
                ]
            )
            
            task_id = create_result.id
            logger.info("豆包任务编号=%s", task_id)

            # 轮询等待结果
            while True:
                get_result = self.client.content_generation.tasks.get(task_id=task_id)
                status = get_result.status
                
                if status == "succeeded":
                    logger.info("豆包任务已成功完成")
                    # 从返回结果里取出视频地址
                    video_url = None
                    if hasattr(get_result, 'content') and get_result.content:
                        if hasattr(get_result.content, 'video_url'):
                            video_url = get_result.content.video_url
                    
                    if not video_url:
                        logger.warning("无法从返回结果解析视频链接：%s", get_result)
                        raise ValueError("No video URL found in response")

                    # 拉取成品视频到本地
                    self._download_video(video_url, output_path)
                    break
                    
                elif status == "failed":
                    logger.error("豆包任务失败：%s", get_result.error)
                    raise RuntimeError(f"Doubao generation failed: {get_result.error}")
                else:
                    time.sleep(2)
                    
        except Exception as e:
            logger.error("调用豆包接口失败：%s", e)
            raise

        api_duration = time.time() - start_time
        return output_path, api_duration

    def _download_video(self, url: str, output_path: str):
        logger.info("正在下载视频：来源=%s 目标=%s", url, output_path)
        response = requests.get(url, stream=True)
        response.raise_for_status()
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info("下载完成")
