"""
系统路由：调试检查、文件导入、环境配置与通用工具接口。
"""

import asyncio
import json
import os
import shutil
import sys
import uuid
from functools import partial

from dotenv import set_key
from fastapi import APIRouter, File, HTTPException, UploadFile

from ..service.llm import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
    ScriptProcessor,
)
from ..utils.endpoints import PROVIDER_DEFAULTS
from ..utils.oss_utils import OSSImageUploader
from ..utils.system_check import run_system_checks
from ..common import logger, pipeline, signed_response
from ..schema.requests import (
    AnalyzeStyleRequest,
    ConfirmImportRequest,
    EnvConfig,
    PolishR2VPromptRequest,
    PolishVideoPromptRequest,
    SaveArtDirectionRequest,
)


router = APIRouter()


@router.get("/debug/config")
async def debug_config():
    """检查 OSS 与本地路径配置是否正常。"""
    uploader = OSSImageUploader()
    return {
        "oss_configured": uploader.is_configured,
        "oss_bucket_initialized": uploader.bucket is not None,
        "oss_base_path": os.getenv("OSS_BASE_PATH", "lumenx"),
        "output_dir_exists": os.path.exists("output"),
        "output_contents": os.listdir("output") if os.path.exists("output") else [],
        "cwd": os.getcwd(),
        "env_vars_present": {
            "OSS_ENDPOINT": bool(os.getenv("OSS_ENDPOINT")),
            "OSS_BUCKET_NAME": bool(os.getenv("OSS_BUCKET_NAME")),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": bool(
                os.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")
            ),
        },
    }


@router.get("/system/check")
async def check_system():
    """检查系统依赖与基础配置。"""
    return run_system_checks()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件，并返回可供前端访问的地址。"""
    try:
        file_ext = os.path.splitext(file.filename)[1]
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join("output/uploads", filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        oss_url = OSSImageUploader().upload_image(file_path)
        if oss_url:
            return signed_response({"url": oss_url})

        return {"url": f"uploads/{filename}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/preview")
async def import_file_preview(
    file: UploadFile = File(...),
    suggested_episodes: int = 3,
):
    """上传 txt/md 文件，并返回 LLM 预拆分的分集结果。"""
    if suggested_episodes < 1 or suggested_episodes > 50:
        raise HTTPException(status_code=400, detail="建议集数应在 1-50 之间")
    try:
        content_bytes = await file.read()
        text = content_bytes.decode("utf-8")
        if not text.strip():
            raise HTTPException(status_code=400, detail="文件内容为空")

        loop = asyncio.get_event_loop()
        episodes = await loop.run_in_executor(
            None,
            partial(pipeline.import_file_and_split, text, suggested_episodes),
        )
        import_id = str(uuid.uuid4())
        pipeline._import_cache[import_id] = text
        return {
            "filename": file.filename,
            "text_length": len(text),
            "suggested_episodes": suggested_episodes,
            "episodes": episodes,
            "import_id": import_id,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("File import preview failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/confirm")
async def import_file_confirm(request: ConfirmImportRequest):
    """确认分集结果，并正式创建系列与分集项目。"""
    try:
        text = None
        if request.import_id:
            text = pipeline._import_cache.pop(request.import_id, None)
        if not text:
            text = request.text
        if not text:
            raise ValueError("No text available. Provide import_id or text.")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(
                pipeline.create_series_from_import,
                request.title,
                text,
                request.episodes,
                request.description,
            ),
        )
        return signed_response(result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Import confirm failed")
        raise HTTPException(status_code=500, detail=str(exc))


def get_user_config_path() -> str:
    """
    返回当前环境下用户配置文件的存放路径。

    开发环境使用后端根目录下的 `.env`；
    打包应用使用用户目录下的 `config.json`。
    """
    from ..utils import get_user_data_dir

    is_packaged = os.getenv("LUMEN_X_PACKAGED", "false").lower() == "true" or getattr(
        sys, "frozen", False
    )

    if is_packaged:
        config_dir = get_user_data_dir()
        os.makedirs(config_dir, exist_ok=True)
        return os.path.join(config_dir, "config.json")

    project_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    return os.path.join(project_root, ".env")


def load_user_config():
    """从配置文件加载用户设置，并写入当前进程环境变量。"""
    config_path = get_user_config_path()

    if config_path.endswith(".json") and os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as file:
                config = json.load(file)
            for key, value in config.items():
                if value:
                    os.environ[key] = value
        except Exception as exc:
            logger.warning("Failed to load config from %s: %s", config_path, exc)


def save_user_config(config_dict: dict):
    """把用户配置持久化到对应文件。"""
    config_path = get_user_config_path()

    if config_path.endswith(".json"):
        existing_config = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as file:
                    existing_config = json.load(file)
            except Exception:
                existing_config = {}
        existing_config.update(config_dict)
        with open(config_path, "w", encoding="utf-8") as file:
            json.dump(existing_config, file, indent=2)
        return

    for key, value in config_dict.items():
        if value is not None:
            set_key(config_path, key, value)


def remove_user_config_keys(keys: list):
    """从持久化配置中删除指定键。"""
    if not keys:
        return

    config_path = get_user_config_path()
    if config_path.endswith(".json"):
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as file:
                    existing_config = json.load(file)
                for key in keys:
                    existing_config.pop(key, None)
                with open(config_path, "w", encoding="utf-8") as file:
                    json.dump(existing_config, file, indent=2)
            except Exception as exc:
                logger.warning("Failed to remove keys from config: %s", exc)
        return

    from dotenv import unset_key

    for key in keys:
        try:
            unset_key(config_path, key)
        except Exception as exc:
            logger.warning("Failed to unset key %s from .env: %s", key, exc)


load_user_config()


@router.get("/config/info")
async def get_config_info():
    """返回当前配置存储模式与路径信息。"""
    config_path = get_user_config_path()
    is_packaged = os.getenv("LUMEN_X_PACKAGED", "false").lower() == "true" or getattr(
        sys, "frozen", False
    )
    return {
        "mode": "packaged" if is_packaged else "development",
        "config_path": config_path,
        "config_exists": os.path.exists(config_path),
    }


@router.post("/config/env")
async def update_env_config(config: EnvConfig):
    """更新环境配置，并落盘保存。"""
    try:
        config_dict = config.model_dump(exclude_unset=True)
        endpoint_overrides = config_dict.pop("endpoint_overrides", {})
        config_dict = {key: value for key, value in config_dict.items() if value is not None}

        allowed_keys = {f"{provider}_BASE_URL" for provider in PROVIDER_DEFAULTS}
        keys_to_remove = []
        for env_key, value in endpoint_overrides.items():
            if env_key not in allowed_keys:
                logger.warning("Ignoring unknown endpoint key: %s", env_key)
                continue
            if value and value.strip():
                config_dict[env_key] = value.strip()
            else:
                os.environ.pop(env_key, None)
                keys_to_remove.append(env_key)

        for key, value in config_dict.items():
            os.environ[key] = value

        save_user_config(config_dict)
        remove_user_config_keys(keys_to_remove)

        try:
            OSSImageUploader.reset_instance()
            logger.info("OSS instance reset successfully")
        except Exception as oss_exc:
            logger.warning("OSS reset failed (non-critical): %s", oss_exc)

        config_path = get_user_config_path()
        return {
            "status": "success",
            "message": f"Configuration saved to {config_path}",
        }
    except Exception as exc:
        logger.exception("Failed to save environment configuration")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/config/env")
async def get_env_config():
    """读取当前环境配置。"""
    try:
        endpoint_overrides = {}
        for provider in PROVIDER_DEFAULTS:
            env_key = f"{provider}_BASE_URL"
            value = os.getenv(env_key)
            if value:
                endpoint_overrides[env_key] = value

        return {
            "DASHSCOPE_API_KEY": os.getenv("DASHSCOPE_API_KEY", ""),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": os.getenv(
                "ALIBABA_CLOUD_ACCESS_KEY_ID", ""
            ),
            "ALIBABA_CLOUD_ACCESS_KEY_SECRET": os.getenv(
                "ALIBABA_CLOUD_ACCESS_KEY_SECRET", ""
            ),
            "OSS_BUCKET_NAME": os.getenv("OSS_BUCKET_NAME", ""),
            "OSS_ENDPOINT": os.getenv("OSS_ENDPOINT", ""),
            "OSS_BASE_PATH": os.getenv("OSS_BASE_PATH", ""),
            "KLING_ACCESS_KEY": os.getenv("KLING_ACCESS_KEY", ""),
            "KLING_SECRET_KEY": os.getenv("KLING_SECRET_KEY", ""),
            "VIDU_API_KEY": os.getenv("VIDU_API_KEY", ""),
            "endpoint_overrides": endpoint_overrides,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/art_direction/analyze")
async def analyze_script_for_styles(script_id: str, request: AnalyzeStyleRequest):
    """分析剧本内容，并用 LLM 推荐视觉风格。"""
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")

        loop = asyncio.get_event_loop()
        recommendations = await loop.run_in_executor(
            None,
            partial(
                pipeline.script_processor.analyze_script_for_styles,
                request.script_text,
            ),
        )
        return {"recommendations": recommendations}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/art_direction/save")
async def save_art_direction(script_id: str, request: SaveArtDirectionRequest):
    """把美术指导配置保存到项目。"""
    try:
        updated_script = pipeline.save_art_direction(
            script_id,
            request.selected_style_id,
            request.style_config,
            request.custom_styles,
            request.ai_recommendations,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/art_direction/presets")
async def get_style_presets():
    """读取内置风格预设。"""
    try:
        preset_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "service/style_presets.json",
        )
        logger.debug("Loading presets from %s", preset_file)
        if not os.path.exists(preset_file):
            return {"presets": []}

        with open(preset_file, "r", encoding="utf-8") as file:
            data = json.load(file)
        return {"presets": data}
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


def _get_custom_prompt(script_id: str, field: str) -> str:
    """
    读取自定义提示词，按“分集 -> 系列 -> 系统默认”三级回退。

    如果最终结果等于系统默认值，则返回空字符串，
    这样下游 LLM 方法会直接使用内置默认提示词。
    """
    if not script_id:
        return ""
    script = pipeline.get_script(script_id)
    if not script:
        return ""
    series = pipeline.get_series(script.series_id) if script.series_id else None
    effective = pipeline.get_effective_prompt(field, script, series)
    defaults = {
        "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
        "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
        "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
    }
    if effective == defaults.get(field, ""):
        return ""
    return effective


@router.post("/video/polish_prompt")
async def polish_video_prompt(request: PolishVideoPromptRequest):
    """调用 LLM 润色视频提示词，并返回中英文结果。"""
    try:
        custom_prompt = _get_custom_prompt(request.script_id, "video_polish")
        processor = ScriptProcessor()
        result = processor.polish_video_prompt(
            request.draft_prompt,
            request.feedback,
            custom_prompt,
        )
        return {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", ""),
        }
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/video/polish_r2v_prompt")
async def polish_r2v_prompt(request: PolishR2VPromptRequest):
    """调用 LLM 润色 R2V 提示词，并返回中英文结果。"""
    try:
        custom_prompt = _get_custom_prompt(request.script_id, "r2v_polish")
        processor = ScriptProcessor()
        slot_info = [{"description": slot.description} for slot in request.slots]
        result = processor.polish_r2v_prompt(
            request.draft_prompt,
            slot_info,
            request.feedback,
            custom_prompt,
        )
        return {
            "prompt_cn": result.get("prompt_cn", ""),
            "prompt_en": result.get("prompt_en", ""),
        }
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))
