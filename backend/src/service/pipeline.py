from typing import Dict, Any, List, Optional, Tuple
import json
import os
import re
import time
import uuid
import subprocess
import threading
import platform
from backend.src.schema.models import Script, GenerationStatus, VideoTask, Character, Scene, StoryboardFrame, Series
from .llm import ScriptProcessor
from .assets import AssetGenerator
from .storyboard import StoryboardGenerator
from .video import VideoGenerator
from .audio import AudioGenerator
from .export import ExportManager
from ..utils import get_logger
from ..utils.oss_utils import is_object_key
from ..utils.system_check import get_ffmpeg_path, get_ffmpeg_install_instructions

logger = get_logger(__name__)

# --- 安全辅助函数 ---

# 用于文件路径和命令参数的安全 ID 规则
_SAFE_ID_RE = re.compile(r'^[a-zA-Z0-9_\-]+$')


def _validate_safe_id(value: str, label: str = "id") -> str:
    """校验 ID 是否适合放进文件路径或命令参数。"""
    if not value or not _SAFE_ID_RE.match(value):
        raise ValueError(f"Invalid {label}: contains unsafe characters")
    return value


def _safe_resolve_path(base_dir: str, untrusted_rel: str) -> str:
    """
    在给定基目录下解析相对路径，并确保结果不会逃逸出基目录。

    主要用于防止 `../../etc/passwd` 这类路径穿越。
    """
    base = os.path.realpath(base_dir)
    resolved = os.path.realpath(os.path.join(base, untrusted_rel))
    if not resolved.startswith(base + os.sep) and resolved != base:
        raise ValueError(f"Path escapes base directory: {untrusted_rel}")
    return resolved

class ComicGenPipeline:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.script_processor = ScriptProcessor()
        self.asset_generator = AssetGenerator(self.config.get('assets'))
        self.storyboard_generator = StoryboardGenerator(self.config.get('storyboard'))
        self.video_generator = VideoGenerator(self.config.get('video'))
        self.audio_generator = AudioGenerator(self.config.get('audio'))
        self.export_manager = ExportManager(self.config.get('export'))
        
        self.data_file = "output/projects.json"
        self.series_data_file = "output/series.json"
        self._save_lock = threading.RLock()  # 可重入锁，避免并发写文件互相覆盖
        self.scripts: Dict[str, Script] = self._load_data()
        self.series_store: Dict[str, Series] = self._load_series_data()
        
        # 异步素材任务的内存状态表
        self.asset_generation_tasks: Dict[str, Dict[str, Any]] = {}
        self.video_generation_tasks: Dict[str, Dict[str, Any]] = {}
        # 文件导入预览时的临时文本缓存：import_id -> text
        self._import_cache: Dict[str, str] = {}
        # 视频模型实例做懒加载缓存，避免反复初始化
        self._kling_model = None
        self._vidu_model = None

    # 其余流程方法见下方

    def export_project(self, script_id: str, options: Dict[str, Any]) -> str:
        """第 7 步：导出项目成片。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        export_url = self.export_manager.render_project(script, options)
        return export_url

    def get_script(self, script_id: str) -> Optional[Script]:
        return self.scripts.get(script_id)

    def _load_data(self) -> Dict[str, Script]:
        if not os.path.exists(self.data_file):
            return {}
        try:
            with open(self.data_file, 'r') as f:
                data = json.load(f)
                return {k: Script(**v) for k, v in data.items()}
        except Exception as e:
            logger.error(f"Failed to load data: {e}")
            return {}

    def _save_data(self):
        """带锁保存项目数据，避免并发写入冲突。"""
        with self._save_lock:
            try:
                os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
                with open(self.data_file, 'w') as f:
                    json.dump({k: v.dict() for k, v in self.scripts.items()}, f, indent=2)
            except Exception as e:
                logger.error(f"Failed to save data: {e}")

    def create_project(self, title: str, text: str, skip_analysis: bool = False) -> Script:
        """第 1 步：解析文本并创建项目。"""
        if skip_analysis:
            script = self.script_processor.create_draft_script(title, text)
        else:
            script = self.script_processor.parse_novel(title, text)
            
        self.scripts[script.id] = script
        self._save_data()
        return script
    
    def reparse_project(self, script_id: str, text: str) -> Script:
        """重新解析已有项目文本，并替换其中的实体数据。"""
        existing_script = self.scripts.get(script_id)
        if not existing_script:
            raise ValueError("Script not found")
        
        # 重新走一遍解析流程，会产生一套新的实体 ID
        new_script = self.script_processor.parse_novel(existing_script.title, text)
        
        # 保留原项目 ID 和创建时间
        new_script.id = existing_script.id
        new_script.created_at = existing_script.created_at
        new_script.updated_at = time.time()
        
        # 项目级配置不要被重置掉
        new_script.art_direction = existing_script.art_direction
        new_script.model_settings = existing_script.model_settings
        new_script.style_preset = existing_script.style_preset
        new_script.style_prompt = existing_script.style_prompt
        new_script.merged_video_url = existing_script.merged_video_url
        
        # 用新解析结果替换内存中的旧项目
        self.scripts[script_id] = new_script
        self._save_data()
        return new_script


    def generate_assets(self, script_id: str) -> Script:
        """第 2 步：批量生成素材。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        logger.info(f"Generating assets for script {script.id}")
        
        # 先生成基础角色，再生成依赖基础角色的变体
        sorted_chars = sorted(script.characters, key=lambda c: 0 if not c.base_character_id else 1)

        for char in sorted_chars:
            self.generate_asset(script_id, char.id, "character")
            
        for scene in script.scenes:
            self.generate_asset(script_id, scene.id, "scene")
            
        for prop in script.props:
            self.generate_asset(script_id, prop.id, "prop")
            
        self._save_data()
        return script

    def generate_asset(self, script_id: str, asset_id: str, asset_type: str, style_preset: str = None, reference_image_url: str = None, style_prompt: str = None, generation_type: str = "all", prompt: str = None, apply_style: bool = True, negative_prompt: str = None, batch_size: int = 1, model_name: str = None) -> Script:
        """
        第 2 步：生成单个素材。

        如果没显式传 `style_preset`，则回退到项目当前全局风格。
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 没单独指定模型时，回退到项目配置里的模型
        t2i_model = model_name or script.model_settings.t2i_model
        i2i_model = script.model_settings.i2i_model
        
        # 根据素材类型决定默认宽高比与出图尺寸
        from .assets import ASPECT_RATIO_TO_SIZE
        if asset_type == "character":
            aspect_ratio = script.model_settings.character_aspect_ratio
            default_size = "576*1024"  # 竖图
        elif asset_type == "scene":
            aspect_ratio = script.model_settings.scene_aspect_ratio
            default_size = "1024*576"  # 横图
        elif asset_type == "prop":
            aspect_ratio = script.model_settings.prop_aspect_ratio
            default_size = "1024*1024"  # 方图
        else:
            aspect_ratio = "9:16"
            default_size = "576*1024"
        
        effective_size = ASPECT_RATIO_TO_SIZE.get(aspect_ratio, default_size)
        
        # 风格优先级：Art Direction > 显式传入 > 老版 style 配置
        effective_positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""  # 优先保留调用方显式传入的负向提示词
        
        # 只有允许套风格时，才去拼风格提示词
        if apply_style:
            if script.art_direction and script.art_direction.style_config:
                # 优先使用 Art Direction 配置
                effective_positive_prompt = script.art_direction.style_config.get('positive_prompt', '')
                # 全局负向提示词和局部负向提示词拼在一起
                global_neg = script.art_direction.style_config.get('negative_prompt', '')
                if global_neg:
                    effective_negative_prompt = f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
            elif style_prompt:
                # 调用方显式传入的 style_prompt 作为人工覆盖
                effective_positive_prompt = style_prompt
            elif style_preset:
                # 兼容旧版的 style_preset
                effective_positive_prompt = f"{style_preset} style"
            elif script.style_preset:
                # 最后再回退到项目里旧版风格配置
                effective_positive_prompt = f"{script.style_preset} style"
                if script.style_prompt:
                    effective_positive_prompt += f", {script.style_prompt}"
        
        asset_list = []
        target_asset = None
        
        if asset_type == "character":
            asset_list = script.characters
        elif asset_type == "scene":
            asset_list = script.scenes
        elif asset_type == "prop":
            asset_list = script.props
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}")
        
        target_asset = next((a for a in asset_list if a.id == asset_id), None)
        if not target_asset:
            raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")
        
        target_asset.status = GenerationStatus.PROCESSING
        self._save_data()
        
        try:
            # 把计算好的风格提示词传进具体素材生成器
            if asset_type == "character":
                # `prompt` 承载主体内容，`positive_prompt` 负责补风格后缀
                self.asset_generator.generate_character(
                    target_asset, 
                    generation_type=generation_type, 
                    prompt=prompt, 
                    positive_prompt=effective_positive_prompt, # Used as style suffix if prompt is auto-generated
                    negative_prompt=effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    i2i_model_name=i2i_model,
                    size=effective_size
                )
            elif asset_type == "scene":
                self.asset_generator.generate_scene(target_asset, effective_positive_prompt, effective_negative_prompt, batch_size=batch_size, model_name=t2i_model, size=effective_size)
            elif asset_type == "prop":
                self.asset_generator.generate_prop(target_asset, effective_positive_prompt, effective_negative_prompt, batch_size=batch_size, model_name=t2i_model, size=effective_size)
                
            target_asset.status = GenerationStatus.COMPLETED
        except Exception as e:
            target_asset.status = GenerationStatus.FAILED
            raise e
        finally:
            self._save_data()
        
        return script

    def create_asset_generation_task(self, script_id: str, asset_id: str, asset_type: str, 
                                      style_preset: str = None, reference_image_url: str = None, 
                                      style_prompt: str = None, generation_type: str = "all", 
                                      prompt: str = None, apply_style: bool = True, 
                                      negative_prompt: str = None, batch_size: int = 1, 
                                      model_name: str = None) -> Tuple[Script, str]:
        """创建异步素材生成任务，并立即返回 `(script, task_id)`。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 找到目标素材，并先把状态切到处理中
        asset_list = []
        if asset_type == "character":
            asset_list = script.characters
        elif asset_type == "scene":
            asset_list = script.scenes
        elif asset_type == "prop":
            asset_list = script.props
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}")
        
        target_asset = next((a for a in asset_list if a.id == asset_id), None)
        if not target_asset:
            raise ValueError(f"{asset_type.capitalize()} {asset_id} not found")
        
        target_asset.status = GenerationStatus.PROCESSING
        
        # 记录任务状态，等待后台处理
        task_id = str(uuid.uuid4())
        self.asset_generation_tasks[task_id] = {
            "status": "pending",  # pending -> processing -> completed/failed
            "progress": 0,
            "error": None,
            "script_id": script_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "created_at": time.time(),
            # 把本次生成参数一并存起来，后台任务继续使用
            "params": {
                "style_preset": style_preset,
                "reference_image_url": reference_image_url,
                "style_prompt": style_prompt,
                "generation_type": generation_type,
                "prompt": prompt,
                "apply_style": apply_style,
                "negative_prompt": negative_prompt,
                "batch_size": batch_size,
                "model_name": model_name
            }
        }
        
        self._save_data()
        return script, task_id

    def process_asset_generation_task(self, task_id: str):
        """后台执行素材生成任务。"""
        task = self.asset_generation_tasks.get(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return

        task["status"] = "processing"

        try:
            params = task["params"]
            if task.get("is_series"):
                # 系列共享素材任务走系列数据存储
                self._process_series_asset_task(task, params)
            else:
                # 普通项目素材任务走现有项目流程
                self.generate_asset(
                    task["script_id"],
                    task["asset_id"],
                    task["asset_type"],
                    params["style_preset"],
                    params["reference_image_url"],
                    params["style_prompt"],
                    params["generation_type"],
                    params["prompt"],
                    params["apply_style"],
                    params["negative_prompt"],
                    params["batch_size"],
                    params["model_name"]
                )
            task["status"] = "completed"
            task["progress"] = 100
            logger.info(f"Task {task_id} completed successfully")
        except Exception as e:
            task["status"] = "failed"
            task["error"] = str(e)
            logger.error(f"Task {task_id} failed: {e}")

    def _process_series_asset_task(self, task: Dict, params: Dict):
        """执行系列共享素材生成任务。"""
        series_id = task["script_id"]  # 复用旧字段名，方便兼容既有任务结构
        series = self.series_store.get(series_id)
        if not series:
            raise ValueError("Series not found")

        asset_id = task["asset_id"]
        asset_type = task["asset_type"]
        positive_prompt = params.get("effective_positive_prompt", "")
        negative_prompt = params.get("effective_negative_prompt", "")
        t2i_model = params.get("t2i_model", "wan2.6-t2i")
        effective_size = params.get("effective_size", "576*1024")
        batch_size = params.get("batch_size", 1)
        generation_type = params.get("generation_type", "all")
        prompt = params.get("prompt")
        reference_image_url = params.get("reference_image_url")

        if asset_type == "character":
            target = next((c for c in series.characters if c.id == asset_id), None)
            if not target:
                raise ValueError(f"Character {asset_id} not found in series")
            self.asset_generator.generate_character(
                target, generation_type=generation_type, prompt=prompt or "",
                positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
            )
        elif asset_type == "scene":
            target = next((s for s in series.scenes if s.id == asset_id), None)
            if not target:
                raise ValueError(f"Scene {asset_id} not found in series")
            self.asset_generator.generate_scene(
                target, positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
            )
        elif asset_type == "prop":
            target = next((p for p in series.props if p.id == asset_id), None)
            if not target:
                raise ValueError(f"Prop {asset_id} not found in series")
            self.asset_generator.generate_prop(
                target, positive_prompt=positive_prompt, negative_prompt=negative_prompt,
                batch_size=batch_size, model_name=t2i_model, size=effective_size,
            )
        else:
            raise ValueError(f"Unknown asset type: {asset_type}")

        self._save_series_data()

    def get_asset_generation_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """返回素材生成任务当前状态。"""
        # 先查图片相关任务
        task = self.asset_generation_tasks.get(task_id)
        if not task:
            # 再查视频相关任务
            task = self.video_generation_tasks.get(task_id)
            
        if not task:
            return None
        
        return {
            "task_id": task_id,
            "status": task["status"],
            "progress": task.get("progress", 0),
            "error": task.get("error"),
            "asset_id": task.get("asset_id"),
            "asset_type": task.get("asset_type"),
            "script_id": task.get("script_id"),
            "created_at": task.get("created_at")
        }

    def create_motion_ref_task(self, script_id: str, asset_id: str, asset_type: str, 
                                prompt: Optional[str] = None, audio_url: Optional[str] = None, 
                                duration: int = 5, batch_size: int = 1) -> Tuple[Script, str]:
        """创建异步动作参考视频生成任务。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        task_id = str(uuid.uuid4())
        self.video_generation_tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "error": None,
            "script_id": script_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "created_at": time.time(),
            "params": {
                "prompt": prompt,
                "audio_url": audio_url,
                "duration": duration,
                "batch_size": batch_size
            }
        }
        
        self._save_data()
        return script, task_id

    def process_motion_ref_task(self, script_id: str, task_id: str):
        """后台执行动作参考视频生成任务。"""
        task = self.video_generation_tasks.get(task_id)
        if not task:
            logger.error(f"Video task {task_id} not found")
            return
            
        task["status"] = "processing"
        
        try:
            params = task["params"]
            # 直接复用同步版生成逻辑
            self.generate_motion_ref(
                script_id=script_id,
                asset_id=task["asset_id"],
                asset_type=task["asset_type"],
                prompt=params["prompt"],
                audio_url=params["audio_url"],
                duration=params["duration"],
                batch_size=params["batch_size"]
            )
            task["status"] = "completed"
            task["progress"] = 100
            logger.info(f"Video task {task_id} completed successfully")
        except Exception as e:
            task["status"] = "failed"
            task["error"] = str(e)
            logger.error(f"Video task {task_id} failed: {e}")

    def sync_descriptions_from_script_entities(self, script_id: str) -> Script:
        """
        同步脚本实体描述，并清掉已缓存提示词。

        这样前端会基于最新描述重新生成提示词；
        已经生成的图片和视频不会被删除。
        """
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 角色提示词先清空，方便前端按最新描述重新生成
        for character in script.characters:
            character.full_body_prompt = None
            character.three_view_prompt = None
            character.headshot_prompt = None
            character.video_prompt = None
        
        # 场景和道具如果也挂了提示词字段，这里一并清掉
        for scene in script.scenes:
            if hasattr(scene, 'prompt'):
                scene.prompt = None
        
        for prop in script.props:
            if hasattr(prop, 'prompt'):
                prop.prompt = None
        
        self._save_data()
        logger.info(f"Descriptions synced for script {script_id}: cleared prompts for {len(script.characters)} characters, {len(script.scenes)} scenes, {len(script.props)} props")
        return script

    def add_character(self, script_id: str, name: str, description: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_char = Character(
            id=f"char_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description
        )
        script.characters.append(new_char)
        self._save_data()
        return script

    def delete_character(self, script_id: str, char_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.characters = [c for c in script.characters if c.id != char_id]
        self._save_data()
        return script

    def add_scene(self, script_id: str, name: str, description: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_scene = Scene(
            id=f"scene_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description
        )
        script.scenes.append(new_scene)
        self._save_data()
        return script

    def delete_scene(self, script_id: str, scene_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.scenes = [s for s in script.scenes if s.id != scene_id]
        self._save_data()
        return script
    
    def toggle_asset_lock(self, script_id: str, asset_id: str, asset_type: str) -> Script:
        """切换素材锁定状态。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
            
        # 直接翻转锁定标记
        target_asset.locked = not target_asset.locked
        self._save_data()
        return script

    def toggle_frame_lock(self, script_id: str, frame_id: str) -> Script:
        """切换分镜帧锁定状态。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_frame = next((f for f in script.frames if f.id == frame_id), None)
        if not target_frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        # 直接翻转锁定标记
        target_frame.locked = not target_frame.locked
        self._save_data()
        return script

    def update_asset_image(self, script_id: str, asset_id: str, asset_type: str, image_url: str) -> Script:
        """手动更新素材图片地址。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
            
        target_asset.image_url = image_url
        # 角色场景下顺手同步 avatar_url，继续兼容旧前端读取逻辑
        if asset_type == "character":
            target_asset.avatar_url = image_url
            
        self._save_data()
        return script

    def update_asset_description(self, script_id: str, asset_id: str, asset_type: str, description: str) -> Script:
        """更新素材描述。"""
        return self.update_asset_attributes(script_id, asset_id, asset_type, {"description": description})

    def update_asset_attributes(self, script_id: str, asset_id: str, asset_type: str, attributes: Dict[str, Any]) -> Script:
        """批量更新素材字段。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
            
        # 只更新模型上真实存在的字段
        for key, value in attributes.items():
            if hasattr(target_asset, key):
                setattr(target_asset, key, value)
            else:
                logger.warning(f"Attribute {key} not found in {asset_type} model")
        
        self._save_data()
        return script

    def add_uploaded_asset_variant(
        self, 
        script_id: str, 
        asset_type: str, 
        asset_id: str, 
        upload_type: str, 
        image_url: str, 
        description: Optional[str] = None
    ) -> Script:
        """
        把上传图片登记为素材的一张新候选图。

        新图会被标记为 `is_uploaded_source=True`，
        后续可直接作为反向生成参考。
        """
        from backend.src.schema.models import ImageVariant, AssetUnit
        
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 找到目标素材
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
        
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        
        # 新建一条“上传原图”候选记录
        new_variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used=description or target_asset.description,
            is_uploaded_source=True,
            upload_type=upload_type
        )
        
        # 如果用户顺手改了描述，也一并写回
        if description:
            target_asset.description = description
        
        # 按素材位把上传图挂到对应单元
        if asset_type == "character":
            # 根据 upload_type 找到正确的角色素材位
            if upload_type == "full_body":
                target_unit = target_asset.full_body
            elif upload_type == "head_shot":
                target_unit = target_asset.head_shot
            elif upload_type == "three_views":
                target_unit = target_asset.three_views
            else:
                raise ValueError(f"Invalid upload_type for character: {upload_type}")
            
            # 对应素材单元不存在时补一个
            if target_unit is None:
                target_unit = AssetUnit()
                if upload_type == "full_body":
                    target_asset.full_body = target_unit
                elif upload_type == "head_shot":
                    target_asset.head_shot = target_unit
                elif upload_type == "three_views":
                    target_asset.three_views = target_unit
            
            # 挂进去并设为当前选中图
            target_unit.image_variants.append(new_variant)
            target_unit.selected_image_id = new_variant.id
            target_unit.image_updated_at = time.time()
            
            # === 同步旧字段，继续兼容前端老逻辑 ===
            # 旧版 ImageAsset 结构也补一份同 ID 记录
            legacy_variant = ImageVariant(
                id=new_variant.id,
                url=image_url,
                prompt_used=description or target_asset.description,
                is_uploaded_source=True,
                upload_type=upload_type
            )
            
            if upload_type == "full_body":
                # 旧版全身素材容器不存在时补一个
                if target_asset.full_body_asset is None:
                    from backend.src.schema.models import ImageAsset
                    target_asset.full_body_asset = ImageAsset()
                target_asset.full_body_asset.variants.append(legacy_variant)
                target_asset.full_body_asset.selected_id = new_variant.id
                target_asset.full_body_image_url = image_url
            elif upload_type == "head_shot":
                # 旧版头像素材容器不存在时补一个
                if target_asset.headshot_asset is None:
                    from backend.src.schema.models import ImageAsset
                    target_asset.headshot_asset = ImageAsset()
                target_asset.headshot_asset.variants.append(legacy_variant)
                target_asset.headshot_asset.selected_id = new_variant.id
                target_asset.headshot_image_url = image_url
            elif upload_type == "three_views":
                # 旧版三视图素材容器不存在时补一个
                if target_asset.three_view_asset is None:
                    from backend.src.schema.models import ImageAsset
                    target_asset.three_view_asset = ImageAsset()
                target_asset.three_view_asset.variants.append(legacy_variant)
                target_asset.three_view_asset.selected_id = new_variant.id
                target_asset.three_view_image_url = image_url
            
            logger.info(f"Added uploaded variant {new_variant.id} to character {asset_id} {upload_type}")
            
        elif asset_type in ["scene", "prop"]:
            # 场景和道具都只维护一个统一图片单元
            if not hasattr(target_asset, 'image') or target_asset.image is None:
                target_asset.image = AssetUnit()
            
            target_asset.image.image_variants.append(new_variant)
            target_asset.image.selected_image_id = new_variant.id
            target_asset.image.image_updated_at = time.time()
            
            # 同步旧 image_url 字段
            target_asset.image_url = image_url
            
            logger.info(f"Added uploaded variant {new_variant.id} to {asset_type} {asset_id}")
        
        self._save_data()
        return script

    def update_project_style(self, script_id: str, style_preset: str, style_prompt: Optional[str] = None) -> Script:
        """更新项目全局风格设置。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        script.style_preset = style_preset
        script.style_prompt = style_prompt
        script.updated_at = time.time()
        self._save_data()
        return script
    
    def save_art_direction(self, script_id: str, selected_style_id: str, style_config: Dict[str, Any], custom_styles: List[Dict[str, Any]] = None, ai_recommendations: List[Dict[str, Any]] = None) -> Script:
        """保存 Art Direction 配置。"""
        from backend.src.schema.models import ArtDirection
        
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 先组装成标准 ArtDirection 对象
        art_direction = ArtDirection(
            selected_style_id=selected_style_id,
            style_config=style_config,
            custom_styles=custom_styles or [],
            ai_recommendations=ai_recommendations or []
        )
        
        script.art_direction = art_direction
        script.updated_at = time.time()
        self._save_data()
        return script

    # === 分镜增强 v2 ===

    def analyze_text_to_frames(self, script_id: str, text: str) -> Script:
        """调用 LLM 分析文本并重建分镜帧。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        logger.info(f"Analyzing text to frames for project {script_id}")

        # 如果当前剧集挂在系列下，先把系列共享素材一起合并进来
        resolved = self.resolve_episode_assets(script)
        all_characters = resolved["characters"]
        all_scenes = resolved["scenes"]
        all_props = resolved["props"]

        # 把角色、场景、道具整理成 LLM 可消费的实体上下文
        entities_json = {
            "characters": [{"id": c.id, "name": c.name, "description": c.description} for c in all_characters],
            "scenes": [{"id": s.id, "name": s.name, "description": s.description} for s in all_scenes],
            "props": [{"id": p.id, "name": p.name, "description": p.description} for p in all_props],
        }

        # 调用 LLM 做分镜分析；解析失败时会抛可读错误
        raw_frames = self.script_processor.analyze_to_storyboard(text, entities_json)

        if not raw_frames:
            raise RuntimeError("AI 分镜分析未返回任何帧数据，请重试。")

        # 把 LLM 返回的字典转成正式 StoryboardFrame 对象
        new_frames = []
        for idx, frame_data in enumerate(raw_frames):
            # 按场景名称回查本地场景 ID
            scene_ref_name = frame_data.get("scene_ref_name", "")
            scene_id = None
            for scene in all_scenes:
                if scene.name == scene_ref_name or scene_ref_name in scene.name:
                    scene_id = scene.id
                    break
            if not scene_id and all_scenes:
                scene_id = all_scenes[0].id  # 兜底用第一个场景
            elif not scene_id:
                scene_id = str(uuid.uuid4())  # 没匹配上就先补一个占位 ID

            # 按角色名称回查本地角色 ID
            char_ref_names = frame_data.get("character_ref_names", [])
            character_ids = []
            for char_name in char_ref_names:
                for char in all_characters:
                    if char.name == char_name or char_name in char.name:
                        character_ids.append(char.id)
                        break

            # 按道具名称回查本地道具 ID
            prop_ref_names = frame_data.get("prop_ref_names", [])
            prop_ids = []
            for prop_name in prop_ref_names:
                for prop in all_props:
                    if prop.name == prop_name or prop_name in prop.name:
                        prop_ids.append(prop.id)
                        break
            
            frame = StoryboardFrame(
                id=str(uuid.uuid4()),
                scene_id=scene_id,
                character_ids=character_ids,
                prop_ids=prop_ids,
                # 动作描述统一承载人物表演和物理细节
                action_description=frame_data.get("action_description", ""),
                # 视觉氛围
                visual_atmosphere=frame_data.get("visual_atmosphere"),
                # 镜头参数
                shot_size=frame_data.get("shot_size"),
                camera_angle=frame_data.get("camera_angle", "平视"),
                camera_movement=frame_data.get("camera_movement"),
                # 对白
                dialogue=frame_data.get("dialogue"),
                speaker=frame_data.get("speaker"),
                # 初始状态
                status=GenerationStatus.PENDING
            )
            new_frames.append(frame)
        
        # 用新生成的分镜整体替换旧分镜
        script.frames = new_frames
        script.updated_at = time.time()
        
        logger.info(f"Generated {len(new_frames)} frames from text analysis")
        self._save_data()
        return script

    def refine_frame_prompt(self, script_id: str, frame_id: str, raw_prompt: str, assets: List[Dict[str, Any]], feedback: str = "") -> Dict[str, Any]:
        """调用 LLM 润色分镜提示词，并同步写回分镜帧。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        logger.debug(f"Refining prompt for frame {frame_id}")

        # 读取三级回退后的自定义提示词：分集 -> 系列 -> 系统默认
        series = self.series_store.get(script.series_id) if script.series_id else None
        custom_prompt = self.get_effective_prompt("storyboard_polish", script, series)
        # 如果命中的就是系统默认值，则传空串让下游继续用内置模板
        from .llm import DEFAULT_STORYBOARD_POLISH_PROMPT
        if custom_prompt == DEFAULT_STORYBOARD_POLISH_PROMPT:
            custom_prompt = ""

        # 调用 LLM 做提示词润色
        result = self.script_processor.polish_storyboard_prompt(raw_prompt, assets, feedback, custom_prompt)
        
        # 找到目标分镜帧并写回结果
        frame_found = False
        for frame in script.frames:
            if frame.id == frame_id:
                frame.image_prompt_cn = result.get("prompt_cn")
                frame.image_prompt_en = result.get("prompt_en")
                frame.image_prompt = result.get("prompt_en")  # Also update legacy field
                frame.updated_at = time.time()
                frame_found = True
                break
        
        if frame_found:
            self._save_data()
        
        return {
            "prompt_cn": result.get("prompt_cn"),
            "prompt_en": result.get("prompt_en"),
            "frame_updated": frame_found
        }

    def generate_storyboard(self, script_id: str) -> Script:
        """第 3 步：生成分镜图。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        script = self.storyboard_generator.generate_storyboard(script)
        self._save_data()
        return script

    def update_frame(self, script_id: str, frame_id: str, **kwargs) -> Script:
        """更新分镜帧数据，例如提示词、场景、角色等。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
        
        # 只覆盖这次显式传入的字段
        if kwargs.get('image_prompt') is not None:
            frame.image_prompt = kwargs['image_prompt']
        if kwargs.get('action_description') is not None:
            frame.action_description = kwargs['action_description']
        if kwargs.get('dialogue') is not None:
            frame.dialogue = kwargs['dialogue']
        if kwargs.get('camera_angle') is not None:
            frame.camera_angle = kwargs['camera_angle']
        if kwargs.get('scene_id') is not None:
            frame.scene_id = kwargs['scene_id']
        if kwargs.get('character_ids') is not None:
            frame.character_ids = kwargs['character_ids']
        
        self._save_data()
        return script

    def add_frame(self, script_id: str, scene_id: str = None, action_description: str = "", camera_angle: str = "medium_shot", insert_at: int = None) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        new_frame = StoryboardFrame(
            id=f"frame_{uuid.uuid4().hex[:8]}",
            scene_id=scene_id or (script.scenes[0].id if script.scenes else ""),
            character_ids=[],
            action_description=action_description,
            camera_angle=camera_angle
        )
        
        if insert_at is not None and 0 <= insert_at <= len(script.frames):
            script.frames.insert(insert_at, new_frame)
        else:
            script.frames.append(new_frame)
            
        self._save_data()
        return script

    def copy_frame(self, script_id: str, frame_id: str, insert_at: int = None) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        original_frame = next((f for f in script.frames if f.id == frame_id), None)
        if not original_frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        # 深拷贝一份，并换成新的帧 ID
        new_frame = original_frame.copy()
        new_frame.id = f"frame_{uuid.uuid4().hex[:8]}"
        new_frame.updated_at = time.time()
        # 复制分镜时保留已有内容，但锁定状态恢复成未锁定
        new_frame.locked = False
        
        if insert_at is not None and 0 <= insert_at <= len(script.frames):
            script.frames.insert(insert_at, new_frame)
        else:
            # 默认插在原帧后面
            try:
                original_index = script.frames.index(original_frame)
                script.frames.insert(original_index + 1, new_frame)
            except ValueError:
                script.frames.append(new_frame)
                
        self._save_data()
        return script

    def delete_frame(self, script_id: str, frame_id: str) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        script.frames = [f for f in script.frames if f.id != frame_id]
        self._save_data()
        return script

    def reorder_frames(self, script_id: str, frame_ids: List[str]) -> Script:
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        frame_map = {f.id: f for f in script.frames}
        new_frames = []
        for fid in frame_ids:
            if fid in frame_map:
                new_frames.append(frame_map[fid])
        
        script.frames = new_frames
        self._save_data()
        return script

    def generate_motion_ref(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,  # 'full_body' | 'head_shot' for characters; 'scene' | 'prop' for scenes and props
        prompt: Optional[str] = None,
        audio_url: Optional[str] = None,
        duration: int = 5,
        batch_size: int = 1
    ) -> Script:
        """为指定素材生成动作参考视频。"""
        from backend.src.schema.models import VideoVariant, AssetUnit, VideoTask

        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")

        # 按素材类型找到目标对象
        target_asset = None
        asset_display_name = ""

        if asset_type in ["full_body", "head_shot"]:
            # 角色素材
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            asset_display_name = "Character"
        elif asset_type == "scene":
            # 场景素材
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            asset_display_name = "Scene"
        elif asset_type == "prop":
            # 道具素材
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            asset_display_name = "Prop"
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}. Must be 'full_body', 'head_shot', 'scene', or 'prop'")

        if not target_asset:
            raise ValueError(f"{asset_display_name} {asset_id} not found")

        # 根据素材类型决定从哪里取图，以及视频要挂回哪里
        asset_unit = None  # 角色素材使用 AssetUnit 承载视频
        generated_videos = []  # 记录本轮成功生成的视频

        if asset_type in ["full_body", "head_shot"]:
            # 角色素材优先从 AssetUnit 里取当前选中图片
            asset_unit = getattr(target_asset, asset_type, None)
            # 优先用新结构里的选中图，再回退旧字段
            if asset_unit and asset_unit.selected_image_id:
                source_img = next(
                    (v for v in asset_unit.image_variants if v.id == asset_unit.selected_image_id),
                    None
                )
                source_image_url = source_img.url if source_img else (
                    target_asset.full_body_image_url if asset_type == "full_body" else target_asset.headshot_image_url
                )
            else:
                source_image_url = (
                    target_asset.full_body_image_url if asset_type == "full_body"
                    else target_asset.headshot_image_url
                )

            # 没传提示词时，自动拼一版角色动作参考提示词
            if not prompt:
                if audio_url:
                    prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {target_asset.description}. The character is speaking naturally matching the audio, with accurate lip-sync and facial expressions. Stable camera, high quality, 4k."
                else:
                    prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {target_asset.description}. Looking around, breathing, slight movement, subtle gestures. Stable camera, high quality, 4k."
        else:
            # 场景和道具直接使用主图字段
            source_image_url = target_asset.image_url
            # 没传提示词时，自动拼一版默认提示词
            if not prompt:
                if asset_type == "scene":
                    if audio_url:
                        prompt = f"Cinematic scene video reference of {target_asset.name}. {target_asset.description}. Ambient motion, lighting changes, natural elements moving, birds, clouds. Soundscape matching the audio. High quality, 4k."
                    else:
                        prompt = f"Cinematic scene video reference of {target_asset.name}. {target_asset.description}. Ambient motion, lighting changes, natural elements moving, birds, clouds. Slow pan across the scene. High quality, 4k."
                else:  # prop
                    if audio_url:
                        prompt = f"Cinematic prop video reference of {target_asset.name}. {target_asset.description}. Rotating object, detailed textures visible, ambient motion, subtle movements matching audio. High quality, 4k."
                    else:
                        prompt = f"Cinematic prop video reference of {target_asset.name}. {target_asset.description}. Rotating object, detailed textures visible, ambient motion, subtle movements. High quality, 4k."

        # 没有静态图就没法继续做图生视频
        if not source_image_url:
            raise ValueError(f"No source image available for {asset_type}. Please generate a static image first.")

        # 批量生成多条动作参考视频
        for i in range(batch_size):
            try:
                # 统一走 I2V 生成器
                video_result = self.video_generator.generate_i2v(
                    image_url=source_image_url,
                    prompt=prompt,
                    duration=duration,
                    audio_url=audio_url
                )

                if video_result and video_result.get("video_url"):
                    if asset_type in ["full_body", "head_shot"]:
                        # 角色素材挂回 AssetUnit.video_variants
                        video_variant = VideoVariant(
                            id=f"video_{uuid.uuid4().hex[:8]}",
                            url=video_result["video_url"],
                            prompt_used=prompt,
                            audio_url=audio_url,
                            source_image_id=None  # 这里先不强绑源图 ID，避免旧数据兼容复杂度
                        )
                        asset_unit.video_variants.append(video_variant)

                        # 默认选中第一条成功生成的视频
                        if not asset_unit.selected_video_id:
                            asset_unit.selected_video_id = video_variant.id

                        generated_videos.append(video_variant)
                        logger.info(f"Generated motion ref video: {video_variant.id}")
                    else:
                        # 场景和道具沿用旧版 video_assets 结构
                        video_task = VideoTask(
                            id=f"video_{uuid.uuid4().hex[:8]}",
                            project_id=script_id,
                            asset_id=asset_id,
                            image_url=source_image_url,
                            prompt=prompt,
                            status="completed",  # 这里已经是同步生成完成态
                            video_url=video_result["video_url"],
                            duration=duration,
                            created_at=time.time(),
                            generate_audio=bool(audio_url),
                            model="wan2.6-i2v",
                            generation_mode="i2v"  # 图生视频
                        )

                        # 挂到素材自己的视频列表里
                        target_asset.video_assets.append(video_task)
                        generated_videos.append(video_task)
                        logger.info(f"Generated motion ref video for {asset_type}: {video_task.id}")
            except Exception as e:
                logger.error(f"Failed to generate motion ref video for {asset_type}: {e}")

        # 角色素材额外把视频提示词和更新时间写回 AssetUnit
        if asset_type in ["full_body", "head_shot"]:
            # 某些旧数据里可能还没有 AssetUnit，这里补一下
            if asset_unit is None:
                asset_unit = AssetUnit()
                setattr(target_asset, asset_type, asset_unit)

            asset_unit.video_prompt = prompt
            asset_unit.video_updated_at = time.time()
        # 场景和道具的视频任务已在上面的循环中挂回

        if batch_size > 0 and not generated_videos:
            raise RuntimeError(f"Failed to generate any motion reference videos for {asset_type}")

        self._save_data()
        return script

    def generate_storyboard_render(self, script_id: str, frame_id: str, composition_data: Optional[Dict[str, Any]], prompt: str, batch_size: int = 1) -> Script:
        """第 3b 步：根据构图数据重绘指定分镜帧。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")
            
        frame.status = GenerationStatus.PROCESSING
        if composition_data:
            frame.composition_data = composition_data
        frame.image_prompt = prompt
        self._save_data()
        
        try:
            # 从构图数据里提取参考图地址
            ref_image_url = None
            ref_image_urls = []
            
            if composition_data:
                ref_image_url = composition_data.get('reference_image_url')
                ref_image_urls = composition_data.get('reference_image_urls', [])
            
            ref_image_paths = []
            
            # 先处理多张参考图
            for url in ref_image_urls:
                if not url:
                    continue
                if is_object_key(url) or url.startswith("http"):
                    ref_image_paths.append(url)
                else:
                    potential_path = _safe_resolve_path("output", url)
                    if os.path.exists(potential_path):
                        ref_image_paths.append(potential_path)
            
            # 再兼容旧版单图字段
            if ref_image_url and ref_image_url not in ref_image_urls:
                if is_object_key(ref_image_url) or ref_image_url.startswith("http"):
                    if ref_image_url not in ref_image_paths:
                        ref_image_paths.append(ref_image_url)
                else:
                    potential_path = _safe_resolve_path("output", ref_image_url)
                    if os.path.exists(potential_path):
                        if potential_path not in ref_image_paths:
                            ref_image_paths.append(potential_path)
            
            # 为兼容旧接口，额外保留第一张参考图单独传参
            ref_image_path = ref_image_paths[0] if ref_image_paths else None
            
            # 前端传来的提示词默认已经包含风格信息，这里不再二次改写
            final_prompt = prompt
            
            # 先把最终提示词写回分镜
            frame.image_prompt = final_prompt
            
            # 找到当前分镜对应场景
            scene = next((s for s in script.scenes if s.id == frame.scene_id), None)

            # 按分镜宽高比计算实际出图尺寸
            from .assets import ASPECT_RATIO_TO_SIZE
            storyboard_aspect_ratio = script.model_settings.storyboard_aspect_ratio
            effective_size = ASPECT_RATIO_TO_SIZE.get(storyboard_aspect_ratio, "1024*576")  # 默认横版
            
            # 分镜渲染统一走项目当前 i2i_model
            i2i_model = script.model_settings.i2i_model
            logger.info(f"Rendering frame {frame_id} using model {i2i_model} with {len(ref_image_paths)} reference images")
            if len(ref_image_urls) > 0:
                logger.debug(f"Original reference URLs from frontend: {ref_image_urls}")

            # 调用分镜生成器
            self.storyboard_generator.generate_frame(
                frame, 
                script.characters, 
                scene, 
                ref_image_path=ref_image_path,
                ref_image_paths=ref_image_paths,
                prompt=final_prompt,
                batch_size=batch_size,
                size=effective_size,
                model_name=i2i_model
            )
            
            self._save_data()
            return script
        except Exception as e:
            frame.status = GenerationStatus.FAILED
            self._save_data()
            raise e
            # 旧版占位逻辑原本计划：
            # 1. 读取 composition_data 里的素材排布
            # 2. 先合成控制图
            # 3. 再配合提示词走图生图
            
            logger.debug(f"Rendering frame {frame_id} with prompt: {prompt}")
            time.sleep(1.5)  # 占位耗时
            
            # 占位结果
            mock_url = f"https://placehold.co/1280x720/2a2a2a/FFF?text=Rendered+Frame+{frame_id}"
            frame.rendered_image_url = mock_url
            frame.image_url = mock_url  # 主图也同步到占位渲染图
            frame.status = GenerationStatus.COMPLETED
            
        except Exception as e:
            logger.error(f"Frame rendering failed: {e}")
            frame.status = GenerationStatus.FAILED
            
        self._save_data()
        return script

    def generate_video(self, script_id: str) -> Script:
        """第 4 步：生成视频片段。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        script = self.video_generator.generate_video(script)
        self._save_data()
        return script

    def create_video_task(self, script_id: str, image_url: str, prompt: str, duration: int = 5, seed: int = None, resolution: str = "720p", generate_audio: bool = False, audio_url: str = None, prompt_extend: bool = True, negative_prompt: str = None, model: str = "wan2.6-i2v", frame_id: str = None, shot_type: str = "single", generation_mode: str = "i2v", reference_video_urls: list = None, mode: str = None, sound: str = None, cfg_scale: float = None, vidu_audio: bool = None, movement_amplitude: str = None) -> Tuple[Script, str]:
        """创建一条新的视频生成任务。"""
        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")
        
        task_id = str(uuid.uuid4())
        
        # 参考视频生视频模式固定切到对应模型
        if generation_mode == "r2v":
            model = "wan2.6-r2v"
        
        # 先给输入图片做一份快照，避免后续源文件被覆盖导致结果不一致
        snapshot_url = image_url
        try:
            # 解析源图路径
            if image_url and not image_url.startswith("http"):
                # 默认按 output 目录下的相对路径处理
                src_path = _safe_resolve_path("output", image_url)
                if os.path.exists(src_path) and os.path.isfile(src_path):
                    # 快照目录不存在时先创建
                    snapshot_dir = os.path.join("output", "video_inputs")
                    os.makedirs(snapshot_dir, exist_ok=True)

                    # 生成快照文件名与路径
                    ext = os.path.splitext(os.path.basename(image_url))[1] or ".png"
                    _validate_safe_id(task_id, "task_id")
                    snapshot_filename = f"{task_id}{ext}"
                    snapshot_path = _safe_resolve_path(snapshot_dir, snapshot_filename)
                    
                    # 物理拷贝一份快照文件
                    import shutil
                    shutil.copy2(src_path, snapshot_path)
                    
                    # 更新成快照对应的相对路径
                    snapshot_url = f"video_inputs/{snapshot_filename}"
        except Exception as e:
            logger.error(f"Failed to snapshot input image: {e}")
            # 快照失败时继续使用原图地址

        task = VideoTask(
            id=task_id,
            project_id=script_id,
            frame_id=frame_id,
            image_url=snapshot_url,
            prompt=prompt,
            status="pending",
            duration=duration,
            seed=seed,
            resolution=resolution,
            generate_audio=generate_audio,
            audio_url=audio_url,
            prompt_extend=prompt_extend,
            negative_prompt=negative_prompt,
            model=model,
            shot_type=shot_type,
            generation_mode=generation_mode,
            reference_video_urls=reference_video_urls or [],
            mode=mode,
            sound=sound,
            cfg_scale=cfg_scale,
            vidu_audio=vidu_audio,
            movement_amplitude=movement_amplitude,
            created_at=time.time()
        )
        
        if not script.video_tasks:
            script.video_tasks = []
        script.video_tasks.append(task)
        
        self._save_data()
        return script, task_id

    def extract_last_frame(self, script_id: str, frame_id: str, video_task_id: str) -> Script:
        """从视频任务中抽取最后一帧，并加入分镜渲染图候选列表。"""
        from backend.src.schema.models import ImageVariant, ImageAsset

        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        # 找到目标视频任务
        video_task = next((t for t in script.video_tasks if t.id == video_task_id), None)
        if not video_task or video_task.status != "completed" or not video_task.video_url:
            raise ValueError("Video task not found or not completed")

        # 把视频地址整理成本地可读取路径
        video_path = video_task.video_url
        if not video_path.startswith("/") and not video_path.startswith("http"):
            video_path = _safe_resolve_path("output", video_path)

        if video_path.startswith("http"):
            # 远程地址先下载到临时文件
            video_path = self._download_temp_image(video_path)

        if not os.path.exists(video_path):
            raise ValueError(f"Video file not found: {video_path}")

        # 调用 FFmpeg 抽最后一帧
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg is required for frame extraction but was not found.")

        output_dir = os.path.join("output", "storyboard")
        os.makedirs(output_dir, exist_ok=True)
        _validate_safe_id(frame_id, "frame_id")
        output_filename = f"frame_{frame_id}_lastframe_{uuid.uuid4().hex[:8]}.jpg"
        output_path = _safe_resolve_path(output_dir, output_filename)

        cmd = [
            ffmpeg_path, "-sseof", "-0.1",
            "-i", video_path,
            "-frames:v", "1",
            "-q:v", "2",
            "-y", output_path
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg error: {result.stderr}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("FFmpeg frame extraction timed out")

        if not os.path.exists(output_path):
            raise RuntimeError("Failed to extract last frame from video")

        # 如果启用了 OSS，就把抽帧图上传并保存对象键
        from ...utils.oss_utils import OSSImageUploader
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(output_path)
        image_url = oss_url if oss_url else os.path.relpath(output_path, "output")

        # 把抽出的帧登记成一张新的候选图
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="Extracted last frame from video",
            is_uploaded_source=True,
            upload_type="image",
        )

        # 渲染图容器不存在时补一个
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset()

        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        # 同步主渲染图字段，便于后续视频流程直接取用
        frame.rendered_image_url = image_url

        script.updated_at = time.time()
        self._save_data()
        return script

    def upload_frame_image(self, script_id: str, frame_id: str, image_path: str) -> Script:
        """把用户上传图片加入分镜渲染图候选列表。"""
        from backend.src.schema.models import ImageVariant, ImageAsset

        # 限定上传文件必须位于 output 目录内，避免越权路径
        safe_path = _safe_resolve_path("output", os.path.relpath(image_path, "output") if os.path.isabs(image_path) else image_path)

        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")

        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        # 如果启用了 OSS，就先上传再记录对象键
        from ...utils.oss_utils import OSSImageUploader
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(safe_path)
        image_url = oss_url if oss_url else os.path.relpath(safe_path, "output")

        # 新建一条候选图记录
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="User uploaded image",
            is_uploaded_source=True,
            upload_type="image",
        )

        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset()

        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        # 同步主渲染图字段，便于后续视频流程直接取用
        frame.rendered_image_url = image_url

        script.updated_at = time.time()
        self._save_data()
        return script

    def _download_temp_image(self, url: str) -> str:
        """把图片下载到临时文件，并返回本地路径。"""
        import requests
        import tempfile
        
        # 本地相对路径直接还原成真实文件路径
        if not url.startswith("http"):
            local_path = _safe_resolve_path("output", url)
            if os.path.exists(local_path):
                return local_path
                
        # 远程 URL 走下载流程
        try:
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            # 创建临时文件承接下载内容
            fd, path = tempfile.mkstemp(suffix=".png")
            with os.fdopen(fd, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return path
        except Exception as e:
            logger.error(f"Failed to download image: {e}")
            raise
    def select_video_for_frame(self, script_id: str, frame_id: str, video_id: str) -> Script:
        """第 5a 步：为分镜帧选中某条视频。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
            
        # 确认目标视频确实存在于当前项目
        video = next((v for v in script.video_tasks if v.id == video_id), None)
        if not video:
            raise ValueError("Video task not found")
            
        frame.selected_video_id = video_id
        
        # 同步写回 frame.video_url，方便前端直接读
        frame.video_url = video.video_url
        
        self._save_data()
        return script

    def merge_videos(self, script_id: str) -> Script:
        """第 5b 步：把已选视频合成为一条成片。"""
        _validate_safe_id(script_id, "script_id")
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        logger.info(f"[MERGE] Starting video merge for script {script_id}")
        
        # 先检查 FFmpeg 是否可用，优先使用随应用打包的版本
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            install_instructions = get_ffmpeg_install_instructions()
            error_msg = (
                "FFmpeg is required for video merging but was not found.\n\n"
                f"{install_instructions}\n\n"
                "After installation, restart the application."
            )
            logger.error(f"[MERGE] FFmpeg not found. {error_msg}")
            raise RuntimeError(error_msg)
        
        # 打印 FFmpeg 版本，方便排查环境问题
        try:
            version_result = subprocess.run(
                [ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if version_result.returncode == 0:
                version_line = version_result.stdout.split('\n')[0] if version_result.stdout else "Unknown"
                logger.debug(f"[MERGE] Using FFmpeg: {version_line}")
                logger.debug(f"[MERGE] FFmpeg path: {ffmpeg_path}")
            else:
                logger.warning(f"[MERGE] Could not get FFmpeg version (exit code {version_result.returncode})")
        except Exception as e:
            logger.warning(f"[MERGE] Could not get FFmpeg version: {e}")
            
        # 收集每一帧最终要参与合成的视频路径
        video_paths = []
        for i, frame in enumerate(script.frames):
            logger.info(f"[MERGE] Processing frame {i+1}/{len(script.frames)}: {frame.id}")
            
            if not frame.selected_video_id:
                # 没显式选中时，兜底找一条已完成的视频
                default_video = next((v for v in script.video_tasks if v.frame_id == frame.id and v.status == "completed"), None)
                if default_video and default_video.video_url:
                    logger.debug(f"[MERGE]   -> Using default video: {default_video.video_url}")
                    video_paths.append(default_video.video_url)
                else:
                    logger.warning(f"[MERGE]   -> No video selected or available, skipping")
                continue
                
            video = next((v for v in script.video_tasks if v.id == frame.selected_video_id), None)
            if video and video.video_url:
                logger.debug(f"[MERGE]   -> Selected video: {video.video_url}")
                video_paths.append(video.video_url)
            else:
                logger.warning(f"[MERGE]   -> Selected video {frame.selected_video_id} not found or has no URL")
                
        if not video_paths:
            logger.error("[MERGE] No videos found to merge!")
            raise ValueError("No videos selected to merge. Please select videos for each frame first.")
        
        logger.info(f"[MERGE] Found {len(video_paths)} videos to merge")
            
        # 生成 FFmpeg concat 所需的文件列表
        list_path = _safe_resolve_path("output", f"merge_list_{script_id}.txt")
        abs_video_paths = []

        with open(list_path, "w") as f:
            for path in video_paths:
                # 统一还原成绝对路径
                if not path.startswith("http"):
                    abs_path = _safe_resolve_path("output", path)
                    if os.path.exists(abs_path):
                        f.write(f"file '{abs_path}'\n")
                        abs_video_paths.append(abs_path)
                        logger.debug(f"[MERGE] Added to list: {abs_path}")
                    else:
                        logger.warning(f"[MERGE] Video file not found: {abs_path}")
                        
        if not abs_video_paths:
            logger.error("[MERGE] No valid video files found on disk!")
            raise ValueError("No valid video files found. The video files may have been deleted or moved.")
        
        logger.info(f"[MERGE] Merge list created with {len(abs_video_paths)} videos")

        # 最终输出路径
        output_filename = f"merged_{script_id}_{int(time.time())}.mp4"
        output_path = _safe_resolve_path(os.path.join("output", "video"), output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        logger.debug(f"[MERGE] Output path: {output_path}")
        
        # 顺手记录输入文件体积，方便排查问题
        for i, path in enumerate(abs_video_paths):
            try:
                size_mb = os.path.getsize(path) / (1024 * 1024)
                logger.debug(f"[MERGE] Input video {i+1}: {os.path.basename(path)} ({size_mb:.2f} MB)")
            except Exception as e:
                logger.warning(f"[MERGE] Could not get size for video {i+1}: {e}")
        
        # 执行 FFmpeg 合成
        # 这里选择重编码，虽然更慢，但兼容性更稳
        cmd = [
            ffmpeg_path, "-y",  # Use the detected ffmpeg path
            "-f", "concat",
            "-safe", "0",
            "-i", list_path,
            "-c:v", "libx264",  # 视频统一转 H.264
            "-crf", "23",       # 画质参数，越低越清晰
            "-preset", "fast",  # 编码速度与体积的折中
            "-c:a", "aac",      # 音频统一转 AAC
            "-b:a", "128k",     # 音频码率
            "-movflags", "+faststart",  # 优化网页首帧加载
            output_path
        ]
        
        logger.debug(f"[MERGE] Running FFmpeg command: {' '.join(cmd)}")
        logger.debug(f"[MERGE] Platform: {platform.system()} {platform.release()}")
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, timeout=600)  # 重编码可能比较慢，这里给 10 分钟
            logger.debug(f"[MERGE] FFmpeg stdout: {result.stdout.decode()[:500] if result.stdout else 'empty'}")
            logger.info(f"[MERGE] FFmpeg completed successfully")
            
            # 写回合成后的视频路径
            # 这里用 `videos/`，和 `/files/videos` 路由保持一致
            script.merged_video_url = f"videos/{output_filename}"
            
            # 校验产物是否真的落盘成功
            if os.path.exists(output_path):
                file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
                logger.info(f"[MERGE] ✅ Merged video created successfully: {output_filename} ({file_size_mb:.2f} MB)")
                logger.info(f"[MERGE] ✅ Video accessible at: /files/videos/{output_filename}")
            else:
                logger.error(f"[MERGE] ❌ Merged video file NOT found at: {output_path}")
                raise RuntimeError(f"Video merge completed but output file not found: {output_path}")
                
            self._save_data()
            
            # 合成结束后删掉临时文件列表
            if os.path.exists(list_path):
                os.remove(list_path)
                
            return script
        except subprocess.TimeoutExpired:
            logger.error("[MERGE] FFmpeg timed out after 600 seconds")
            raise RuntimeError("FFmpeg timed out. The videos may be too large.")
        except subprocess.CalledProcessError as e:
            stderr_msg = e.stderr.decode() if e.stderr else "No error output"
            stdout_msg = e.stdout.decode() if e.stdout else "No output"
            
            # 失败时尽量把上下文打全，便于排查
            logger.error(f"[MERGE] FFmpeg failed with exit code {e.returncode}")
            logger.error(f"[MERGE] FFmpeg command: {' '.join(cmd)}")
            logger.error(f"[MERGE] FFmpeg stderr: {stderr_msg}")
            logger.error(f"[MERGE] FFmpeg stdout: {stdout_msg}")
            logger.error(f"[MERGE] Video files attempted: {[os.path.basename(p) for p in abs_video_paths]}")
            
            # 再抽一版更适合展示给用户的错误信息
            user_msg = self._extract_ffmpeg_error_message(stderr_msg, abs_video_paths)
            raise RuntimeError(user_msg)
    
    def _extract_ffmpeg_error_message(self, stderr: str, video_paths: List[str]) -> str:
        """从 FFmpeg stderr 中提取更适合展示给用户的错误提示。"""
        if not stderr:
            return "FFmpeg merge failed with no error output. Please check the log files."
        
        stderr_lower = stderr.lower()
        
        # 常见错误模式优先做定制化翻译
        if "no such file or directory" in stderr_lower:
            return (
                "One or more video files could not be found.\n"
                "The videos may have been deleted or moved.\n"
                "Please try regenerating the missing videos."
            )
        
        if "invalid data found" in stderr_lower or "invalid file" in stderr_lower or "moov atom not found" in stderr_lower:
            return (
                "One or more video files are corrupted or incomplete.\n"
                "This can happen if video generation was interrupted.\n"
                "Please try regenerating the affected videos."
            )
        
        if ("codec" in stderr_lower and ("not supported" in stderr_lower or "unknown" in stderr_lower)):
            return (
                "Video codec compatibility issue detected.\n"
                "The video format may not be supported by your FFmpeg installation.\n"
                "Try updating FFmpeg to the latest version."
            )
        
        if "permission denied" in stderr_lower or "access is denied" in stderr_lower:
            return (
                "Permission denied when accessing video files.\n"
                "Please check that the application has read/write permissions\n"
                "for the output directory."
            )
        
        if "disk full" in stderr_lower or "no space" in stderr_lower:
            return (
                "Insufficient disk space to create the merged video.\n"
                "Please free up some space and try again."
            )
        
        if "height not divisible" in stderr_lower or "width not divisible" in stderr_lower:
            return (
                "Video resolution compatibility issue.\n"
                "The videos have incompatible dimensions.\n"
                "This should not happen - please report this issue."
            )
        
        if "invalid argument" in stderr_lower:
            # 进一步判断是否和 concat 文件列表有关
            if any("filelist" in line.lower() or "concat" in line.lower() for line in stderr.split('\n')):
                return (
                    "FFmpeg could not read the video file list.\n"
                    "This might be a file path encoding issue.\n"
                    "Please ensure video filenames don't contain special characters."
                )
        
        # 最后兜底：尽量摘取一行最像错误原因的内容
        error_lines = [line.strip() for line in stderr.split('\n') if line.strip()]
        if error_lines:
            # 从后往前找，优先挑真正像报错的那一行
            for line in reversed(error_lines):
                line_lower = line.lower()
                if any(keyword in line_lower for keyword in ['error', 'failed', 'invalid', 'cannot', 'unable']):
                    # 太长就裁一下，避免直接把整段 ffmpeg 输出甩给用户
                    if len(line) > 200:
                        line = line[:200] + "..."
                    return f"FFmpeg error: {line}\n\nPlease check the application logs for more details."
            
            # 实在找不到明显错误行，就退回最后一行
            last_line = error_lines[-1]
            if len(last_line) > 200:
                last_line = last_line[:200] + "..."
            return f"FFmpeg merge failed: {last_line}\n\nPlease check the application logs for more details."
        
        return "FFmpeg merge failed with unknown error. Please check the application logs for details."

    def create_asset_video_task(self, script_id: str, asset_id: str, asset_type: str, prompt: str, duration: int = 5, aspect_ratio: str = None) -> Tuple[Script, str]:
        """为素材创建一条视频生成任务（R2V）。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        # 先找到目标素材
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
            
        # 以素材主图作为参考输入
        image_url = target_asset.image_url
        if not image_url:
             # 角色素材再额外回退到全身图或头像
             if asset_type == "character":
                 image_url = target_asset.full_body_image_url or target_asset.avatar_url
        
        if not image_url:
            raise ValueError("Asset has no reference image")

        # 把视频提示词写回素材，方便下次继续编辑
        if prompt:
            target_asset.video_prompt = prompt
            
        task_id = str(uuid.uuid4())
        
        # 创建任务对象
        task = VideoTask(
            id=task_id,
            project_id=script_id,
            asset_id=asset_id,  # 记录它属于哪个素材
            image_url=image_url,
            prompt=prompt or f"Cinematic shot of {target_asset.name}",
            status="pending",
            duration=duration,
            model="wan2.6-r2v",  # 这里固定走 R2V
            created_at=time.time()
        )
        
        # 全局视频任务列表里也存一份，方便统一查询
        if not script.video_tasks:
            script.video_tasks = []
        script.video_tasks.append(task)
        
        # 素材自己的视频列表里也挂一份
        if not target_asset.video_assets:
            target_asset.video_assets = []
        target_asset.video_assets.append(task)
        
        self._save_data()
        return script, task_id

    def process_video_task(self, script_id: str, task_id: str):
        """执行单条视频生成任务。"""
        script = self.get_script(script_id)
        if not script:
            logger.error(f"Script {script_id} not found for task {task_id}")
            return
            
        task = next((t for t in script.video_tasks if t.id == task_id), None)
        
        if not task:
            logger.error(f"Task {task_id} not found in script {script_id}")
            return

        try:
            # 先把状态切到处理中
            task.status = "processing"
            self._save_data()
            
            # 如果源图是远程地址，先下载到临时文件
            img_path = None
            if task.image_url:
                img_path = self._download_temp_image(task.image_url)
            
            # 准备输出路径并开始生成
            output_filename = f"video_{task_id}.mp4"
            output_path = os.path.join("output", "video", output_filename)
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            # 统一整理音频相关逻辑：
            # 1. 静音：audio_url=None, audio=False
            # 2. AI 自动配音：audio_url=None, audio=True
            # 3. 音频驱动：audio_url=URL，audio 参数不再生效
            
            final_audio_url = None
            final_generate_audio = False
            
            if task.audio_url:
                # 音频驱动模式
                final_audio_url = task.audio_url
                final_generate_audio = False  # 显式关掉自动配音，避免语义混淆
            elif task.generate_audio:
                # 自动配音模式
                final_audio_url = None
                final_generate_audio = True
            else:
                # 静音模式
                final_audio_url = None
                final_generate_audio = False

            # 保留原始 image_url，便于底层模型按 OSS / URL 逻辑处理
            img_url = task.image_url

            # 根据模型前缀把任务路由到具体实现
            model_prefix = (task.model or "").split("-")[0] if task.model else ""

            if model_prefix in ("kling",):
                # Kling 实例做缓存复用
                if self._kling_model is None:
                    from ...models.kling import KlingModel
                    self._kling_model = KlingModel({})
                video_path, _ = self._kling_model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_url=img_url,
                    img_path=img_path,
                    duration=task.duration,
                    model=task.model,
                    negative_prompt=task.negative_prompt,
                    aspect_ratio="16:9",
                    mode=task.mode or "std",
                    sound=task.sound or "off",
                    cfg_scale=task.cfg_scale,
                )
            elif model_prefix in ("vidu", "viduq2", "viduq3"):
                # Vidu 实例做缓存复用
                if self._vidu_model is None:
                    from ...models.vidu import ViduModel
                    self._vidu_model = ViduModel({})
                video_path, _ = self._vidu_model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_url=img_url,
                    img_path=img_path,
                    duration=task.duration,
                    model=task.model,
                    resolution=task.resolution,
                    aspect_ratio="16:9",
                    seed=task.seed or 0,
                    audio=task.vidu_audio if task.vidu_audio is not None else True,
                    movement_amplitude=task.movement_amplitude or "auto",
                )
            else:
                # 其他情况默认走 Wanx
                video_path, _ = self.video_generator.model.generate(
                    prompt=task.prompt,
                    output_path=output_path,
                    img_path=img_path,
                    img_url=img_url,
                    duration=task.duration,
                    seed=task.seed,
                    resolution=task.resolution,
                    # 透传任务上的附加参数
                    audio_url=final_audio_url,
                    audio=final_generate_audio,
                    prompt_extend=task.prompt_extend,
                    negative_prompt=task.negative_prompt,
                    model=task.model,
                    shot_type=task.shot_type,
                    ref_video_urls=task.reference_video_urls if task.generation_mode == "r2v" else None,
                    camera_motion=None,
                    subject_motion=None
                )
            
            task.video_url = os.path.relpath(output_path, "output")
            task.status = "completed"
            
            # 如果这条视频属于某个素材，也把最新状态同步回素材对象
            if task.asset_id:
                self._sync_asset_video_task(script, task)
            
        except Exception as e:
            import traceback
            logger.exception("Failed to process video task")
            logger.error(f"Video generation failed: {e}")
            task.status = "failed"
            if task.asset_id:
                self._sync_asset_video_task(script, task)
            
        self._save_data()

    def _sync_asset_video_task(self, script: Script, task: VideoTask):
        """把任务最新状态同步回素材自己的 video_assets 列表。"""
        target_asset = None
        # 在三类素材里逐一查找归属对象
        for char in script.characters:
            if char.id == task.asset_id:
                target_asset = char
                break
        if not target_asset:
            for scene in script.scenes:
                if scene.id == task.asset_id:
                    target_asset = scene
                    break
        if not target_asset:
            for prop in script.props:
                if prop.id == task.asset_id:
                    target_asset = prop
                    break
        
        if target_asset:
            # 找到就原位更新；实在找不到再兜底追加
            for i, t in enumerate(target_asset.video_assets):
                if t.id == task.id:
                    target_asset.video_assets[i] = task
                    break
            else:
                # 理论上不该走到这里，但兜底补进去更稳妥
                target_asset.video_assets.append(task)

    def create_asset_video_task(self, script_id: str, asset_id: str, asset_type: str, prompt: str = None, duration: int = 5, aspect_ratio: str = None) -> Tuple[Script, str]:
        """为素材创建一条视频生成任务（I2V）。"""
        script = self.get_script(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            # 角色视频优先用全身图，没有再回退到主图
            image_url = target_asset.full_body_image_url or target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, looking around, breathing, slight movement, high quality, 4k"
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            image_url = target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, ambient motion, lighting change, high quality, 4k"
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            image_url = target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, rotating slowly, high quality, 4k"
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}")
            
        if not target_asset:
            raise ValueError(f"Asset {asset_id} not found")
            
        if not image_url:
            raise ValueError(f"Asset {asset_id} has no image to generate video from")

        # 复用现有任务结构，但额外带上 asset_id 关联
        task_id = str(uuid.uuid4())
        
        # 这里也做一份输入图快照，和普通视频任务保持一致
        snapshot_url = image_url
        try:
            if not image_url.startswith("http"):
                src_path = os.path.join("output", image_url)
                if os.path.exists(src_path):
                    snapshot_dir = os.path.join("output", "video_inputs")
                    os.makedirs(snapshot_dir, exist_ok=True)
                    ext = os.path.splitext(image_url)[1] or ".png"
                    snapshot_filename = f"{task_id}{ext}"
                    snapshot_path = os.path.join(snapshot_dir, snapshot_filename)
                    import shutil
                    shutil.copy2(src_path, snapshot_path)
                    snapshot_url = f"video_inputs/{snapshot_filename}"
        except Exception:
            pass

        # 目前先统一用 720p，后续再细化 aspect_ratio 到 resolution 的映射
        resolution = "720p"
        
        task = VideoTask(
            id=task_id,
            project_id=script_id,
            asset_id=asset_id,
            image_url=snapshot_url,
            prompt=prompt,
            status="pending",
            duration=duration,
            resolution=resolution,
            model="wan2.6-i2v",  # 素材视频固定走 I2V
            created_at=time.time()
        )
        
        # 全局视频任务列表里也存一份
        if not script.video_tasks:
            script.video_tasks = []
        script.video_tasks.append(task)
        
        # 素材自己的视频列表里也挂一份
        target_asset.video_assets.append(task)
        
        self._save_data()
        return script, task_id

    def delete_asset_video(self, script_id: str, asset_id: str, asset_type: str, video_id: str) -> Script:
        """删除素材下的一条视频。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        # 先找到目标素材
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
        
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        
        # 先把任务对象找到，后面删文件时还要用到 video_url
        video_task_to_delete = None
        if script.video_tasks:
            video_task_to_delete = next((v for v in script.video_tasks if v.id == video_id), None)
        
        # 从素材自己的视频列表里移除
        if target_asset.video_assets:
            original_len = len(target_asset.video_assets)
            target_asset.video_assets = [v for v in target_asset.video_assets if v.id != video_id]
            if len(target_asset.video_assets) == original_len and not video_task_to_delete:
                 # 素材列表里没找到，但全局列表里可能还在；这里先不硬报错
                 pass

        # 全局视频任务列表里也删掉
        if script.video_tasks:
            script.video_tasks = [v for v in script.video_tasks if v.id != video_id]
        
        # 顺手尝试删掉对应的视频文件
        try:
            if video_task_to_delete and video_task_to_delete.video_url:
                video_path = os.path.join("output", video_task_to_delete.video_url)
                if os.path.exists(video_path):
                    os.remove(video_path)
                    logger.info(f"Deleted video file: {video_path}")
        except Exception as e:
            logger.warning(f"Failed to delete video file: {e}")
        
        self._save_data()
        return script

    def generate_audio(self, script_id: str) -> Script:
        """第 5 步：生成对白、音效和背景音乐。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
            logger.info(f"Generating audio for script {script.id}")
        
        for frame in script.frames:
            # 先生成对白
            if frame.dialogue:
                speaker = None
                if frame.character_ids:
                    speaker = next((c for c in script.characters if c.id == frame.character_ids[0]), None)
                
                if speaker:
                    self.audio_generator.generate_dialogue(
                        frame, speaker,
                        speed=speaker.voice_speed,
                        pitch=speaker.voice_pitch,
                        volume=speaker.voice_volume
                    )
            
            # 再根据动作文本生成音效
            if frame.action_description:
                self.audio_generator.generate_sfx(frame)
                
            # 如果已经有视频，也额外尝试做一版视频驱动音效
            if frame.video_url:
                self.audio_generator.generate_sfx_from_video(frame)
                
            # 背景音乐先按每帧都生成的简单逻辑处理
            self.audio_generator.generate_bgm(frame)
                
        self._save_data()
        return script

    def generate_dialogue_line(self, script_id: str, frame_id: str, speed: float = 1.0, pitch: float = 1.0, volume: int = 50) -> Script:
        """按指定参数为单句对白生成音频。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        frame = next((f for f in script.frames if f.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
            
        if frame.dialogue:
            speaker = None
            if frame.character_ids:
                speaker = next((c for c in script.characters if c.id == frame.character_ids[0]), None)
            
            if speaker:
                self.audio_generator.generate_dialogue(frame, speaker, speed, pitch, volume)
                
        self._save_data()
        return script

    def bind_voice(self, script_id: str, char_id: str, voice_id: str, voice_name: str) -> Script:
        """给角色绑定语音。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        char = next((c for c in script.characters if c.id == char_id), None)
        if not char:
            raise ValueError("Character not found")
            
        char.voice_id = voice_id
        char.voice_name = voice_name
        self._save_data()
        return script

    def get_script(self, script_id: str) -> Optional[Script]:
        return self.scripts.get(script_id)

    def _select_variant_in_asset(self, image_asset: Any, variant_id: str) -> Any:
        """在 ImageAsset 中选中一张候选图，并返回该候选项。"""
        if not image_asset or not image_asset.variants:
            return None
            
        for variant in image_asset.variants:
            if variant.id == variant_id:
                image_asset.selected_id = variant_id
                return variant
        return None

    def _delete_variant_in_asset(self, image_asset: Any, variant_id: str) -> bool:
        """从 ImageAsset 中删除一张候选图；删成功返回 True。"""
        if not image_asset or not image_asset.variants:
            return False
            
        initial_len = len(image_asset.variants)
        image_asset.variants = [v for v in image_asset.variants if v.id != variant_id]
        
        if len(image_asset.variants) < initial_len:
            # 如果删掉的是当前选中图，就回退到最后一张或置空
            if image_asset.selected_id == variant_id:
                if image_asset.variants:
                    image_asset.selected_id = image_asset.variants[-1].id
                else:
                    image_asset.selected_id = None
            return True
        return False

    def select_asset_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str = None) -> Script:
        """把某张候选图设为素材当前选中版本。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            if target_asset:
                # 指定了 generation_type 时，只在对应素材位里选
                if generation_type == "full_body":
                    variant = self._select_variant_in_asset(target_asset.full_body_asset, variant_id)
                    if variant:
                        target_asset.full_body_image_url = variant.url
                        target_asset.image_url = variant.url  # 同步旧字段
                elif generation_type == "three_view":
                    variant = self._select_variant_in_asset(target_asset.three_view_asset, variant_id)
                    if variant:
                        target_asset.three_view_image_url = variant.url
                elif generation_type == "headshot":
                    variant = self._select_variant_in_asset(target_asset.headshot_asset, variant_id)
                    if variant:
                        target_asset.headshot_image_url = variant.url
                        target_asset.avatar_url = variant.url  # 同步旧头像字段
                else:
                    # 兼容旧逻辑：没指明素材位时依次在三类角色图里找
                    variant = self._select_variant_in_asset(target_asset.full_body_asset, variant_id)
                    if variant:
                        target_asset.full_body_image_url = variant.url
                        target_asset.image_url = variant.url
                    
                    if not variant:
                        variant = self._select_variant_in_asset(target_asset.three_view_asset, variant_id)
                        if variant:
                            target_asset.three_view_image_url = variant.url
                    
                    if not variant:
                        variant = self._select_variant_in_asset(target_asset.headshot_asset, variant_id)
                        if variant:
                            target_asset.headshot_image_url = variant.url
                            target_asset.avatar_url = variant.url
                        
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            if target_asset:
                variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                if variant:
                    target_asset.image_url = variant.url

        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            if target_asset:
                variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                if variant:
                    target_asset.image_url = variant.url

        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                # 先尝试在渲染图列表里选
                variant = self._select_variant_in_asset(target_asset.rendered_image_asset, variant_id)
                if variant:
                    target_asset.rendered_image_url = variant.url
                    target_asset.image_url = variant.url  # 主图默认跟随渲染图
                
                # 兼容草图列表
                if not variant:
                    variant = self._select_variant_in_asset(target_asset.image_asset, variant_id)
                    # 这里先不主动改主图逻辑，仍默认渲染图优先
        
        self._save_data()
        return script

    def delete_asset_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str) -> Script:
        """删除素材下的一张候选图。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
            
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            if target_asset:
                if self._delete_variant_in_asset(target_asset.full_body_asset, variant_id):
                    # 选中图变化后同步旧字段
                    if target_asset.full_body_asset.selected_id:
                        selected = next((v for v in target_asset.full_body_asset.variants if v.id == target_asset.full_body_asset.selected_id), None)
                        target_asset.image_url = selected.url if selected else None
                    else:
                        target_asset.image_url = None
                
                elif self._delete_variant_in_asset(target_asset.three_view_asset, variant_id):
                    if target_asset.three_view_asset.selected_id:
                        selected = next((v for v in target_asset.three_view_asset.variants if v.id == target_asset.three_view_asset.selected_id), None)
                        target_asset.three_view_image_url = selected.url if selected else None
                    else:
                        target_asset.three_view_image_url = None

                elif self._delete_variant_in_asset(target_asset.headshot_asset, variant_id):
                    if target_asset.headshot_asset.selected_id:
                        selected = next((v for v in target_asset.headshot_asset.variants if v.id == target_asset.headshot_asset.selected_id), None)
                        target_asset.headshot_image_url = selected.url if selected else None
                    else:
                        target_asset.headshot_image_url = None

        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            if target_asset and self._delete_variant_in_asset(target_asset.image_asset, variant_id):
                if target_asset.image_asset.selected_id:
                    selected = next((v for v in target_asset.image_asset.variants if v.id == target_asset.image_asset.selected_id), None)
                    target_asset.image_url = selected.url if selected else None
                else:
                    target_asset.image_url = None

        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            if target_asset and self._delete_variant_in_asset(target_asset.image_asset, variant_id):
                if target_asset.image_asset.selected_id:
                    selected = next((v for v in target_asset.image_asset.variants if v.id == target_asset.image_asset.selected_id), None)
                    target_asset.image_url = selected.url if selected else None
                else:
                    target_asset.image_url = None

        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                if self._delete_variant_in_asset(target_asset.rendered_image_asset, variant_id):
                    if target_asset.rendered_image_asset.selected_id:
                        selected = next((v for v in target_asset.rendered_image_asset.variants if v.id == target_asset.rendered_image_asset.selected_id), None)
                        target_asset.rendered_image_url = selected.url if selected else None
                        target_asset.image_url = selected.url if selected else None
                    else:
                        target_asset.rendered_image_url = None
                        # 这里先简单处理：渲染图清空后，主图也一并清空
                        target_asset.image_url = None

        self._save_data()
        return script

    def update_model_settings(self, script_id: str, t2i_model: str = None, i2i_model: str = None, i2v_model: str = None, character_aspect_ratio: str = None, scene_aspect_ratio: str = None, prop_aspect_ratio: str = None, storyboard_aspect_ratio: str = None) -> Script:
        """更新项目级模型与宽高比配置。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        if t2i_model:
            script.model_settings.t2i_model = t2i_model
        if i2i_model:
            script.model_settings.i2i_model = i2i_model
        if i2v_model:
            script.model_settings.i2v_model = i2v_model
        if character_aspect_ratio:
            script.model_settings.character_aspect_ratio = character_aspect_ratio
        if scene_aspect_ratio:
            script.model_settings.scene_aspect_ratio = scene_aspect_ratio
        if prop_aspect_ratio:
            script.model_settings.prop_aspect_ratio = prop_aspect_ratio
        if storyboard_aspect_ratio:
            script.model_settings.storyboard_aspect_ratio = storyboard_aspect_ratio
        
        self._save_data()
        return script

    def _set_variant_favorite(self, image_asset: Any, variant_id: str, is_favorited: bool) -> bool:
        """设置候选图收藏状态；找到即返回 True。"""
        if not image_asset or not image_asset.variants:
            return False
        for v in image_asset.variants:
            if v.id == variant_id:
                v.is_favorited = is_favorited
                return True
        return False

    def toggle_variant_favorite(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, is_favorited: bool, generation_type: str = None) -> Script:
        """切换候选图收藏状态。"""
        script = self.scripts.get(script_id)
        if not script:
            raise ValueError("Script not found")
        
        found = False
        if asset_type == "character":
            target_asset = next((c for c in script.characters if c.id == asset_id), None)
            if target_asset:
                if generation_type == "full_body":
                    found = self._set_variant_favorite(target_asset.full_body_asset, variant_id, is_favorited)
                elif generation_type == "three_view":
                    found = self._set_variant_favorite(target_asset.three_view_asset, variant_id, is_favorited)
                elif generation_type == "headshot":
                    found = self._set_variant_favorite(target_asset.headshot_asset, variant_id, is_favorited)
                else:
                    # 没指定素材位时，依次在三类角色图里查找
                    found = self._set_variant_favorite(target_asset.full_body_asset, variant_id, is_favorited) or \
                            self._set_variant_favorite(target_asset.three_view_asset, variant_id, is_favorited) or \
                            self._set_variant_favorite(target_asset.headshot_asset, variant_id, is_favorited)
        
        elif asset_type == "scene":
            target_asset = next((s for s in script.scenes if s.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        elif asset_type == "prop":
            target_asset = next((p for p in script.props if p.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        elif asset_type == "storyboard_frame":
            target_asset = next((f for f in script.frames if f.id == asset_id), None)
            if target_asset:
                found = self._set_variant_favorite(target_asset.rendered_image_asset, variant_id, is_favorited) or \
                        self._set_variant_favorite(target_asset.image_asset, variant_id, is_favorited)
        
        if not found:
            raise ValueError(f"Variant {variant_id} not found")

        self._save_data()
        return script

    # ============================================================
    # 系列存储与基础增删改查
    # ============================================================

    def _load_series_data(self) -> Dict[str, Series]:
        if not os.path.exists(self.series_data_file):
            return {}
        try:
            with open(self.series_data_file, 'r') as f:
                data = json.load(f)
                return {k: Series(**v) for k, v in data.items()}
        except Exception as e:
            logger.error(f"Failed to load series data: {e}")
            return {}

    def _save_series_data_unlocked(self):
        """在已持锁前提下保存系列数据。"""
        try:
            os.makedirs(os.path.dirname(self.series_data_file) or ".", exist_ok=True)
            with open(self.series_data_file, 'w') as f:
                json.dump({k: v.model_dump() for k, v in self.series_store.items()}, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save series data: {e}")

    def _save_series_data(self):
        """带锁保存系列数据。"""
        with self._save_lock:
            self._save_series_data_unlocked()

    def create_series(self, title: str, description: str = "") -> Series:
        """创建一个新的系列。"""
        with self._save_lock:
            series = Series(
                id=str(uuid.uuid4()),
                title=title,
                description=description,
                created_at=time.time(),
                updated_at=time.time(),
            )
            self.series_store[series.id] = series
            self._save_series_data_unlocked()
            return series

    def get_series(self, series_id: str) -> Optional[Series]:
        return self.series_store.get(series_id)

    def list_series(self) -> List[Series]:
        return list(self.series_store.values())

    def update_series(self, series_id: str, updates: Dict[str, Any]) -> Series:
        """更新系列字段，例如标题、简介等。"""
        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError("Series not found")
            for key, value in updates.items():
                if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                    setattr(series, key, value)
            series.updated_at = time.time()
            self.series_store[series_id] = series
            self._save_series_data_unlocked()
            return series

    def delete_series(self, series_id: str) -> None:
        """删除系列，并解除与分集的关联。"""
        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError("Series not found")
            # 先把每个分集上的系列关联清掉
            for ep_id in series.episode_ids:
                script = self.scripts.get(ep_id)
                if script:
                    script.series_id = None
                    script.episode_number = None
            self._save_data()
            del self.series_store[series_id]
            self._save_series_data_unlocked()

    def add_episode_to_series(self, series_id: str, script_id: str, episode_number: Optional[int] = None) -> Series:
        """把已有项目加入系列，作为一集。"""
        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError("Series not found")
            script = self.scripts.get(script_id)
            if not script:
                raise ValueError("Script not found")
            # 如果项目原本属于别的系列，先从旧系列里摘掉
            if script.series_id and script.series_id != series_id:
                old_series = self.series_store.get(script.series_id)
                if old_series and script_id in old_series.episode_ids:
                    old_series.episode_ids.remove(script_id)
            if script_id not in series.episode_ids:
                series.episode_ids.append(script_id)
            script.series_id = series_id
            script.episode_number = episode_number or len(series.episode_ids)
            series.updated_at = time.time()
            self._save_data()
            self._save_series_data_unlocked()
            return series

    def remove_episode_from_series(self, series_id: str, script_id: str) -> Series:
        """把一集从系列中移除，但不删除项目本身。"""
        with self._save_lock:
            series = self.series_store.get(series_id)
            if not series:
                raise ValueError("Series not found")
            if script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
            script = self.scripts.get(script_id)
            if script:
                script.series_id = None
                script.episode_number = None
            series.updated_at = time.time()
            self._save_data()
            self._save_series_data_unlocked()
            return series

    def get_series_episodes(self, series_id: str) -> List[Script]:
        """按顺序获取系列下的全部分集。"""
        series = self.series_store.get(series_id)
        if not series:
            raise ValueError("Series not found")
        episodes = []
        for ep_id in series.episode_ids:
            script = self.scripts.get(ep_id)
            if script:
                episodes.append(script)
        return episodes

    def resolve_episode_assets(self, episode: Script, series: Optional[Series] = None) -> Dict[str, List]:
        """
        合并分集本地素材与系列共享素材。

        如果 ID 冲突，分集自己的素材优先。
        """
        if not series:
            # 如果没显式传系列对象，就按 episode.series_id 自动回查
            if episode.series_id:
                series = self.series_store.get(episode.series_id)
        if not series:
            return {
                "characters": episode.characters,
                "scenes": episode.scenes,
                "props": episode.props,
            }
        # 先收集分集本地素材 ID，用于去重
        ep_char_ids = {c.id for c in episode.characters}
        ep_scene_ids = {s.id for s in episode.scenes}
        ep_prop_ids = {p.id for p in episode.props}

        merged_characters = list(episode.characters) + [c for c in series.characters if c.id not in ep_char_ids]
        merged_scenes = list(episode.scenes) + [s for s in series.scenes if s.id not in ep_scene_ids]
        merged_props = list(episode.props) + [p for p in series.props if p.id not in ep_prop_ids]

        return {
            "characters": merged_characters,
            "scenes": merged_scenes,
            "props": merged_props,
        }

    # ============================================================
    # 文件导入与分集拆分
    # ============================================================

    def import_file_and_split(self, text: str, suggested_episodes: int = 3) -> List[Dict]:
        """调用 LLM 预拆分文本，并返回分集预览。"""
        return self.script_processor.split_into_episodes(text, suggested_episodes)

    def create_series_from_import(self, title: str, text: str, episodes_data: List[Dict],
                                   description: str = "") -> Dict:
        """
        根据导入结果创建系列和分集。

        `episodes_data` 中应包含 `episode_number`、`title`、`start_marker`、`end_marker` 等信息。
        """
        # 先创建系列对象
        series = self.create_series(title, description)

        # 按起止标记把整段原文切成每一集的文本
        episode_texts = self._split_text_by_markers(text, episodes_data)

        with self._save_lock:
            # 逐段创建分集项目
            created_episodes = []
            for idx, ep_data in enumerate(episodes_data):
                ep_text = episode_texts[idx] if idx < len(episode_texts) else ""
                ep_title = ep_data.get("title", f"第{idx+1}集")
                episode_number = ep_data.get("episode_number", idx + 1)

                # 这里只建草稿分集，后续再由用户决定是否进一步分析
                script = self.script_processor.create_draft_script(ep_title, ep_text)
                script.series_id = series.id
                script.episode_number = episode_number
                self.scripts[script.id] = script

                series.episode_ids.append(script.id)
                created_episodes.append({
                    "id": script.id,
                    "title": ep_title,
                    "episode_number": episode_number,
                    "text_length": len(ep_text),
                })

            self._save_data()
            self._save_series_data_unlocked()

        return {
            "series": series.model_dump(),
            "episodes": created_episodes,
        }

    def _split_text_by_markers(self, text: str, episodes_data: List[Dict]) -> List[str]:
        """按 LLM 给出的起止标记切分文本，并尽量避免片段重叠。"""
        chunks = []
        search_from = 0  # 记录下一次搜索起点，避免前后重叠

        for ep in episodes_data:
            start_marker = ep.get("start_marker", "")
            end_marker = ep.get("end_marker", "")

            start_idx = search_from
            end_idx = len(text)

            if start_marker:
                found = text.find(start_marker, search_from)
                if found >= 0:
                    start_idx = found

            if end_marker:
                found = text.find(end_marker, start_idx)
                if found >= 0:
                    end_idx = found + len(end_marker)

            chunks.append(text[start_idx:end_idx])
            search_from = end_idx  # Next episode starts after this one

        # 标记切分失败时，兜底按平均长度硬切
        if not chunks or all(len(c.strip()) == 0 for c in chunks):
            chunk_size = max(1, len(text) // len(episodes_data))
            chunks = []
            for i in range(len(episodes_data)):
                start = i * chunk_size
                end = start + chunk_size if i < len(episodes_data) - 1 else len(text)
                chunks.append(text[start:end])

        return chunks

    # ============================================================
    # 系列共享素材操作
    # ============================================================

    def _find_series_asset(self, series_id: str, asset_id: str, asset_type: str):
        """在系列里查找指定素材，并返回 `(series, asset)`。"""
        if asset_type not in ("character", "scene", "prop"):
            raise ValueError(f"Invalid asset type: {asset_type}")
        series = self.series_store.get(series_id)
        if not series:
            raise ValueError("Series not found")
        target_asset = None
        if asset_type == "character":
            target_asset = next((c for c in series.characters if c.id == asset_id), None)
        elif asset_type == "scene":
            target_asset = next((s for s in series.scenes if s.id == asset_id), None)
        elif asset_type == "prop":
            target_asset = next((p for p in series.props if p.id == asset_id), None)
        if not target_asset:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found in series")
        return series, target_asset

    def toggle_series_asset_lock(self, series_id: str, asset_id: str, asset_type: str) -> Series:
        """切换系列素材的锁定状态。"""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            target_asset.locked = not target_asset.locked
            self._save_series_data_unlocked()
            return series

    def update_series_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str) -> Series:
        """更新系列素材的图片地址。"""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            target_asset.image_url = image_url
            if asset_type == "character":
                target_asset.avatar_url = image_url
            self._save_series_data_unlocked()
            return series

    def update_series_asset_attributes(self, series_id: str, asset_id: str, asset_type: str, attributes: Dict[str, Any]) -> Series:
        """批量更新系列素材字段。"""
        with self._save_lock:
            series, target_asset = self._find_series_asset(series_id, asset_id, asset_type)
            for key, value in attributes.items():
                if hasattr(target_asset, key) and key not in ("id", "status", "locked"):
                    setattr(target_asset, key, value)
            series.updated_at = time.time()
            self._save_series_data_unlocked()
            return series

    def generate_series_asset(self, series_id: str, asset_id: str, asset_type: str,
                              style_preset: str = None, reference_image_url: str = None,
                              style_prompt: str = None, generation_type: str = "all",
                              prompt: str = None, apply_style: bool = True,
                              negative_prompt: str = None, batch_size: int = 1,
                              model_name: str = None) -> tuple:
        """为系列共享素材创建异步生成任务，并返回 `(series, task_id)`。"""
        series = self.series_store.get(series_id)
        if not series:
            raise ValueError("Series not found")

        t2i_model = model_name or series.model_settings.t2i_model

        from .assets import ASPECT_RATIO_TO_SIZE
        if asset_type == "character":
            aspect_ratio = series.model_settings.character_aspect_ratio
            default_size = "576*1024"
        elif asset_type == "scene":
            aspect_ratio = series.model_settings.scene_aspect_ratio
            default_size = "1024*576"
        elif asset_type == "prop":
            aspect_ratio = series.model_settings.prop_aspect_ratio
            default_size = "1024*1024"
        else:
            aspect_ratio = "9:16"
            default_size = "576*1024"
        effective_size = ASPECT_RATIO_TO_SIZE.get(aspect_ratio, default_size)

        effective_positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""
        if apply_style:
            if series.art_direction and series.art_direction.style_config:
                effective_positive_prompt = series.art_direction.style_config.get('positive_prompt', '')
                global_neg = series.art_direction.style_config.get('negative_prompt', '')
                if global_neg:
                    effective_negative_prompt = f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
            elif style_prompt:
                effective_positive_prompt = style_prompt
            elif style_preset:
                effective_positive_prompt = f"{style_preset} style"

        task_id = str(uuid.uuid4())
        self.asset_generation_tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "error": None,
            "script_id": series_id,  # 复用旧字段名，避免改动任务结构
            "asset_id": asset_id,
            "asset_type": asset_type,
            "created_at": time.time(),
            "is_series": True,
            "params": {
                "style_preset": style_preset,
                "reference_image_url": reference_image_url,
                "effective_positive_prompt": effective_positive_prompt,
                "effective_negative_prompt": effective_negative_prompt,
                "generation_type": generation_type,
                "prompt": prompt,
                "apply_style": apply_style,
                "batch_size": batch_size,
                "t2i_model": t2i_model,
                "effective_size": effective_size,
            }
        }
        return series, task_id

    def import_assets_from_series(self, target_series_id: str, source_series_id: str, asset_ids: List[str]) -> Tuple[Series, List[str], List[str]]:
        """把源系列中的选中素材深拷贝导入目标系列。"""
        with self._save_lock:
            target = self.series_store.get(target_series_id)
            if not target:
                raise ValueError("Target series not found")
            source = self.series_store.get(source_series_id)
            if not source:
                raise ValueError("Source series not found")

            # 先把源系列里的素材整理成按 ID 检索的字典
            source_assets = {}
            for c in source.characters:
                source_assets[c.id] = ("character", c)
            for s in source.scenes:
                source_assets[s.id] = ("scene", s)
            for p in source.props:
                source_assets[p.id] = ("prop", p)

            imported_ids = []
            skipped_ids = []
            for aid in asset_ids:
                if aid not in source_assets:
                    skipped_ids.append(aid)
                    continue
                asset_type, asset = source_assets[aid]
                # 深拷贝一份，并为目标系列换新的素材 ID
                import copy
                new_asset = copy.deepcopy(asset)
                new_asset.id = str(uuid.uuid4())
                if asset_type == "character":
                    target.characters.append(new_asset)
                elif asset_type == "scene":
                    target.scenes.append(new_asset)
                elif asset_type == "prop":
                    target.props.append(new_asset)
                imported_ids.append(aid)

            target.updated_at = time.time()
            self._save_series_data_unlocked()
            return target, imported_ids, skipped_ids

    def get_effective_prompt(self, prompt_type: str, episode: Script, series: Optional[Series] = None) -> str:
        """按“分集 -> 系列 -> 系统默认”三级回退读取提示词。"""
        valid_prompt_types = ("storyboard_polish", "video_polish", "r2v_polish")
        if prompt_type not in valid_prompt_types:
            raise ValueError(f"Invalid prompt_type: {prompt_type}. Must be one of {valid_prompt_types}")
        from .llm import DEFAULT_STORYBOARD_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT, DEFAULT_R2V_POLISH_PROMPT
        defaults = {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
        }
        episode_value = getattr(episode.prompt_config, prompt_type, "")
        if episode_value.strip():
            return episode_value
        if series:
            series_value = getattr(series.prompt_config, prompt_type, "")
            if series_value.strip():
                return series_value
        return defaults.get(prompt_type, "")
