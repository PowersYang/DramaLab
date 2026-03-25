import os
import time
from typing import Dict, Any, List
from backend.src.schema.models import StoryboardFrame, Character, Scene, GenerationStatus, ImageAsset, ImageVariant
from ..models.image import WanxImageModel
from ..utils import get_logger
from ..utils.oss_utils import is_object_key

logger = get_logger(__name__)

class StoryboardGenerator:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxImageModel(self.config.get('model', {}))
        self.output_dir = self.config.get('output_dir', 'output/storyboard')

    def generate_storyboard(self, script: Any) -> Any:
        """为整部作品的所有分镜帧生成图片。"""
        logger.info(f"Generating storyboard for script: {script.title}")
        
        total_frames = len(script.frames)
        for i, frame in enumerate(script.frames):
            logger.info(f"Generating frame {i+1}/{total_frames}: {frame.id}")
            
            # 已经生成完成的帧先跳过；如果以后要支持强制重生，再单独加开关
            if frame.status == GenerationStatus.COMPLETED and frame.image_url:
                continue
                
            # 找出当前分镜对应的场景
            scene = next((s for s in script.scenes if s.id == frame.scene_id), None)
            
            self.generate_frame(frame, script.characters, scene)
            
        return script

    def generate_frame(self, frame: StoryboardFrame, characters: List[Character], scene: Scene, ref_image_path: str = None, ref_image_paths: List[str] = None, prompt: str = None, batch_size: int = 1, size: str = None, model_name: str = None) -> StoryboardFrame:
        """生成单帧分镜图。"""
        frame.status = GenerationStatus.PROCESSING
        
        # 分镜图默认走横版尺寸
        effective_size = size or "1024*576"
        
        # 后面会把角色和场景信息拼进提示词里
        char_descriptions = []
        
        # 收集可用的参考图路径
        asset_ref_paths = []
        
        # 前端如果已经明确传了参考图，就直接用前端选择结果
        # 否则再按角色、场景自动补齐
        use_frontend_refs = (ref_image_paths and len(ref_image_paths) > 0) or ref_image_path
        
        if use_frontend_refs:
            # 完全按照前端传入的参考图来，不再额外自动补图
            if ref_image_paths:
                asset_ref_paths.extend(ref_image_paths)
            if ref_image_path:
                asset_ref_paths.append(ref_image_path)
            logger.info(f"[Storyboard] Using {len(asset_ref_paths)} frontend-provided reference images")
        else:
            # 前端没传参考图时，自动从角色和场景里兜底收集
            for char_id in frame.character_ids:
                char = next((c for c in characters if c.id == char_id), None)
                if char:
                    # 角色参考图优先取当前已选中的那张
                    target_url = None
                    source = "none"
                    
                    # 优先级 1：三视图
                    if char.three_view_asset and char.three_view_asset.selected_id:
                        selected_variant = next((v for v in char.three_view_asset.variants if v.id == char.three_view_asset.selected_id), None)
                        if selected_variant:
                            target_url = selected_variant.url
                            source = f"three_view_asset"
                    
                    # 优先级 2：全身图
                    if not target_url and char.full_body_asset and char.full_body_asset.selected_id:
                        selected_variant = next((v for v in char.full_body_asset.variants if v.id == char.full_body_asset.selected_id), None)
                        if selected_variant:
                            target_url = selected_variant.url
                            source = f"full_body_asset"
                    
                    # 优先级 3：头像
                    if not target_url and char.headshot_asset and char.headshot_asset.selected_id:
                        selected_variant = next((v for v in char.headshot_asset.variants if v.id == char.headshot_asset.selected_id), None)
                        if selected_variant:
                            target_url = selected_variant.url
                            source = f"headshot_asset"
                    
                    # 优先级 4：再回退到旧字段
                    if not target_url:
                        target_url = char.three_view_image_url or char.full_body_image_url or char.headshot_image_url or char.avatar_url or char.image_url
                        source = "legacy_fields"
                    
                    logger.info(f"[Storyboard] Character '{char.name}' reference: source={source}, url={target_url}")
                    
                    if target_url:
                        if is_object_key(target_url):
                            asset_ref_paths.append(target_url)
                        else:
                            potential_path = os.path.join("output", target_url)
                            if os.path.exists(potential_path):
                                asset_ref_paths.append(os.path.abspath(potential_path))
                            elif os.path.exists(target_url):
                                asset_ref_paths.append(os.path.abspath(target_url))
            
            # 场景参考图也一并带上
            scene_url = None
            if scene:
                if scene.image_asset and scene.image_asset.selected_id:
                    selected_variant = next((v for v in scene.image_asset.variants if v.id == scene.image_asset.selected_id), None)
                    if selected_variant:
                        scene_url = selected_variant.url
                if not scene_url:
                    scene_url = scene.image_url
                
                if scene_url:
                    if is_object_key(scene_url):
                        asset_ref_paths.append(scene_url)
                    else:
                        potential_path = os.path.join("output", scene_url)
                        if os.path.exists(potential_path):
                            asset_ref_paths.append(os.path.abspath(potential_path))
                        elif os.path.exists(scene_url):
                            asset_ref_paths.append(os.path.abspath(scene_url))
        
        # 收集角色描述，后面拼进提示词
        for char_id in frame.character_ids:
            char = next((c for c in characters if c.id == char_id), None)
            if char:
                char_descriptions.append(f"{char.name} ({char.description})")
        
        char_text = ", ".join(char_descriptions)

        # 去重，避免同一张图重复传给模型
        asset_ref_paths = list(set(asset_ref_paths))
        
        if not prompt:
            prompt = f"Storyboard Frame: {frame.action_description}. "
            if char_text:
                prompt += f"Characters: {char_text}. "
            if scene:
                prompt += f"Location: {scene.name}, {scene.description}. "
                
            prompt += f"Camera: {frame.camera_angle}"
            if frame.camera_movement:
                prompt += f", {frame.camera_movement}"
            prompt += "."
        else:
            # 就算提示词来自用户或 LLM，也尽量补上角色描述，保证图生图时人物一致性
            if char_text and char_text not in prompt:
                prompt = f"{prompt} Characters: {char_text}."
        
        # 把最终用于生成的提示词存回帧数据
        frame.image_prompt = prompt
        
        # 渲染图素材容器不存在时补一个
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset(asset_id=frame.id, asset_type="storyboard_frame")

        try:
            import uuid
            
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_filename = f"{frame.id}_{variant_id}.png"
                output_path = os.path.join(self.output_dir, output_filename)
                
                # 确保输出目录存在
                os.makedirs(os.path.dirname(output_path), exist_ok=True)

                
                # 有参考图时底层会自动走图生图逻辑
                logger.info(f"[Storyboard] Calling model.generate with {len(asset_ref_paths)} reference images using model {model_name or 'default'}")
                self.model.generate(prompt, output_path, ref_image_paths=asset_ref_paths, size=effective_size, model_name=model_name)
                
                # 保存相对路径，方便前端统一拼资源地址
                rel_path = os.path.relpath(output_path, "output")
                
                # 记录这次生成出的候选图
                variant = ImageVariant(
                    id=variant_id,
                    url=rel_path,
                    prompt=prompt,
                    created_at=time.time()
                )
                frame.rendered_image_asset.variants.append(variant)
                
                # 默认选中刚生成的最新图片
                frame.rendered_image_asset.selected_id = variant_id
            
            # 同步旧字段，兼容老逻辑
            selected_variant = next((v for v in frame.rendered_image_asset.variants if v.id == frame.rendered_image_asset.selected_id), None)
            if selected_variant:
                frame.rendered_image_url = selected_variant.url
                frame.image_url = selected_variant.url
                
            frame.updated_at = time.time()
            frame.status = GenerationStatus.COMPLETED
            
            # 如果启用了 OSS，就把当前选中图传上去，并保存对象键
            try:
                from ...utils.oss_utils import OSSImageUploader
                uploader = OSSImageUploader()
                if uploader.is_configured:
                    # 只上传当前选中的那张渲染图
                    if selected_variant:
                        # 把相对路径还原成本地文件路径
                        local_path = os.path.join("output", selected_variant.url)
                        if os.path.exists(local_path):
                            # 上传后只保存对象键，实际返回前再签名
                            object_key = uploader.upload_file(
                                local_path, 
                                sub_path=f"storyboard"
                            )
                            if object_key:
                                logger.info(f"Uploaded frame {frame.id} to OSS: {object_key}")
                                # 返回 API 时再统一换成签名地址
                                selected_variant.url = object_key
                                frame.rendered_image_url = object_key
                                frame.image_url = object_key
            except Exception as e:
                logger.error(f"Failed to upload frame {frame.id} to OSS: {e}")
                # OSS 上传失败不影响本地生成结果
                
        except Exception as e:
            logger.error(f"Failed to generate frame {frame.id}: {e}")
            frame.status = GenerationStatus.FAILED
            
        return frame
