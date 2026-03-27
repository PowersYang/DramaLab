"""
系统路由：调试检查、文件导入、环境配置与通用工具接口。
"""

import os
import shutil
import sys
import uuid

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from ..application.tasks import TaskService
from ..application.services import SystemService
from src.settings.env_settings import (
    get_env,
    get_env_path,
    has_env,
    reload_env_settings,
    remove_env_keys,
    save_env_values,
)
from ..utils.endpoints import PROVIDER_DEFAULTS
from ..utils.oss_utils import OSSImageUploader
from ..utils.system_check import run_system_checks
from ..common import logger, signed_response
from ..schemas.requests import (
    AnalyzeStyleRequest,
    ConfirmImportRequest,
    EnvConfig,
    PolishR2VPromptRequest,
    PolishVideoPromptRequest,
    SaveArtDirectionRequest,
)
from ..schemas.task_models import TaskReceipt


router = APIRouter()
task_service = TaskService()
system_service = SystemService()


@router.get("/debug/config")
async def debug_config():
    """检查 OSS 与本地路径配置是否正常。"""
    logger.info("SYSTEM_API: debug_config")
    uploader = OSSImageUploader()
    return {
        "oss_configured": uploader.is_configured,
        "oss_bucket_initialized": uploader.bucket is not None,
        "oss_base_path": get_env("OSS_BASE_PATH", "lumenx"),
        "oss_public_base_url": get_env("OSS_PUBLIC_BASE_URL", ""),
        "output_dir_exists": os.path.exists("output"),
        "output_contents": os.listdir("output") if os.path.exists("output") else [],
        "cwd": os.getcwd(),
        "env_vars_present": {
            "OSS_ENDPOINT": has_env("OSS_ENDPOINT"),
            "OSS_BUCKET_NAME": has_env("OSS_BUCKET_NAME"),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": has_env("ALIBABA_CLOUD_ACCESS_KEY_ID"),
        },
    }


@router.get("/system/check")
async def check_system():
    """检查系统依赖与基础配置。"""
    logger.info("SYSTEM_API: check_system")
    return run_system_checks()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件，并返回可供前端访问的地址。"""
    try:
        logger.info("SYSTEM_API: upload_file filename=%s", file.filename)
        file_ext = os.path.splitext(file.filename)[1]
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join("output/uploads", filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        oss_url = OSSImageUploader().upload_image(file_path)
        if oss_url:
            logger.info("SYSTEM_API: upload_file uploaded_to_oss filename=%s", file.filename)
            return signed_response({"url": oss_url})

        raise RuntimeError("OSS upload failed. Static file mount has been removed, so local fallback URLs are no longer supported.")
    except Exception as exc:
        logger.exception("SYSTEM_API: upload_file unexpected_error filename=%s", file.filename)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/preview", response_model=TaskReceipt)
async def import_file_preview(
    file: UploadFile = File(...),
    suggested_episodes: int = 3,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """上传 txt/md 文件，并异步返回 LLM 预拆分任务。"""
    logger.info("SYSTEM_API: import_file_preview filename=%s suggested_episodes=%s", file.filename, suggested_episodes)
    if suggested_episodes < 1 or suggested_episodes > 50:
        raise HTTPException(status_code=400, detail="建议集数应在 1-50 之间")
    try:
        content_bytes = await file.read()
        text = content_bytes.decode("utf-8")
        if not text.strip():
            raise HTTPException(status_code=400, detail="文件内容为空")
        receipt = task_service.create_job(
            task_type="series.import.preview",
            payload={
                "filename": file.filename,
                "text": text,
                "suggested_episodes": suggested_episodes,
            },
            project_id=None,
            series_id=None,
            queue_name="llm",
            resource_type="series_import_preview",
            resource_id=file.filename,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=f"series_import_preview:{file.filename}:{len(text)}:{suggested_episodes}",
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("SYSTEM_API: import_file_preview invalid_request filename=%s detail=%s", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("SYSTEM_API: import_file_preview unexpected_error filename=%s", file.filename)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/confirm", response_model=TaskReceipt)
async def import_file_confirm(
    request: ConfirmImportRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """确认分集结果，并正式创建系列与分集项目。"""
    try:
        logger.info("SYSTEM_API: import_file_confirm title=%s episode_count=%s has_import_id=%s", request.title, len(request.episodes), bool(request.import_id))
        text = None
        if request.import_id:
            text = system_service.pop_import_text(request.import_id)
        if not text:
            text = request.text
        if not text:
            raise ValueError("No text available. Provide import_id or text.")
        receipt = task_service.create_job(
            task_type="series.import.confirm",
            payload={
                "title": request.title,
                "description": request.description,
                "text": text,
                "episodes": request.episodes,
                "import_id": request.import_id,
            },
            project_id=None,
            series_id=None,
            queue_name="llm",
            resource_type="series_import",
            resource_id=request.title,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=f"series_import_confirm:{request.title}:{len(request.episodes)}",
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("SYSTEM_API: import_file_confirm invalid_request title=%s detail=%s", request.title, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("SYSTEM_API: import_file_confirm unexpected_error title=%s", request.title)
        raise HTTPException(status_code=500, detail=str(exc))


def get_user_config_path() -> str:
    """
    返回当前环境下用户配置文件的存放路径。

    开发环境使用后端根目录下的 `.env`；
    打包应用使用用户目录下的 `config.json`。
    """
    return str(get_env_path())


def load_user_config():
    """从 .env 重新加载用户配置到当前进程缓存。"""
    try:
        reload_env_settings()
        logger.info("SYSTEM_API: load_user_config reloaded path=%s", get_user_config_path())
    except Exception as exc:
        logger.warning("Failed to reload config from %s: %s", get_user_config_path(), exc)


def save_user_config(config_dict: dict):
    """把用户配置持久化到 .env 文件。"""
    save_env_values(config_dict)


def remove_user_config_keys(keys: list):
    """从持久化配置中删除指定键。"""
    if not keys:
        return
    remove_env_keys(keys)


load_user_config()


@router.get("/config/info")
async def get_config_info():
    """返回当前配置存储模式与路径信息。"""
    logger.info("SYSTEM_API: get_config_info")
    config_path = get_user_config_path()
    return {
        "mode": "packaged" if getattr(sys, "frozen", False) else "development",
        "config_path": config_path,
        "config_exists": os.path.exists(config_path),
    }


@router.post("/config/env")
async def update_env_config(config: EnvConfig):
    """更新环境配置，并落盘保存。"""
    try:
        logger.info("SYSTEM_API: update_env_config")
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
                keys_to_remove.append(env_key)

        save_user_config(config_dict)
        remove_user_config_keys(keys_to_remove)
        reload_env_settings()

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
        logger.exception("SYSTEM_API: update_env_config unexpected_error")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/config/env")
async def get_env_config():
    """读取当前环境配置。"""
    try:
        logger.info("SYSTEM_API: get_env_config")
        endpoint_overrides = {}
        for provider in PROVIDER_DEFAULTS:
            env_key = f"{provider}_BASE_URL"
            value = get_env(env_key)
            if value:
                endpoint_overrides[env_key] = value

        return {
            "DASHSCOPE_API_KEY": get_env("DASHSCOPE_API_KEY", ""),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": get_env("ALIBABA_CLOUD_ACCESS_KEY_ID", ""),
            "ALIBABA_CLOUD_ACCESS_KEY_SECRET": get_env("ALIBABA_CLOUD_ACCESS_KEY_SECRET", ""),
            "OSS_BUCKET_NAME": get_env("OSS_BUCKET_NAME", ""),
            "OSS_ENDPOINT": get_env("OSS_ENDPOINT", ""),
            "OSS_BASE_PATH": get_env("OSS_BASE_PATH", ""),
            "OSS_PUBLIC_BASE_URL": get_env("OSS_PUBLIC_BASE_URL", ""),
            "KLING_ACCESS_KEY": get_env("KLING_ACCESS_KEY", ""),
            "KLING_SECRET_KEY": get_env("KLING_SECRET_KEY", ""),
            "VIDU_API_KEY": get_env("VIDU_API_KEY", ""),
            "ARK_API_KEY": get_env("ARK_API_KEY", ""),
            "LLM_PROVIDER": get_env("LLM_PROVIDER", ""),
            "LLM_REQUEST_TIMEOUT_SECONDS": get_env("LLM_REQUEST_TIMEOUT_SECONDS", ""),
            "LLM_MAX_RETRIES": get_env("LLM_MAX_RETRIES", ""),
            "OPENAI_API_KEY": get_env("OPENAI_API_KEY", ""),
            "OPENAI_BASE_URL": get_env("OPENAI_BASE_URL", ""),
            "OPENAI_MODEL": get_env("OPENAI_MODEL", ""),
            "POSTGRES_HOST": get_env("POSTGRES_HOST", ""),
            "POSTGRES_PORT": get_env("POSTGRES_PORT", ""),
            "POSTGRES_DB": get_env("POSTGRES_DB", ""),
            "POSTGRES_SCHEMA": get_env("POSTGRES_SCHEMA", ""),
            "POSTGRES_USER": get_env("POSTGRES_USER", ""),
            "POSTGRES_PASSWORD": get_env("POSTGRES_PASSWORD", ""),
            "DATABASE_URL": get_env("DATABASE_URL", ""),
            "endpoint_overrides": endpoint_overrides,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/art_direction/analyze")
async def analyze_script_for_styles(script_id: str, request: AnalyzeStyleRequest):
    """分析剧本内容，并用 LLM 推荐视觉风格。"""
    try:
        receipt = task_service.create_job(
            task_type="art_direction.analyze",
            payload={
                "project_id": script_id,
                "script_text": request.script_text,
            },
            project_id=script_id,
            queue_name="llm",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=600,
            dedupe_scope="art-direction-analyze",
        )
        return signed_response(receipt)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/art_direction/save")
async def save_art_direction(script_id: str, request: SaveArtDirectionRequest):
    """把美术指导配置保存到项目。"""
    try:
        updated_script = system_service.save_art_direction(
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
    """读取数据库中的可用风格预设。"""
    try:
        # 风格预设现在统一走数据库读取，避免本地文件在不同部署节点之间不一致。
        presets = system_service.list_style_presets()
        return {"presets": [preset.model_dump(mode="json") for preset in presets]}
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/video/polish_prompt", response_model=TaskReceipt)
async def polish_video_prompt(request: PolishVideoPromptRequest, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """调用 LLM 润色视频提示词，并返回中英文结果。"""
    try:
        receipt = task_service.create_job(
            task_type="video.polish_prompt",
            payload={
                "draft_prompt": request.draft_prompt,
                "feedback": request.feedback,
                "script_id": request.script_id,
            },
            project_id=request.script_id or None,
            series_id=None,
            queue_name="llm",
            resource_type="video_prompt",
            resource_id=request.script_id or "global",
            timeout_seconds=900,
            idempotency_key=idempotency_key,
            dedupe_scope=f"video_polish:{len(request.draft_prompt)}:{len(request.feedback)}",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/video/polish_r2v_prompt", response_model=TaskReceipt)
async def polish_r2v_prompt(request: PolishR2VPromptRequest, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """调用 LLM 润色 R2V 提示词，并返回中英文结果。"""
    try:
        receipt = task_service.create_job(
            task_type="video.polish_r2v_prompt",
            payload={
                "draft_prompt": request.draft_prompt,
                "slots": [{"description": slot.description} for slot in request.slots],
                "feedback": request.feedback,
                "script_id": request.script_id,
            },
            project_id=request.script_id or None,
            series_id=None,
            queue_name="llm",
            resource_type="r2v_prompt",
            resource_id=request.script_id or "global",
            timeout_seconds=900,
            idempotency_key=idempotency_key,
            dedupe_scope=f"r2v_polish:{len(request.draft_prompt)}:{len(request.slots)}:{len(request.feedback)}",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))
