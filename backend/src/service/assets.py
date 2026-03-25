import os
import uuid
import time
from typing import Dict, Any
from backend.src.schema.models import Character, Scene, Prop, GenerationStatus, ImageAsset, MAX_VARIANTS_PER_ASSET
from ..models.image import WanxImageModel
from ..utils import get_logger
from ..utils.oss_utils import is_object_key

logger = get_logger(__name__)

def cleanup_old_variants(image_asset: ImageAsset) -> None:
    """
    控制素材历史图数量。

    最多保留 `MAX_VARIANTS_PER_ASSET` 张未收藏图片；
    已收藏的图片始终保留；
    超出上限时，优先删除最早生成的未收藏图片。
    """
    if not image_asset or not image_asset.variants:
        return
    
    favorited = [v for v in image_asset.variants if v.is_favorited]
    non_favorited = [v for v in image_asset.variants if not v.is_favorited]
    
    # 未收藏图片按生成时间升序排列，方便从最老的开始裁剪
    non_favorited.sort(key=lambda v: v.created_at)
    
    # 只保留最近生成的若干张未收藏图片
    if len(non_favorited) > MAX_VARIANTS_PER_ASSET:
        to_remove = len(non_favorited) - MAX_VARIANTS_PER_ASSET
        removed = non_favorited[:to_remove]
        non_favorited = non_favorited[to_remove:]
        for v in removed:
            logger.info(f"Auto-removed old variant: {v.id} (created_at: {v.created_at})")
    
    # 重新拼装列表：收藏图放前面，其余图片按从新到旧排列
    non_favorited.reverse()  # 改成从新到旧
    image_asset.variants = favorited + non_favorited

# 宽高比到实际出图尺寸的映射
ASPECT_RATIO_TO_SIZE = {
    "9:16": "576*1024",   # 竖图
    "16:9": "1024*576",   # 横图
    "1:1": "1024*1024",   # 方图
}

class AssetGenerator:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        # 当前默认走 Wanx，后续可通过配置切换模型实现
        self.model = WanxImageModel(self.config.get('model', {}))
        self.output_dir = self.config.get('output_dir', 'output/assets')

    def generate_character(self, character: Character, generation_type: str = "all", prompt: str = "", positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, i2i_model_name: str = None, size: str = None) -> Character:
        """
        按指定类型生成角色素材。

        generation_type 支持：
        - `full_body`：全身设定图
        - `three_view`：三视图
        - `headshot`：头像
        - `all`：整套一起生成
        """
        character.status = GenerationStatus.PROCESSING
        
        # `None` 表示用默认风格后缀，空字符串表示明确不追加风格词
        style_suffix = positive_prompt if positive_prompt is not None else "cinematic lighting, movie still, 8k, highly detailed, realistic"
        
        # 角色图默认按竖版尺寸生成
        effective_size = size or "576*1024"
        
        try:
            # 1. 生成全身主设图
            if generation_type in ["all", "full_body"]:
                # 优先使用用户传入的提示词，否则按角色信息自动拼一版默认提示词
                if not prompt:
                    # 默认提示词里不直接塞风格词，重点强调纯背景和角色主体
                    base_prompt = f"Full body character design of {character.name}, concept art. {character.description}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece."
                else:
                    base_prompt = prompt
                
                # 存原始提示词，避免把风格后缀一并写回角色数据
                character.full_body_prompt = base_prompt
                
                # 真正调用模型时再补上风格后缀
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt
                
                # 如果是基于已有角色派生的新角色，优先拿基础角色的全身图做参考
                ref_image_path = None
                if character.base_character_id:
                    base_fullbody_path = os.path.join(self.output_dir, 'characters', f"{character.base_character_id}_fullbody.png")
                    if os.path.exists(base_fullbody_path):
                        ref_image_path = base_fullbody_path

                # 反向生成：如果用户传过图，优先拿上传图做参考
                # 优先级：三视图 > 头像
                if not ref_image_path:
                    # 先看有没有上传过三视图
                    if character.three_view_asset:
                        uploaded_variant = next(
                            (v for v in character.three_view_asset.variants if getattr(v, 'is_uploaded_source', False)),
                            None
                        )
                        if uploaded_variant:
                            ref_url = uploaded_variant.url
                            if is_object_key(ref_url):
                                ref_image_path = ref_url
                                logger.debug(f"Reverse generation: Using uploaded three_views as reference: {ref_url}")
                            else:
                                local_path = os.path.join("output", ref_url)
                                if os.path.exists(local_path):
                                    ref_image_path = local_path
                                    logger.debug(f"Reverse generation: Using local three_views as reference: {local_path}")
                    
                    # 再看有没有上传过头像
                    if not ref_image_path and character.headshot_asset:
                        uploaded_variant = next(
                            (v for v in character.headshot_asset.variants if getattr(v, 'is_uploaded_source', False)),
                            None
                        )
                        if uploaded_variant:
                            ref_url = uploaded_variant.url
                            if is_object_key(ref_url):
                                ref_image_path = ref_url
                                logger.debug(f"Reverse generation: Using uploaded headshot as reference: {ref_url}")
                            else:
                                local_path = os.path.join("output", ref_url)
                                if os.path.exists(local_path):
                                    ref_image_path = local_path
                                    logger.debug(f"Reverse generation: Using local headshot as reference: {local_path}")

                # 批量生成多张候选图
                successful_generations = 0
                for i in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        fullbody_path = os.path.join(self.output_dir, 'characters', f"{character.id}_fullbody_{variant_id}.png")
                        os.makedirs(os.path.dirname(fullbody_path), exist_ok=True)
                        
                        # 只要带参考图，就切到图生图模型
                        effective_model_name = model_name
                        effective_generation_prompt = generation_prompt
                        if ref_image_path:
                            # 带参考图时强制改用 I2I 模型
                            effective_model_name = i2i_model_name or "wan2.6-image"
                            logger.debug(f"Reverse generation: Using I2I model {effective_model_name} with reference image")
                            
                            # 补一段“尽量对齐参考图”的约束，避免参考图没生效
                            reverse_enhancement = "STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, skin tone, and clothing as the reference image. "
                            if reverse_enhancement.strip() not in effective_generation_prompt:
                                effective_generation_prompt = f"{reverse_enhancement}{generation_prompt}"
                                logger.debug(f"Reverse generation enhanced prompt: {effective_generation_prompt[:100]}...")
                        
                        self.model.generate(effective_generation_prompt, fullbody_path, ref_image_path=ref_image_path, negative_prompt=negative_prompt, model_name=effective_model_name, size=effective_size)
                        
                        rel_fullbody_path = os.path.relpath(fullbody_path, "output")
                        
                        # 把新图挂到角色素材列表里
                        if not character.full_body_asset:
                            from backend.src.schema.models import ImageAsset
                            character.full_body_asset = ImageAsset()
                            
                        from backend.src.schema.models import ImageVariant
                        variant = ImageVariant(
                            id=variant_id,
                            url=rel_fullbody_path,
                            created_at=time.time(),
                            prompt_used=generation_prompt
                        )
                        character.full_body_asset.variants.insert(0, variant)  # 新图插到最前面
                        
                        # 顺手清理超出上限的历史图片
                        cleanup_old_variants(character.full_body_asset)
                        
                        # 首次出图或单张生成时，自动切成当前选中图片
                        if not character.full_body_asset.selected_id or batch_size == 1:
                            character.full_body_asset.selected_id = variant_id
                            character.full_body_image_url = rel_fullbody_path  # 同步旧字段
                        
                        successful_generations += 1
                        logger.debug(f"Full body variant {i+1}/{batch_size} generated successfully")
                        
                        # 连续批量调用时稍微停一下，降低被限流的概率
                        if i < batch_size - 1:
                            time.sleep(1)
                    except Exception as e:
                        logger.error(f"Failed to generate full body variant {i+1}/{batch_size}: {e}")
                        # 单张失败不直接中断整批任务
                        continue

                    # 如果启用了 OSS，就把文件传上去，并在数据里保存对象键
                    try:
                        from ...utils.oss_utils import OSSImageUploader
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(fullbody_path, sub_path="assets/characters")
                            if object_key:
                                logger.debug(f"Uploaded full body variant {i+1} to OSS: {object_key}")
                                variant.url = object_key
                                if character.full_body_asset.selected_id == variant.id:
                                    character.full_body_image_url = object_key
                    except Exception as e:
                        logger.error(f"Failed to upload full body variant {i+1} to OSS: {e}")

                logger.info(f"Full body generation complete: {successful_generations}/{batch_size} variants generated")
                character.full_body_updated_at = time.time()
                
                # 一张都没生成成功就整体报错
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")
                
                # 只重生了全身图时，下游素材需要重新确认一致性
                if generation_type == "full_body":
                    character.is_consistent = False
            
            # 生成三视图或头像前，先确定当前要使用哪张全身参考图
            current_full_body_url = character.full_body_image_url
            if character.full_body_asset and character.full_body_asset.selected_id:
                selected_variant = next((v for v in character.full_body_asset.variants if v.id == character.full_body_asset.selected_id), None)
                if selected_variant:
                    current_full_body_url = selected_variant.url

            # 没有全身图时，也允许直接拿用户上传图做反向生成参考
            uploaded_reference_url = None
            if not current_full_body_url:
                # 优先找与当前目标最相关的上传图，其次再回退到其他类型
                if generation_type == "three_view" and character.headshot_asset:
                    # 生三视图时，头像也能拿来当参考
                    uploaded_variant = next(
                        (v for v in character.headshot_asset.variants if getattr(v, 'is_uploaded_source', False)),
                        None
                    )
                    if uploaded_variant:
                        uploaded_reference_url = uploaded_variant.url
                        logger.debug(f"Reverse generation: Will use uploaded headshot as reference for three_view")
                
                elif generation_type == "headshot" and character.three_view_asset:
                    # 生头像时，三视图也能拿来当参考
                    uploaded_variant = next(
                        (v for v in character.three_view_asset.variants if getattr(v, 'is_uploaded_source', False)),
                        None
                    )
                    if uploaded_variant:
                        uploaded_reference_url = uploaded_variant.url
                        logger.debug(f"Reverse generation: Will use uploaded three_views as reference for headshot")
                
                # 最后再看当前素材位里是否已有上传图
                if not uploaded_reference_url:
                    own_asset = character.three_view_asset if generation_type == "three_view" else character.headshot_asset
                    if own_asset:
                        uploaded_variant = next(
                            (v for v in own_asset.variants if getattr(v, 'is_uploaded_source', False)),
                            None
                        )
                        if uploaded_variant:
                            uploaded_reference_url = uploaded_variant.url
                            logger.debug(f"Reverse generation: Will use own uploaded image as reference")

            if generation_type in ["three_view", "headshot"] and not current_full_body_url and not uploaded_reference_url:
                raise ValueError("Full body image is required to generate derived assets. Upload an image or generate a full body first.")
            
            # 统一整理参考图路径：可能是 OSS 对象键，也可能是本地相对路径
            reference_url = current_full_body_url or uploaded_reference_url
            if reference_url:
                if is_object_key(reference_url):
                    # OSS 对象键直接透传，签名由底层图片模型处理
                    fullbody_path = reference_url
                    logger.debug(f"Using OSS Object Key for reference: {reference_url}")
                else:
                    # 本地相对路径补齐到 output 目录下
                    fullbody_path = os.path.join("output", reference_url)
                    logger.debug(f"Using local path for reference: {fullbody_path}")
            else:
                fullbody_path = None

            # 2. 生成三视图
            if generation_type in ["all", "three_view"]:
                if not prompt or generation_type == "all":
                    # 默认提示词里直接强调“与参考图保持一致”
                    base_prompt = f"Character Reference Sheet for {character.name}. {character.description}. Three-view character design: Front view, Side view, and Back view. STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, and clothing as the reference image. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background, clean lines, studio lighting, high quality."
                else:
                    base_prompt = prompt
                
                # 保存用户输入的原始提示词
                character.three_view_prompt = base_prompt
                
                # 实际调用时再补风格词
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt
                
                sheet_negative = negative_prompt + ", background, scenery, landscape, shadows, complex background, text, watermark, messy, distorted, extra limbs"

                successful_generations = 0
                for i in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        sheet_path = os.path.join(self.output_dir, 'characters', f"{character.id}_sheet_{variant_id}.png")
                        
                        self.model.generate(generation_prompt, sheet_path, ref_image_path=fullbody_path, negative_prompt=sheet_negative, ref_strength=0.8, model_name=i2i_model_name)
                        
                        rel_sheet_path = os.path.relpath(sheet_path, "output")
                        
                        if not character.three_view_asset:
                            from backend.src.schema.models import ImageAsset
                            character.three_view_asset = ImageAsset()
                            
                        from backend.src.schema.models import ImageVariant
                        variant = ImageVariant(
                            id=variant_id,
                            url=rel_sheet_path,
                            created_at=time.time(),
                            prompt_used=generation_prompt
                        )
                        character.three_view_asset.variants.insert(0, variant)
                        
                        # 控制历史图片数量，避免无限堆积
                        cleanup_old_variants(character.three_view_asset)
                        
                        if not character.three_view_asset.selected_id or batch_size == 1:
                            character.three_view_asset.selected_id = variant_id
                            character.three_view_image_url = rel_sheet_path  # 同步旧字段
                            character.image_url = rel_sheet_path  # 兼容老字段映射
                        
                        successful_generations += 1
                        logger.debug(f"Three view variant {i+1}/{batch_size} generated successfully")
                        
                        if i < batch_size - 1:
                            time.sleep(1)
                    except Exception as e:
                        logger.error(f"Failed to generate three view variant {i+1}/{batch_size}: {e}")
                        continue
                    
                    # 如果启用了 OSS，就把文件传上去，并在数据里保存对象键
                    try:
                        from ...utils.oss_utils import OSSImageUploader
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(sheet_path, sub_path="assets/characters")
                            if object_key:
                                logger.debug(f"Uploaded three view variant {i+1} to OSS: {object_key}")
                                variant.url = object_key
                                if character.three_view_asset.selected_id == variant.id:
                                    character.three_view_image_url = object_key
                                    character.image_url = object_key
                    except Exception as e:
                        logger.error(f"Failed to upload three view variant {i+1} to OSS: {e}")

                logger.info(f"Three view generation complete: {successful_generations}/{batch_size} variants generated")
                character.three_view_updated_at = time.time()
                
                # 一张都没成功时，直接抛错让上层感知失败
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")

            # 3. 生成头像
            if generation_type in ["all", "headshot"]:
                if not prompt or generation_type == "all":
                    # 默认提示词里补齐“与参考图保持同一人”的约束
                    base_prompt = f"Close-up portrait of the SAME character {character.name}. {character.description}. STRICTLY MAINTAIN the SAME face, hairstyle, skin tone, and facial features as the reference image. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece."
                else:
                    base_prompt = prompt
                
                # 保存原始提示词
                character.headshot_prompt = base_prompt
                
                # 实际生成时再追加风格词
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt
                
                successful_generations = 0
                for i in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        avatar_path = os.path.join(self.output_dir, 'characters', f"{character.id}_avatar_{variant_id}.png")
                        
                        self.model.generate(generation_prompt, avatar_path, ref_image_path=fullbody_path, negative_prompt=negative_prompt, ref_strength=0.8, model_name=i2i_model_name)
                        
                        rel_avatar_path = os.path.relpath(avatar_path, "output")
                        
                        if not character.headshot_asset:
                            from backend.src.schema.models import ImageAsset
                            character.headshot_asset = ImageAsset()
                            
                        from backend.src.schema.models import ImageVariant
                        variant = ImageVariant(
                            id=variant_id,
                            url=rel_avatar_path,
                            created_at=time.time(),
                            prompt_used=generation_prompt
                        )
                        character.headshot_asset.variants.insert(0, variant)
                        
                        # 控制历史图片数量，避免越积越多
                        cleanup_old_variants(character.headshot_asset)
                        
                        if not character.headshot_asset.selected_id or batch_size == 1:
                            character.headshot_asset.selected_id = variant_id
                            character.headshot_image_url = rel_avatar_path  # 同步旧字段
                            character.avatar_url = rel_avatar_path  # 兼容老字段映射
                        
                        successful_generations += 1
                        logger.debug(f"Headshot variant {i+1}/{batch_size} generated successfully")
                        
                        if i < batch_size - 1:
                            time.sleep(1)
                    except Exception as e:
                        logger.error(f"Failed to generate headshot variant {i+1}/{batch_size}: {e}")
                        continue

                    # 如果启用了 OSS，就把文件传上去，并在数据里保存对象键
                    try:
                        from ...utils.oss_utils import OSSImageUploader
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(avatar_path, sub_path="assets/characters")
                            if object_key:
                                logger.debug(f"Uploaded headshot variant {i+1} to OSS: {object_key}")
                                variant.url = object_key
                                if character.headshot_asset.selected_id == variant.id:
                                    character.headshot_image_url = object_key
                                    character.avatar_url = object_key
                    except Exception as e:
                        logger.error(f"Failed to upload headshot variant {i+1} to OSS: {e}")

                logger.info(f"Headshot generation complete: {successful_generations}/{batch_size} variants generated")
                character.headshot_updated_at = time.time()
                
                # 一张都没成功时，直接抛错让上层感知失败
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")

            # 更新一致性标记，兼容旧逻辑，同时给前端快速判断用
            if generation_type == "all":
                character.is_consistent = True
            elif character.three_view_updated_at >= character.full_body_updated_at and \
                 character.headshot_updated_at >= character.full_body_updated_at:
                character.is_consistent = True

            character.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Failed to generate character {character.name}: {e}")
            character.status = GenerationStatus.FAILED
            raise  # 继续向上抛，让调用方知道生成失败
            
        return character

    def generate_scene(self, scene: Scene, positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, size: str = None) -> Scene:
        """生成场景参考图。"""
        scene.status = GenerationStatus.PROCESSING
        
        # 用户没传风格词时，用默认电影感风格
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        
        # 场景图默认走横版尺寸
        effective_size = size or "1024*576"
        
        prompt = f"Scene Concept Art: {scene.name}. {scene.description}. High quality, detailed. {positive_prompt}"
        
        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = os.path.join(self.output_dir, 'scenes', f"{scene.id}_{variant_id}.png")
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                image_path, _ = self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                
                rel_path = os.path.relpath(output_path, "output")
                
                if not scene.image_asset:
                    from backend.src.schema.models import ImageAsset
                    scene.image_asset = ImageAsset()
                    
                from backend.src.schema.models import ImageVariant
                variant = ImageVariant(
                    id=variant_id,
                    url=rel_path,
                    created_at=time.time(),
                    prompt_used=prompt
                )
                scene.image_asset.variants.insert(0, variant)
                
                if not scene.image_asset.selected_id or batch_size == 1:
                    scene.image_asset.selected_id = variant_id
                    scene.image_url = rel_path  # 同步旧字段

                # 如果启用了 OSS，就把文件传上去，并在数据里保存对象键
                try:
                    from ...utils.oss_utils import OSSImageUploader
                    uploader = OSSImageUploader()
                    if uploader.is_configured:
                        object_key = uploader.upload_file(output_path, sub_path="assets/scenes")
                        if object_key:
                            logger.debug(f"Uploaded scene variant to OSS: {object_key}")
                            variant.url = object_key
                            if scene.image_asset.selected_id == variant.id:
                                scene.image_url = object_key
                except Exception as e:
                    logger.error(f"Failed to upload scene variant to OSS: {e}")

            scene.status = GenerationStatus.COMPLETED
        except Exception as e:
            logger.error(f"Failed to generate scene {scene.name}: {e}")
            scene.status = GenerationStatus.FAILED
            raise  # 继续向上抛，让调用方知道生成失败
            
        return scene

    def generate_prop(self, prop: Prop, positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, size: str = None) -> Prop:
        """生成道具参考图。"""
        prop.status = GenerationStatus.PROCESSING
        
        # 用户没传风格词时，用默认电影感风格
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        
        # 道具图默认走方图尺寸
        effective_size = size or "1024*1024"
        
        prompt = f"Prop Design: {prop.name}. {prop.description}. Isolated on white background, high quality, detailed. {positive_prompt}"
        
        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = os.path.join(self.output_dir, 'props', f"{prop.id}_{variant_id}.png")
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                
                image_path, _ = self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                
                rel_path = os.path.relpath(output_path, "output")
                
                if not prop.image_asset:
                    from backend.src.schema.models import ImageAsset
                    prop.image_asset = ImageAsset()
                    
                from backend.src.schema.models import ImageVariant
                variant = ImageVariant(
                    id=variant_id,
                    url=rel_path,
                    created_at=time.time(),
                    prompt_used=prompt
                )
                prop.image_asset.variants.insert(0, variant)
                
                if not prop.image_asset.selected_id or batch_size == 1:
                    prop.image_asset.selected_id = variant_id
                    prop.image_url = rel_path  # 同步旧字段

                # 如果启用了 OSS，就把文件传上去，并在数据里保存对象键
                try:
                    from ...utils.oss_utils import OSSImageUploader
                    uploader = OSSImageUploader()
                    if uploader.is_configured:
                        object_key = uploader.upload_file(output_path, sub_path="assets/props")
                        if object_key:
                            logger.debug(f"Uploaded prop variant to OSS: {object_key}")
                            variant.url = object_key
                            if prop.image_asset.selected_id == variant.id:
                                prop.image_url = object_key
                except Exception as e:
                    logger.error(f"Failed to upload prop variant to OSS: {e}")

            prop.status = GenerationStatus.COMPLETED
        except Exception as e:
            logger.error(f"Failed to generate prop {prop.name}: {e}")
            prop.status = GenerationStatus.FAILED
            raise  # 继续向上抛，让调用方知道生成失败
            
        return prop
