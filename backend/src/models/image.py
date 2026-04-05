from abc import ABC, abstractmethod
import os
import time
import traceback
from http import HTTPStatus
from typing import Any, Dict, Tuple

import dashscope
import requests
from dashscope import ImageSynthesis
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

from ..utils import get_logger
from ..application.services.model_provider_service import ModelProviderService
from ..utils.endpoints import get_provider_base_url
from ..utils.oss_utils import OSSImageUploader, is_object_key

logger = get_logger(__name__)

class ImageGenModel(ABC):
    """图片生成模型的抽象基类。"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config

    @abstractmethod
    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        """根据提示词生成图片，并返回 `(输出路径, 接口耗时秒数)`。"""
        pass

class WanxImageModel(ImageGenModel):
    def __init__(self, config):
        super().__init__(config)
        self.params = config.get('params', {})
        self.last_generation_metrics = None

    @property
    def api_key(self):
        api_key = ModelProviderService().get_provider_credential("DASHSCOPE", "api_key")
        if not api_key:
            logger.warning("供应商管理未配置 Dashscope 访问密钥。")
        return api_key

    def generate(self, prompt: str, output_path: str, ref_image_path: str = None, ref_image_paths: list = None, model_name: str = None, **kwargs) -> Tuple[str, float]:
        # 根据是否携带参考图，自动决定走文生图还是图生图
        # 同时兼容旧版单图参数和新版多图参数
        dashscope.api_key = self.api_key

        all_ref_paths = []
        if ref_image_path:
            all_ref_paths.append(ref_image_path)
        if ref_image_paths:
            all_ref_paths.extend(ref_image_paths)
            
        # 参考图去重，避免重复上传
        all_ref_paths = list(set(all_ref_paths))
        # 模型选择优先级：显式传入 > 配置项 > 默认值
        if model_name:
            final_model_name = model_name
        elif all_ref_paths:
            # 图生图优先用 i2i_model_name，没配再回退默认模型
            final_model_name = self.params.get('i2i_model_name', 'wan2.5-i2i-preview')
        else:
            # 文生图优先用配置模型，没配再回退默认模型
            final_model_name = self.params.get('model_name', 'wan2.6-t2i')

        if all_ref_paths:
            logger.info(f"使用图生图模型：{final_model_name}，参考图数量：{len(all_ref_paths)}")
        else:
            logger.info(f"使用文生图模型：{final_model_name}")

        size = kwargs.pop('size', self.params.get('size', '1280*1280'))
        n = kwargs.pop('n', self.params.get('n', 1))
        negative_prompt = kwargs.pop('negative_prompt', None)
        # 上面已经决定过 model_name，这里把重复参数清掉
        kwargs.pop('model_name', None)
        
        # 不同模型支持的参考图数量不同，这里提前裁掉
        ref_limit = 4 if final_model_name == 'wan2.6-image' else 3
        if len(all_ref_paths) > ref_limit:
            logger.warning(f"参考图数量超限：从 {len(all_ref_paths)} 限制到 {ref_limit}（模型：{final_model_name}）")
            all_ref_paths = all_ref_paths[:ref_limit]
        
        logger.info("开始生成图片...")
        logger.info(f"提示词：{prompt}")
        logger.info(f"模型：{final_model_name}, 尺寸：{size}, 张数：{n}")

        try:
            api_start_time = time.time()
            # 2.6 系列优先走 HTTP 接口；旧模型继续走 SDK
            if final_model_name == 'wan2.6-t2i':
                image_url, provider_meta = self._generate_wan26_http(prompt, size, n, negative_prompt)
            elif final_model_name == 'wan2.6-image':
                # 2.6 图像模型专门用于图生图
                image_url, provider_meta = self._generate_wan26_image_http(prompt, size, n, negative_prompt, all_ref_paths)
            else:
                # 其他模型继续走 Dashscope SDK
                image_url, provider_meta = self._generate_sdk(prompt, final_model_name, size, n, negative_prompt, all_ref_paths,
                                                              kwargs)

            api_end_time = time.time()
            api_duration = api_end_time - api_start_time
            self.last_generation_metrics = {
                "version": "v1",
                "provider": {"name": "DASHSCOPE", "model": final_model_name},
                "usage": {
                    "request_count": 1,
                    "images": n,
                    "reference_images": len(all_ref_paths),
                    "request_duration_seconds": round(api_duration, 4),
                },
                "cost": {"amount": None, "currency": "UNKNOWN", "pricing_basis": "provider_usage"},
                "artifacts": {"size": size, "output_count": n},
                "supplier_reference": {
                    "task_id": provider_meta.get("task_id"),
                    "request_id": provider_meta.get("request_id"),
                },
            }

            logger.info(f"生成成功，图片链接：{image_url}")
            logger.info(f"接口耗时：{api_duration:.2f}秒")
            
            # 拉取成品图片到本地
            self._download_image(image_url, output_path)
            return output_path, api_duration

        except Exception as e:
            logger.error(f"生成过程中发生异常：{e}")
            logger.error(traceback.format_exc())
            raise

    def _generate_wan26_http(self, prompt: str, size: str, n: int, negative_prompt: str = None) -> tuple[str, dict[str, Any]]:
        """通过 HTTP 接口调用 Wan 2.6 文生图。"""
        provider_service = ModelProviderService()
        request_path = provider_service.require_model_setting(
            "wan2.6-t2i",
            "request_path",
            task_type="t2i",
        )
        url = provider_service.build_provider_url(
            "DASHSCOPE",
            base_url=get_provider_base_url("DASHSCOPE"),
            path_suffix=str(request_path),
        )
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload = {
            "model": "wan2.6-t2i",
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "text": prompt
                            }
                        ]
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,  # 关闭自动扩写，减少结果漂移
                "watermark": False,
                "n": n,
                "size": size
            }
        }
        
        # 按需补充负向提示词
        if negative_prompt:
            payload["parameters"]["negative_prompt"] = negative_prompt
        
        logger.info("正在调用 Wan 2.6 文生图接口...")
        logger.info(f"请求负载：{payload}")
        
        response = requests.post(url, headers=headers, json=payload, timeout=300)  # 5 minutes for slow API responses
        
        logger.info(f"响应状态码：{response.status_code}")
        logger.info(f"响应体：{response.text[:500]}...")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"Wan 2.6 API failed: {error_msg}")
        
        result = response.json()
        
        # 从响应里取出图片地址
        choices = result.get('output', {}).get('choices', [])
        if not choices:
            raise RuntimeError(f"No choices in response: {result}")
        
        # 默认取第一张结果图
        first_choice = choices[0]
        content = first_choice.get('message', {}).get('content', [])
        if not content:
            raise RuntimeError(f"No content in choice: {first_choice}")
        
        image_url = content[0].get('image')
        if not image_url:
            raise RuntimeError(f"No image URL in content: {content}")
        
        return image_url, {"task_id": None, "request_id": result.get("request_id") or response.headers.get("x-request-id")}

    def _generate_wan26_image_http(self, prompt: str, size: str, n: int, negative_prompt: str = None, ref_image_paths: list = None) -> tuple[str, dict[str, Any]]:
        """通过 HTTP 接口调用 Wan 2.6 图生图，并轮询任务结果。"""
        provider_service = ModelProviderService()
        create_path = provider_service.require_model_setting(
            "wan2.6-image",
            "create_path",
            task_type="i2i",
        )
        poll_path_template = provider_service.require_model_setting(
            "wan2.6-image",
            "poll_path_template",
            task_type="i2i",
        )
        create_url = provider_service.build_provider_url(
            "DASHSCOPE",
            base_url=get_provider_base_url("DASHSCOPE"),
            path_suffix=str(create_path),
        )
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable"  # 开启异步任务模式
        }
        
        # 组装消息内容：文本 + 参考图
        content = [{"text": prompt}]

        # 参考图如果是本地文件，要先传 OSS 再拿签名地址
        if ref_image_paths:
            # 这里再做一层保护性裁剪，避免超出接口上限
            ref_limit = 4
            uploader = OSSImageUploader()
            for path in ref_image_paths[:ref_limit]:
                normalized_url = self._normalize_reference_image_url_for_api(path, uploader=uploader)
                content.append({"image": normalized_url})
                logger.info(f"参考图已就绪，调用链接：{normalized_url[:80]}...")
        
        payload = {
            "model": "wan2.6-image",
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,  # 关闭自动扩写，减少结果漂移
                "watermark": False,
                "n": n,
                "size": size,
                "enable_interleave": False  # 图像编辑模式
            }
        }
        
        # 按需补充负向提示词
        if negative_prompt:
            payload["parameters"]["negative_prompt"] = negative_prompt
        
        logger.info("正在调用 Wan 2.6 图生图接口（异步）...")
        logger.info(f"请求负载：{payload}")
        
        # 第一步：提交异步任务
        response = requests.post(create_url, headers=headers, json=payload, timeout=120)  # 2 minutes for task creation
        
        logger.info(f"创建任务响应状态码：{response.status_code}")
        logger.info(f"创建任务响应体：{response.text[:500]}")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"Wan 2.6 Image task creation failed: {error_msg}")
        
        result = response.json()
        task_id = result.get('output', {}).get('task_id')
        if not task_id:
            raise RuntimeError(f"No task_id in response: {result}")
        
        logger.info(f"任务已创建：{task_id}")
        
        # 第二步：轮询任务直到完成
        poll_url = provider_service.build_provider_url(
            "DASHSCOPE",
            base_url=get_provider_base_url("DASHSCOPE"),
            path_suffix=str(poll_path_template).format(task_id=task_id),
        )
        poll_headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        max_wait_time = 600  # 10 minutes max wait (I2I can take longer)
        poll_interval = 10   # Poll every 10 seconds
        elapsed = 0
        
        while elapsed < max_wait_time:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            poll_response = requests.get(poll_url, headers=poll_headers, timeout=30)
            
            if poll_response.status_code != 200:
                logger.warning(f"轮询请求失败：{poll_response.status_code}")
                continue
            
            poll_result = poll_response.json()
            task_status = poll_result.get('output', {}).get('task_status')
            
            logger.info(f"任务状态：任务编号={task_id} 状态={task_status} 已耗时={elapsed}秒")
            
            if task_status == 'SUCCEEDED':
                # 从完成结果里取出图片地址
                choices = poll_result.get('output', {}).get('choices', [])
                if not choices:
                    raise RuntimeError(f"No choices in completed task: {poll_result}")
                
                first_choice = choices[0]
                content = first_choice.get('message', {}).get('content', [])
                if not content:
                    raise RuntimeError(f"No content in choice: {first_choice}")
                
                image_url = content[0].get('image')
                if not image_url:
                    raise RuntimeError(f"No image URL in content: {content}")
                
                logger.info(f"任务完成，图片链接：{image_url}")
                return image_url, {"task_id": task_id, "request_id": poll_result.get("request_id") or poll_response.headers.get("x-request-id")}
            
            elif task_status == 'FAILED':
                # 失败时把完整响应打出来，方便排查
                logger.error(f"任务失败：任务编号={task_id} 完整响应：{poll_result}")
                
                # 尽量从不同字段里提取可读错误信息
                error_msg = (
                    poll_result.get('output', {}).get('message', '') or
                    poll_result.get('output', {}).get('code', '') or
                    poll_result.get('message', '') or
                    poll_result.get('code', '') or
                    'Unknown error - check logs for full response'
                )
                
                raise RuntimeError(f"Wan 2.6 Image task failed: {error_msg}")

            
            elif task_status in ['CANCELED', 'UNKNOWN']:
                raise RuntimeError(f"Wan 2.6 Image task {task_status}: {poll_result}")
            
            # 还在排队或执行中，继续轮询
        
        raise RuntimeError(f"Wan 2.6 Image task timed out after {max_wait_time}s")

    def _generate_sdk(self, prompt: str, model_name: str, size: str, n: int, negative_prompt: str, all_ref_paths: list, kwargs: dict) -> tuple[str, dict[str, Any]]:
        """通过 Dashscope SDK 调用旧版图片模型。"""
        call_args = {
            "model": model_name,
            "prompt": prompt,
            "n": n,
            "size": size,
        }
        
        # 按需补充负向提示词
        if negative_prompt:
            call_args["negative_prompt"] = negative_prompt
        
        # 其余参数原样透传给 SDK
        call_args.update(kwargs)
        
        logger.info(f"客户端库调用参数：{dict((k, v) for k, v in call_args.items() if k != 'images')}")
        # 图生图场景下还要把参考图统一整理成 URL
        if all_ref_paths:
            ref_image_urls = []
            uploader = OSSImageUploader()
            for path in all_ref_paths:
                ref_image_urls.append(self._normalize_reference_image_url_for_api(path, uploader=uploader))
            
            logger.info(f"调试：参考图链接列表 数量：{len(ref_image_urls)}")
            
            # 这里再做一层保护性裁剪
            ref_limit = 4 if model_name == 'wan2.6-image' else 3
            if len(ref_image_urls) > ref_limit:
                logger.warning(f"参考图数量超限：从 {len(ref_image_urls)} 限制到 {ref_limit}")
                ref_image_urls = ref_image_urls[:ref_limit]
            
            call_args['images'] = ref_image_urls

        # 正式调用 Dashscope SDK
        rsp = ImageSynthesis.call(**call_args)
        
        logger.info(f"客户端库响应：{rsp}")

        if rsp.status_code != HTTPStatus.OK:
            logger.error(f"任务失败：状态码={rsp.status_code} 代码={rsp.code} 信息={rsp.message}")
            raise RuntimeError(f"Task failed: {rsp.message}")

        # 从 SDK 返回结果里提取图片地址
        if hasattr(rsp, 'output'):
            logger.info(f"响应输出：{rsp.output}")
            results = rsp.output.get('results')
            url = rsp.output.get('url')
            
            if results and len(results) > 0:
                 first_result = results[0]
                 if isinstance(first_result, dict):
                     image_url = first_result.get('url')
                 else:
                     image_url = getattr(first_result, 'url', None)
            elif url:
                 image_url = url
            else:
                 logger.error(f"响应结构异常，输出：{rsp.output}")
                 raise RuntimeError("Could not find image URL in response.")
        else:
             logger.error(f"响应缺少输出字段，完整响应：{rsp}")
             raise RuntimeError("Response has no output.")
        
        return image_url, {"task_id": None, "request_id": getattr(rsp, "request_id", None)}

    def _normalize_reference_image_url_for_api(self, path: str, uploader: OSSImageUploader | None = None) -> str:
        """把参考图输入统一转换成可被远端模型服务直接拉取的 URL。"""
        uploader = uploader or OSSImageUploader()

        if os.path.exists(path):
            if not uploader.is_configured:
                raise RuntimeError(f"对象存储未配置，无法上传参考图：{path}")
            object_key = uploader.upload_file(path, sub_path="temp/ref_images")
            if not object_key:
                raise RuntimeError(f"Failed to upload reference image to OSS: {path}")
            signed_url = uploader.sign_url_for_api(object_key)
            return self._require_remote_reference_url(
                signed_url,
                source_label=f"uploaded object {object_key}",
            )

        if path.startswith(("http://", "https://")):
            return path

        if is_object_key(path):
            if not uploader.is_configured:
                raise RuntimeError(f"OSS not configured but Object Key provided: {path}")
            signed_url = uploader.sign_url_for_api(path)
            return self._require_remote_reference_url(
                signed_url,
                source_label=f"object key {path}",
            )

        raise ValueError(f"Reference image not found: {path}")

    def _require_remote_reference_url(self, candidate_url: str, *, source_label: str) -> str:
        """校验参考图 URL，避免把空串或非法地址继续传给供应商接口。"""
        normalized = str(candidate_url or "").strip()
        if normalized.startswith(("http://", "https://")):
            return normalized
        raise RuntimeError(
            "Reference image URL is unavailable for remote generation: "
            f"{source_label}"
        )

    def _download_image(self, url: str, output_path: str):
        logger.info(f"正在下载图片到 {output_path}...")
        
        # 给下载请求加重试策略，降低偶发网络错误影响
        retry_strategy = Retry(
            total=5,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        http = requests.Session()
        http.mount("https://", adapter)
        http.mount("http://", adapter)

        temp_path = output_path + ".tmp"
        try:
            response = http.get(url, stream=True, timeout=60, verify=False) # verify=False to avoid some SSL issues
            response.raise_for_status()
            
            # 确保目标目录存在
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(temp_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # 先写临时文件，再原子替换成正式文件
            os.rename(temp_path, output_path)
            logger.info("下载完成。")
            
        except Exception as e:
            logger.error(f"下载图片失败：{e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise
