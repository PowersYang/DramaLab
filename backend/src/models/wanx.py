import os
import time
from http import HTTPStatus
from typing import Tuple

import requests
from dashscope import VideoSynthesis
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

from .base import VideoGenModel
from ..application.services.model_provider_service import ModelProviderService
from ..utils import get_logger
from ..utils.endpoints import get_provider_base_url

from ..utils.oss_utils import OSSImageUploader, is_object_key

logger = get_logger(__name__)


class WanxModel(VideoGenModel):
    def __init__(self, config):
        super().__init__(config)

        self.params = config.get('params', {})

    @property
    def api_key(self):
        api_key = ModelProviderService().get_provider_credential("DASHSCOPE", "api_key")
        if not api_key:
            logger.warning("Dashscope API Key not configured in provider management.")
        return api_key

    def generate(self, prompt: str, output_path: str, img_path: str = None, model_name: str = None, **kwargs) ->Tuple[str, float]:
        # 统一决定最终要调用的模型，兼容显式参数和 kwargs 两种传法
        # 调用链里有时会传 `model=task.model`，这里一并兼容
        if model_name:
            final_model_name = model_name
        elif kwargs.get('model'):
            final_model_name = kwargs.get('model')
            logger.info(f"Using model from kwargs: {final_model_name}")
        elif img_path or kwargs.get('img_url'):
            final_model_name = self.params.get('i2v_model_name', 'wan2.6-i2v')  # 默认走图生视频模型
            logger.info(f"Using I2V model: {final_model_name}")
        else:
            final_model_name = self.params.get('model_name', 'wan2.5-t2v-preview')
            logger.info(f"Using T2V model: {final_model_name}")

        size = self.params.get('size', '1280*720')
        prompt_extend = self.params.get('prompt_extend', True)
        watermark = self.params.get('watermark', False)

        # 新参数优先读取调用时传入的 kwargs，没有再回退到全局配置
        duration = kwargs.get('duration') or self.params.get('duration', 5)
        negative_prompt = kwargs.get('negative_prompt') or self.params.get('negative_prompt', '')
        audio_url = kwargs.get('audio_url') or self.params.get('audio_url', '')
        seed = kwargs.get('seed') or self.params.get('seed')

        # 分辨率先统一成 API 需要的大写格式，再映射到具体尺寸
        resolution = kwargs.get('resolution') or self.params.get('resolution', '720P')
        resolution = resolution.upper()  # API 要求使用大写（如 720P、1080P）
        if resolution == '1080P':
            size = "1920*1080"
        elif resolution == '480P':
            size = "832*480"
        else:
            size = "1280*720"

        # 运动相关附加参数
        camera_motion = kwargs.get('camera_motion')
        subject_motion = kwargs.get('subject_motion')

        logger.info(f"Starting generation with model: {final_model_name}")
        logger.info(f"Prompt: {prompt}")

        try:
            api_start_time = time.time()

            # 把输入图片统一整理成模型可访问的 URL
            # 本地文件需要先传 OSS，对象键需要先签名
            img_url = kwargs.get('img_url')
            uploader = OSSImageUploader()
            
            if img_path:
                if os.path.exists(img_path):
                    # 本地文件先上传到 OSS，再换成带签名的访问地址
                    if uploader.is_configured:
                        logger.info(f"Uploading input image to OSS: {img_path}")
                        object_key = uploader.upload_file(img_path, sub_path="temp/i2v_input")
                        if object_key:
                            img_url = uploader.sign_url_for_api(object_key)
                            logger.info(f"Input image uploaded, signed URL: {img_url[:80]}...")
                        else:
                            raise RuntimeError("Failed to upload input image to OSS")
                    else:
                        raise RuntimeError("OSS not configured, cannot upload input image for I2V")
                elif img_path.startswith("http"):
                    # 传进来的本身就是可访问链接
                    img_url = img_path
                elif "/" in img_path and not img_path.startswith("output/"):
                    # 看起来像 OSS 对象键，需要补签名
                    if uploader.is_configured:
                        img_url = uploader.sign_url_for_api(img_path)
                        logger.info(f"Input image (Object Key from img_path), signed URL: {img_url[:80]}...")
                    else:
                        raise RuntimeError(f"OSS not configured, cannot sign Object Key: {img_path}")
                else:
                    raise ValueError(f"Input image not found: {img_path}")
            elif img_url:
                # 有 img_url 但没有 img_path 时，也要兼容对象键形式
                if is_object_key(img_url):
                    if uploader.is_configured:
                        img_url = uploader.sign_url_for_api(img_url)
                        logger.info(f"Input image (Object Key from img_url), signed URL: {img_url[:80]}...")
                    else:
                        logger.warning(f"OSS not configured, cannot sign Object Key in img_url: {img_url}")

            # 音频输入也统一整理成模型可访问的 URL
            if audio_url:
                local_audio_path = None
                if os.path.exists(audio_url):
                    local_audio_path = audio_url
                elif not audio_url.startswith("http"):
                    potential_path = os.path.join("output", audio_url)
                    if os.path.exists(potential_path):
                        local_audio_path = potential_path

                if local_audio_path:
                    if uploader.is_configured:
                        object_key = uploader.upload_file(local_audio_path, sub_path="temp/audio_input")
                        if object_key:
                            audio_url = uploader.sign_url_for_api(object_key)
                            logger.info(f"Input audio uploaded, signed URL: {audio_url[:80]}...")
                        else:
                            raise RuntimeError("Failed to upload input audio to OSS")
                    else:
                        raise RuntimeError("OSS not configured, cannot upload input audio for I2V")
                elif is_object_key(audio_url):
                    if uploader.is_configured:
                        audio_url = uploader.sign_url_for_api(audio_url)
                        logger.info(f"Input audio (Object Key), signed URL: {audio_url[:80]}...")
                    else:
                        logger.warning(f"OSS not configured, cannot sign Object Key in audio_url: {audio_url}")

            # 新版 Wan 模型走 HTTP 接口，旧型号继续走 SDK
            if final_model_name in ['wan2.6-i2v', 'wan2.6-i2v-flash', 'wan2.5-i2v']:
                # `shot_type` 只对 Wan 的 I2V 系列模型生效
                shot_type = kwargs.get('shot_type', 'single')
                video_url = self._generate_wan_i2v_http(
                    prompt=prompt,
                    img_url=img_url,
                    model_name=final_model_name,
                    resolution=resolution,
                    duration=duration,
                    prompt_extend=prompt_extend,
                    negative_prompt=negative_prompt,
                    audio_url=audio_url,
                    watermark=watermark,
                    seed=seed,
                    shot_type=shot_type
                )
            elif final_model_name == 'wan2.6-r2v':
                # 参考视频生视频流程
                ref_video_urls = kwargs.get('ref_video_urls', [])
                if not ref_video_urls:
                    raise ValueError("ref_video_urls is required for wan2.6-r2v")
                
                # 把参考视频统一整理成模型可访问的 URL
                processed_ref_urls = []
                for ref_url in ref_video_urls:
                    final_url = ref_url
                    
                    # 先判断是不是本地文件
                    local_path = None
                    if not ref_url.startswith("http"):
                        # 先按 output 下的相对路径查
                        potential_path = os.path.join("output", ref_url)
                        if os.path.exists(potential_path):
                            local_path = potential_path
                        # 再查绝对路径或当前工作目录相对路径
                        elif os.path.exists(ref_url):
                            local_path = ref_url
                    
                    if local_path:
                        # 本地文件先上传 OSS
                        if uploader.is_configured:
                            logger.info(f"Uploading reference video to OSS: {local_path}")
                            object_key = uploader.upload_file(local_path, sub_path="temp/r2v_input")
                            if object_key:
                                final_url = uploader.sign_url_for_api(object_key)
                                logger.info(f"Reference video uploaded, signed URL: {final_url[:80]}...")
                            else:
                                raise RuntimeError(f"Failed to upload reference video: {local_path}")
                        else:
                            raise RuntimeError("OSS not configured, cannot upload local reference video for R2V")
                    
                    elif not ref_url.startswith("http") and "/" in ref_url and not ref_url.startswith("output/"):
                        # 大概率是 OSS 对象键
                        if uploader.is_configured:
                            final_url = uploader.sign_url_for_api(ref_url)
                            logger.info(f"Reference video (Object Key), signed URL: {final_url[:80]}...")
                        else:
                            logger.warning(f"OSS not configured, cannot sign Object Key: {ref_url}")
                            
                    processed_ref_urls.append(final_url)
                
                ref_video_urls = processed_ref_urls
                
                shot_type = kwargs.get('shot_type', 'multi')  # 按产品约定，R2V 默认多镜头
                
                video_url = self._generate_wan_r2v_http(
                    prompt=prompt,
                    ref_video_urls=ref_video_urls,
                    model_name=final_model_name,
                    size=size,  # R2V 走尺寸参数（如 1280*720）
                    duration=duration,
                    audio=kwargs.get('audio', True),  # R2V 默认带音频
                    shot_type=shot_type,
                    seed=seed
                )
            else:
                # 其他旧模型仍然沿用 Dashscope SDK
                video_url = self._generate_sdk(
                    prompt=prompt,
                    model_name=final_model_name,
                    img_url=img_url,
                    size=size,
                    duration=duration,
                    prompt_extend=prompt_extend,
                    negative_prompt=negative_prompt,
                    audio_url=audio_url,
                    watermark=watermark,
                    seed=seed,
                    camera_motion=camera_motion,
                    subject_motion=subject_motion
                )

            api_end_time = time.time()
            api_duration = api_end_time - api_start_time

            logger.info(f"Generation success. Video URL: {video_url}")
            logger.info(f"API duration: {api_duration:.2f}s")

            # 拉取远端视频并落到本地输出路径
            self._download_video(video_url, output_path)
            return output_path, api_duration

        except Exception as e:
            logger.error(f"Error during generation: {e}")
            raise

    def _generate_wan_i2v_http(self, prompt: str, img_url: str, model_name: str = "wan2.6-i2v",
                                  resolution: str = "720P", 
                                  duration: int = 5, prompt_extend: bool = True,
                                  negative_prompt: str = None, audio_url: str = None,
                                  watermark: bool = False, seed: int = None,
                                  shot_type: str = "single") -> str:
        """通过 HTTP 接口调用 Wan I2V（2.5/2.6）生成视频，并轮询任务结果。"""
        base = get_provider_base_url("DASHSCOPE")
        create_url = f"{base}/api/v1/services/aigc/video-generation/video-synthesis"
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable"  # 开启异步任务模式
        }
        
        payload = {
            "model": model_name,  # 直接使用外部传入的模型名
            "input": {
                "prompt": prompt,
                "img_url": img_url
            },
            "parameters": {
                "resolution": resolution,
                "duration": duration,
                "prompt_extend": prompt_extend,
                "watermark": watermark,
                "audio": True,  # 默认自动生成音频
                "shot_type": shot_type  # single / multi，仅在 prompt_extend=True 时生效
            }
        }
        
        # 按需补充可选参数
        if negative_prompt:
            payload["input"]["negative_prompt"] = negative_prompt
        if audio_url:
            payload["input"]["audio_url"] = audio_url
            del payload["parameters"]["audio"]  # audio_url takes precedence
        if seed:
            payload["parameters"]["seed"] = seed
        
        logger.info(f"Calling {model_name} HTTP API (async)...")
        logger.info(f"Payload: {payload}")
        
        # 第一步：提交异步任务
        response = requests.post(create_url, headers=headers, json=payload, timeout=120)  # 2 minutes for task creation
        
        logger.info(f"Create task response status: {response.status_code}")
        logger.info(f"Create task response body: {response.text[:500] if response.text else 'empty'}")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"{model_name} task creation failed: {error_msg}")
        
        result = response.json()
        task_id = result.get('output', {}).get('task_id')
        if not task_id:
            raise RuntimeError(f"No task_id in response: {result}")
        
        logger.info(f"Task created: {task_id}")
        
        # 第二步：轮询任务状态直到完成
        poll_url = f"{base}/api/v1/tasks/{task_id}"
        poll_headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        max_wait_time = 900  # 15 minutes max wait (video generation takes longer)
        poll_interval = 15   # Poll every 15 seconds
        elapsed = 0
        
        while elapsed < max_wait_time:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            poll_response = requests.get(poll_url, headers=poll_headers, timeout=30)
            
            if poll_response.status_code != 200:
                logger.warning(f"Poll request failed: {poll_response.status_code}")
                continue
            
            poll_result = poll_response.json()
            task_status = poll_result.get('output', {}).get('task_status')
            
            logger.info(f"Task {task_id} status: {task_status} (elapsed: {elapsed}s)")
            
            if task_status == 'SUCCEEDED':
                video_url = poll_result.get('output', {}).get('video_url')
                if not video_url:
                    raise RuntimeError(f"No video_url in completed task: {poll_result}")
                
                logger.info(f"Task completed. Video URL: {video_url}")
                return video_url
            
            elif task_status == 'FAILED':
                error_msg = poll_result.get('output', {}).get('message', 'Unknown error')
                code = poll_result.get('output', {}).get('code', '')
                raise RuntimeError(f"{model_name} task failed: {code} - {error_msg}")
            
            elif task_status in ['CANCELED', 'UNKNOWN']:
                raise RuntimeError(f"{model_name} task {task_status}: {poll_result}")
            
            # 任务还在排队或执行中，继续轮询
        
        raise RuntimeError(f"{model_name} task timed out after {max_wait_time}s")

    def _generate_wan_r2v_http(self, prompt: str, ref_video_urls: list, model_name: str = "wan2.6-r2v",
                                  size: str = "1280*720", 
                                  duration: int = 5, audio: bool = True,
                                  shot_type: str = "multi", seed: int = None) -> str:
        """通过 HTTP 接口调用 Wan R2V 生成视频，并轮询任务结果。"""
        base = get_provider_base_url("DASHSCOPE")
        create_url = f"{base}/api/v1/services/aigc/video-generation/video-synthesis"
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable"
        }
        
        payload = {
            "model": model_name,
            "input": {
                "prompt": prompt,
                "reference_video_urls": ref_video_urls
            },
            "parameters": {
                "size": size,
                "duration": duration,
                "audio": audio,
                "shot_type": shot_type
            }
        }
        
        if seed:
            payload["parameters"]["seed"] = seed
        
        logger.info(f"Calling {model_name} HTTP API (async)...")
        logger.info(f"Payload: {payload}")
        
        # 第一步：提交异步任务
        response = requests.post(create_url, headers=headers, json=payload, timeout=120)
        
        logger.info(f"Create task response status: {response.status_code}")
        logger.info(f"Create task response body: {response.text[:500] if response.text else 'empty'}")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"{model_name} task creation failed: {error_msg}")
        
        result = response.json()
        task_id = result.get('output', {}).get('task_id')
        if not task_id:
            raise RuntimeError(f"No task_id in response: {result}")
        
        logger.info(f"Task created: {task_id}")
        
        # 第二步：轮询任务状态直到完成
        poll_url = f"{base}/api/v1/tasks/{task_id}"
        poll_headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        max_wait_time = 900  # 15 minutes max wait
        poll_interval = 15   # Poll every 15 seconds
        elapsed = 0
        
        while elapsed < max_wait_time:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            poll_response = requests.get(poll_url, headers=poll_headers, timeout=30)
            
            if poll_response.status_code != 200:
                logger.warning(f"Poll request failed: {poll_response.status_code}")
                continue
            
            poll_result = poll_response.json()
            task_status = poll_result.get('output', {}).get('task_status')
            
            logger.info(f"Task {task_id} status: {task_status} (elapsed: {elapsed}s)")
            
            if task_status == 'SUCCEEDED':
                video_url = poll_result.get('output', {}).get('video_url')
                if not video_url:
                    raise RuntimeError(f"No video_url in completed task: {poll_result}")
                
                logger.info(f"Task completed. Video URL: {video_url}")
                return video_url
            
            elif task_status == 'FAILED':
                error_msg = poll_result.get('output', {}).get('message', 'Unknown error')
                code = poll_result.get('output', {}).get('code', '')
                raise RuntimeError(f"{model_name} task failed: {code} - {error_msg}")
            
            elif task_status in ['CANCELED', 'UNKNOWN']:
                raise RuntimeError(f"{model_name} task {task_status}: {poll_result}")
            
        raise RuntimeError(f"{model_name} task timed out after {max_wait_time}s")

    def _generate_sdk(self, prompt: str, model_name: str, img_url: str = None, size: str = "1280*720",
                      duration: int = 5, prompt_extend: bool = True, negative_prompt: str = None,
                      audio_url: str = None, watermark: bool = False, seed: int = None,
                      camera_motion: str = None, subject_motion: str = None) -> str:
        """通过 Dashscope SDK 调用旧版模型生成视频。"""
        # 先整理好 SDK 所需参数
        call_args = {
            "api_key": self.api_key,
            "model": model_name,
            "prompt": prompt,
            "size": size,
            "prompt_extend": prompt_extend,
            "watermark": watermark,
        }
        
        # 有值的可选参数再追加进去
        if negative_prompt:
            call_args['negative_prompt'] = negative_prompt
        if duration:
            call_args['duration'] = duration
        if audio_url:
            call_args['audio_url'] = audio_url
        if seed:
            call_args['seed'] = seed
        if camera_motion:
            call_args['camera_motion'] = camera_motion
        if subject_motion:
            call_args['motion_scale'] = subject_motion
        
        if img_url:
            call_args['img_url'] = img_url
            logger.info(f"Image to Video mode. Input Image URL: {img_url}")

        rsp = VideoSynthesis.async_call(**call_args)
        
        if rsp.status_code != HTTPStatus.OK:
            logger.error(f"Failed to submit task: {rsp.code}, {rsp.message}")
            raise RuntimeError(f"Task submission failed: {rsp.message}")
        
        task_id = rsp.output.task_id
        logger.info(f"Task submitted. Task ID: {task_id}")
        
        # 轮询等待任务完成
        rsp = VideoSynthesis.wait(rsp)
        
        logger.info(f"SDK response: {rsp}")

        if rsp.status_code != HTTPStatus.OK:
            logger.error(f"Task failed with status code: {rsp.status_code}, code: {rsp.code}, message: {rsp.message}")
            raise RuntimeError(f"Task failed: {rsp.message}")
        
        if rsp.output.task_status != 'SUCCEEDED':
             logger.error(f"Task finished but status is {rsp.output.task_status}. Code: {rsp.output.code}, Message: {rsp.output.message}")
             raise RuntimeError(f"Task failed with status {rsp.output.task_status}: {rsp.output.message}")

        video_url = rsp.output.video_url
        if not video_url:
             logger.error("Video URL is empty despite SUCCEEDED status.")
             raise RuntimeError("Video URL is empty.")
        
        return video_url

    def _download_video(self, url: str, path: str):
        logger.info(f"Downloading video to {path}...")

        session = requests.Session()
        retry = Retry(connect=3, backoff_factor=0.5)
        adapter = HTTPAdapter(max_retries=retry)
        session.mount('http://', adapter)
        session.mount('https://', adapter)

        temp_path = path + ".tmp"
        try:
            response = session.get(url, stream=True, timeout=120)  # 2 minutes for large video files
            response.raise_for_status()

            with open(temp_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            # 用原子替换避免下载一半就被读取
            os.rename(temp_path, path)
            logger.info("Download complete.")

        except Exception as e:
            logger.error(f"Failed to download video: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise
