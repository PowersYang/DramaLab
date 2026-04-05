"""
分镜工作流。

这里把原先 pipeline 中的“分析 / 润色 / 渲染 / 抽帧”流程逐步迁入 workflow，
让 API -> workflow -> repository/provider 成为主链路。
"""

import os
import subprocess
import uuid

from ...providers import ScriptProcessor, StorageProvider, StoryboardGenerator
from ...providers.image.asset_image_provider import ASPECT_RATIO_TO_SIZE
from ...repository import ProjectRepository, SeriesRepository, StoryboardFrameRepository, VideoTaskRepository
from ...schemas.models import GenerationStatus, ImageAsset, ImageVariant, StoryboardFrame
from ...providers.text.default_prompts import DEFAULT_STORYBOARD_POLISH_PROMPT
from ..services.project_command_service import ProjectCommandService
from ...utils.path_safety import validate_safe_id
from ...utils import get_logger
from ...utils.datetime import utc_now
from ...utils.system_check import get_ffmpeg_path
from ...utils.oss_utils import is_object_key
from ...utils.temp_media import create_temp_file_path, remove_temp_file

logger = get_logger(__name__)


class StoryboardWorkflow:
    """负责分镜分析、提示词润色、渲染和抽帧流程。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.frame_repository = StoryboardFrameRepository()
        self.video_task_repository = VideoTaskRepository()
        self.project_command_service = ProjectCommandService()
        self.text_provider = ScriptProcessor()
        self.image_provider = StoryboardGenerator()
        self.storage_provider = StorageProvider()

    def analyze_to_storyboard(self, script_id: str, text: str):
        """根据剧本文本生成结构化分镜帧。"""
        logger.info("分镜工作流：解析剧本到分镜开始 脚本ID=%s 文本长度=%s", script_id, len(text or ""))
        project = self._get_project(script_id)
        resolved = self._resolve_episode_assets(project)
        entities_json = {
            "characters": [{"id": item.id, "name": item.name, "description": item.description} for item in resolved["characters"]],
            "scenes": [{"id": item.id, "name": item.name, "description": item.description} for item in resolved["scenes"]],
            "props": [{"id": item.id, "name": item.name, "description": item.description} for item in resolved["props"]],
        }

        raw_frames = self.text_provider.analyze_to_storyboard(text, entities_json)
        if not raw_frames:
            raise RuntimeError("AI 分镜分析未返回任何帧数据，请重试。")

        new_frames = []
        for frame_data in raw_frames:
            scene_id = self._resolve_scene_id(frame_data.get("scene_ref_name", ""), resolved["scenes"])
            character_ids = self._resolve_entity_ids(frame_data.get("character_ref_names", []), resolved["characters"])
            prop_ids = self._resolve_entity_ids(frame_data.get("prop_ref_names", []), resolved["props"])
            new_frames.append(
                StoryboardFrame(
                    id=str(uuid.uuid4()),
                    scene_id=scene_id,
                    character_ids=character_ids,
                    prop_ids=prop_ids,
                    action_description=frame_data.get("action_description", ""),
                    visual_atmosphere=frame_data.get("visual_atmosphere"),
                    shot_size=frame_data.get("shot_size"),
                    camera_angle=frame_data.get("camera_angle", "平视"),
                    camera_movement=frame_data.get("camera_movement"),
                    dialogue=frame_data.get("dialogue"),
                    speaker=frame_data.get("speaker"),
                    status=GenerationStatus.PENDING,
                )
            )

        updated_project = self.project_command_service.sync_frames(script_id, project.version, new_frames)
        logger.info("分镜工作流：解析剧本到分镜完成 脚本ID=%s 分镜数量=%s", script_id, len(new_frames))
        return updated_project

    def refine_prompt(self, script_id: str, frame_id: str, raw_prompt: str, assets: list, feedback: str = ""):
        """结合可选系列级覆写，对分镜帧图片提示词进行润色。"""
        logger.info("分镜工作流：润色提示词开始 脚本ID=%s 分镜ID=%s 参考素材数量=%s", script_id, frame_id, len(assets))
        project = self._get_project(script_id)
        series = self.series_repository.get(project.series_id) if project.series_id else None
        custom_prompt = self._get_effective_prompt("storyboard_polish", project, series)
        if custom_prompt == DEFAULT_STORYBOARD_POLISH_PROMPT:
            custom_prompt = ""

        result = self.text_provider.polish_storyboard_prompt(
            raw_prompt,
            assets,
            feedback,
            custom_prompt,
        )

        frame_found = False
        for frame in project.frames:
            if frame.id == frame_id:
                frame.image_prompt_cn = result.get("prompt_cn")
                frame.image_prompt_en = result.get("prompt_en")
                frame.image_prompt = result.get("prompt_en")
                frame.updated_at = utc_now()
                frame_found = True
                break

        if frame_found:
            self.frame_repository.save(script_id, frame)
        logger.info("分镜工作流：润色提示词完成 脚本ID=%s 分镜ID=%s 是否更新=%s", script_id, frame_id, frame_found)

        return {
            "prompt_cn": result.get("prompt_cn"),
            "prompt_en": result.get("prompt_en"),
            "frame_updated": frame_found,
        }

    def generate_storyboard(self, script_id: str):
        """为项目分镜中所有待处理帧批量渲染图片。"""
        logger.info("分镜工作流：生成分镜开始 脚本ID=%s", script_id)
        project = self._get_project(script_id)
        self.image_provider.generate_storyboard(project)
        for frame in project.frames:
            self.frame_repository.save(script_id, frame)
        updated_project = self._get_project(script_id)
        logger.info("分镜工作流：生成分镜完成 脚本ID=%s", script_id)
        return updated_project

    def prepare_generate_storyboard(self, script_id: str):
        """批量分镜渲染入队前校验项目存在。"""
        return self._get_project(script_id)

    def render_frame(self, script_id: str, frame_id: str, composition_data, prompt: str, batch_size: int = 1):
        """使用显式构图输入渲染单个分镜帧。"""
        logger.info("分镜工作流：渲染分镜帧开始 脚本ID=%s 分镜ID=%s 批量数量=%s", script_id, frame_id, batch_size)
        project = self._get_project(script_id)
        frame = next((item for item in project.frames if item.id == frame_id), None)
        if not frame:
            raise ValueError(f"Frame {frame_id} not found")

        frame.status = GenerationStatus.PROCESSING
        if composition_data:
            frame.composition_data = composition_data
        frame.image_prompt = prompt
        self.frame_repository.save(script_id, frame)
        updated_project = self._get_project(script_id)

        try:
            # 前端可能传来 OSS 对象键、外部 URL 或运行时临时文件路径，调用模型前先统一归一化。
            ref_image_urls = composition_data.get("reference_image_urls", []) if composition_data else []
            ref_image_url = composition_data.get("reference_image_url") if composition_data else None
            ref_image_paths = []
            for url in ref_image_urls:
                if not url:
                    continue
                if self.storage_provider.is_object_key(url) or url.startswith("http"):
                    ref_image_paths.append(url)
                    continue
                if os.path.exists(url):
                    ref_image_paths.append(url)

            if ref_image_url and ref_image_url not in ref_image_urls:
                if self.storage_provider.is_object_key(ref_image_url) or ref_image_url.startswith("http"):
                    ref_image_paths.append(ref_image_url)
                elif os.path.exists(ref_image_url):
                    ref_image_paths.append(ref_image_url)

            ref_image_path = ref_image_paths[0] if ref_image_paths else None
            scene = next((item for item in project.scenes if item.id == frame.scene_id), None)
            effective_size = ASPECT_RATIO_TO_SIZE.get(
                project.model_settings.storyboard_aspect_ratio,
                "1024*576",
            )

            self.image_provider.generate_frame(
                frame,
                project.characters,
                scene,
                ref_image_path=ref_image_path,
                ref_image_paths=ref_image_paths,
                prompt=prompt,
                batch_size=batch_size,
                size=effective_size,
                model_name=project.model_settings.i2i_model,
            )
            self.frame_repository.save(script_id, frame)
            updated_project = self._get_project(script_id)
            logger.info("分镜工作流：渲染分镜帧完成 脚本ID=%s 分镜ID=%s", script_id, frame_id)
            return updated_project
        except Exception:
            frame.status = GenerationStatus.FAILED
            self.frame_repository.save(script_id, frame)
            logger.exception("分镜工作流：渲染分镜帧失败 脚本ID=%s 分镜ID=%s", script_id, frame_id)
            raise

    def extract_last_frame(self, script_id: str, frame_id: str, video_task_id: str):
        """提取视频最后一帧，并把它挂成分镜候选图。"""
        logger.info("分镜工作流：抽取视频末帧开始 脚本ID=%s 分镜ID=%s 视频任务ID=%s", script_id, frame_id, video_task_id)
        project = self._get_project(script_id)
        frame = next((item for item in project.frames if item.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        video_task = self.video_task_repository.get(script_id, video_task_id)
        if not video_task or video_task.status != "completed" or not video_task.video_url:
            raise ValueError("Video task not found or not completed")

        video_path = video_task.video_url
        cleanup_video_path = False
        if is_object_key(video_path) or video_path.startswith("http"):
            local_video_path = create_temp_file_path(prefix=f"dramalab-frame-source-{frame_id}-", suffix=".mp4")
            if not self.storage_provider.download_file(video_path, local_video_path):
                remove_temp_file(local_video_path)
                raise ValueError("Video file could not be downloaded from object storage.")
            video_path = local_video_path
            cleanup_video_path = True
        elif not os.path.exists(video_path):
            raise ValueError(f"Video file not found: {video_path}")

        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError("FFmpeg is required for frame extraction but was not found.")

        validate_safe_id(frame_id, "frame_id")
        output_path = create_temp_file_path(prefix=f"dramalab-last-frame-{frame_id}-", suffix=".jpg")

        cmd = [
            ffmpeg_path,
            "-sseof",
            "-0.1",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            "-y",
            output_path,
        ]
        try:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if result.returncode != 0:
                    raise RuntimeError(f"FFmpeg error: {result.stderr}")
            except subprocess.TimeoutExpired:
                raise RuntimeError("FFmpeg frame extraction timed out")

            image_url = self.storage_provider.upload_image(output_path)
            if not image_url:
                raise RuntimeError("Failed to upload extracted frame image to OSS.")
        finally:
            remove_temp_file(output_path)
            if cleanup_video_path:
                remove_temp_file(video_path)
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="Extracted last frame from video",
            is_uploaded_source=True,
            upload_type="image",
        )
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset()
        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        frame.rendered_image_url = image_url
        frame.image_url = image_url
        frame.updated_at = utc_now()
        self.frame_repository.save(script_id, frame)
        logger.info("分镜工作流：抽取视频末帧完成 脚本ID=%s 分镜ID=%s 图片地址=%s", script_id, frame_id, image_url)
        return self._get_project(script_id)

    def _resolve_episode_assets(self, episode):
        """合并分集本地资产与系列共享资产，供分镜分析使用。"""
        if not episode.series_id:
            return {
                "characters": episode.characters,
                "scenes": episode.scenes,
                "props": episode.props,
            }

        series = self.series_repository.get(episode.series_id)
        if not series:
            return {
                "characters": episode.characters,
                "scenes": episode.scenes,
                "props": episode.props,
            }

        ep_char_ids = {item.id for item in episode.characters}
        ep_scene_ids = {item.id for item in episode.scenes}
        ep_prop_ids = {item.id for item in episode.props}
        return {
            "characters": list(episode.characters) + [item for item in series.characters if item.id not in ep_char_ids],
            "scenes": list(episode.scenes) + [item for item in series.scenes if item.id not in ep_scene_ids],
            "props": list(episode.props) + [item for item in series.props if item.id not in ep_prop_ids],
        }

    def _resolve_scene_id(self, scene_name: str, scenes: list):
        """把 LLM 产出的场景名解析成现有场景 id。"""
        for scene in scenes:
            if scene.name == scene_name or scene_name in scene.name:
                return scene.id
        if scenes:
            return scenes[0].id
        return str(uuid.uuid4())

    def _resolve_entity_ids(self, names: list[str], items: list):
        """把 LLM 产出的实体名解析成已知实体 id。"""
        entity_ids = []
        for name in names:
            for item in items:
                if item.name == name or name in item.name:
                    entity_ids.append(item.id)
                    break
        return entity_ids

    def _get_effective_prompt(self, prompt_type: str, episode, series=None):
        """按分集优先、系列回退的规则解析分镜提示词覆写。"""
        if prompt_type == "storyboard_polish":
            episode_prompt = episode.prompt_config.storyboard_polish.strip()
            if episode_prompt:
                return episode_prompt
            if series:
                series_prompt = series.prompt_config.storyboard_polish.strip()
                if series_prompt:
                    return series_prompt
            return DEFAULT_STORYBOARD_POLISH_PROMPT
        raise ValueError(f"Unsupported prompt type: {prompt_type}")

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出未找到错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project
