import os
from typing import Dict, Any
from backend.src.schema.models import StoryboardFrame, GenerationStatus
from ..models.wanx import WanxModel
from ..utils import get_logger

logger = get_logger(__name__)

class VideoGenerator:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxModel(self.config.get('model', {}))
        self.output_dir = self.config.get('output_dir', 'output/video')

    def generate_i2v(self, image_url: str, prompt: str, duration: int = 5, audio_url: str = None) -> Dict[str, Any]:
        """根据输入图片生成动作参考视频。"""
        import uuid
        
        logger.info(f"Generating I2V motion reference: prompt={prompt[:50]}..., duration={duration}")
        
        # 本地图片路径要先解析出来，后续由模型层决定是否上传
        img_path = None
        if image_url and not image_url.startswith("http"):
            potential_path = os.path.join("output", image_url)
            if os.path.exists(potential_path):
                img_path = os.path.abspath(potential_path)
            elif os.path.exists(image_url):
                img_path = image_url
        
        try:
            output_filename = f"motion_ref_{uuid.uuid4().hex[:8]}.mp4"
            output_path = os.path.join(self.output_dir, output_filename)
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            video_path, _ = self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path,
                img_url=image_url if not img_path else None
            )
            
            # 如果启用了 OSS，就把结果视频上传并保存对象键
            video_url = os.path.relpath(output_path, "output")
            try:
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    object_key = uploader.upload_file(output_path, sub_path="motion_ref")
                    if object_key:
                        logger.info(f"Uploaded motion ref video to OSS: {object_key}")
                        video_url = object_key
            except Exception as e:
                logger.error(f"Failed to upload motion ref to OSS: {e}")
            
            return {"video_url": video_url}
            
        except Exception as e:
            logger.error(f"Failed to generate I2V motion reference: {e}")
            raise

    def generate_clip(self, frame: StoryboardFrame) -> StoryboardFrame:
        """根据分镜帧生成视频片段。"""
        if not frame.image_url:
            logger.error(f"Frame {frame.id} has no image URL. Cannot generate video.")
            frame.status = GenerationStatus.FAILED
            return frame
            
        frame.status = GenerationStatus.PROCESSING
        
        # 优先使用视频提示词，没有就回退到图片提示词或动作描述
        prompt = frame.video_prompt or frame.image_prompt or frame.action_description
        
        # 如果是本地路径，这里只负责解析出来；
        # 真正上传到可访问地址的动作交给底层模型适配层处理
        
        img_url = frame.image_url
        img_path = None
        
        # 尝试把相对路径还原成本地文件路径
        if img_url and not img_url.startswith("http"):
             # 项目里大多数图片路径都相对于 output 目录
             potential_path = os.path.join("output", img_url)
             if os.path.exists(potential_path):
                 img_path = os.path.abspath(potential_path)
             else:
                 # 兜底兼容绝对路径或其他已可访问路径
                 if os.path.exists(img_url):
                     img_path = img_url
        
        try:
            output_path = os.path.join(self.output_dir, f"{frame.id}.mp4")
            
            video_path, _ = self.model.generate(
                prompt=prompt,
                output_path=output_path,
                img_path=img_path,  # 本地路径交给模型层处理上传
                img_url=img_url if not img_path else None  # 远程地址则直接透传
            )
            
            # 保存相对路径，供前端统一访问
            rel_path = os.path.relpath(output_path, "output")
            frame.video_url = rel_path
            frame.status = GenerationStatus.COMPLETED
            
            # 如果启用了 OSS，就把结果视频上传并保存对象键
            try:
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    object_key = uploader.upload_file(output_path, sub_path="video")
                    if object_key:
                        logger.info(f"Uploaded video for frame {frame.id} to OSS: {object_key}")
                        # 实际返回给前端时再统一转成签名地址
                        frame.video_url = object_key
            except Exception as e:
                logger.error(f"Failed to upload video for frame {frame.id} to OSS: {e}")
                # OSS 上传失败不影响本地结果
        except Exception as e:
            logger.error(f"Failed to generate video for frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            
        return frame
