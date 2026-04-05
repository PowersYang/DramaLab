"""系统路由：调试检查、文件导入、环境配置与通用工具接口。"""

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from ..application.tasks import TaskService
from ..application.services import SystemService
from ..application.services.model_provider_service import ModelProviderService
from ..auth.dependencies import RequestContext, get_request_context
from src.settings.env_settings import get_env, has_env
from ..utils.oss_utils import OSSImageUploader
from ..utils.system_check import run_system_checks
from ..utils.temp_media import staged_upload_file
from ..common import logger, signed_response
from ..schemas.requests import (
    AnalyzeStyleRequest,
    ConfirmImportRequest,
    PolishR2VPromptRequest,
    PolishVideoPromptRequest,
    SaveArtDirectionRequest,
    SaveUserArtStylesRequest,
)
from ..schemas.task_models import TaskReceipt


router = APIRouter(dependencies=[Depends(get_request_context)])
task_service = TaskService()
system_service = SystemService()
model_provider_service = ModelProviderService()


@router.get("/debug/config")
async def debug_config():
    """检查 OSS 配置是否正常。"""
    logger.info("系统接口：调试配置")
    uploader = OSSImageUploader()
    return {
        "oss_configured": uploader.is_configured,
        "oss_bucket_initialized": uploader.bucket is not None,
        "oss_base_path": get_env("OSS_BASE_PATH", "dramalab"),
        "oss_public_base_url": get_env("OSS_PUBLIC_BASE_URL", ""),
        "local_output_mount_enabled": False,
        "env_vars_present": {
            "OSS_ENDPOINT": has_env("OSS_ENDPOINT"),
            "OSS_BUCKET_NAME": has_env("OSS_BUCKET_NAME"),
            "ALIBABA_CLOUD_ACCESS_KEY_ID": has_env("ALIBABA_CLOUD_ACCESS_KEY_ID"),
        },
    }


@router.get("/system/check")
async def check_system():
    """检查系统依赖与基础配置。"""
    logger.info("系统接口：系统检查")
    return run_system_checks()


@router.get("/system/models/available")
async def get_available_models():
    """返回当前平台已启用的业务可用模型。"""
    logger.info("系统接口：获取可用模型")
    return signed_response(model_provider_service.list_available_models())


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件，并返回可供前端访问的地址。"""
    try:
        logger.info("系统接口：上传文件 文件名=%s", file.filename)
        with staged_upload_file(file.file, file.filename) as file_path:
            oss_url = OSSImageUploader().upload_image(file_path, sub_path="uploads")
            if oss_url:
                logger.info("系统接口：上传文件 已上传到OSS 文件名=%s", file.filename)
                return signed_response({"url": oss_url})

        raise RuntimeError("OSS 上传失败。由于已移除本地静态文件挂载，无法再回退到本地 URL。")
    except Exception as exc:
        logger.exception("系统接口：上传文件 发生未预期异常 文件名=%s", file.filename)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/preview", response_model=TaskReceipt)
async def import_file_preview(
    file: UploadFile = File(...),
    suggested_episodes: int = 3,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """上传 txt/md 文件，并异步返回 LLM 预拆分任务。"""
    logger.info("系统接口：导入文件预览 文件名=%s 建议集数=%s", file.filename, suggested_episodes)
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
        logger.warning("系统接口：导入文件预览 参数非法 文件名=%s 详情=%s", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("系统接口：导入文件预览 发生未预期异常 文件名=%s", file.filename)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/import/confirm", response_model=TaskReceipt)
async def import_file_confirm(
    request: ConfirmImportRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """确认分集结果，并正式创建系列与分集项目。"""
    try:
        logger.info("系统接口：确认导入 标题=%s 分集数=%s 是否带import_id=%s", request.title, len(request.episodes), bool(request.import_id))
        text = None
        if request.import_id:
            text = system_service.pop_import_text(request.import_id)
        if not text:
            text = request.text
        if not text:
            raise ValueError("没有可用的文本，请提供 import_id 或 text。")
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
        logger.warning("系统接口：确认导入 参数非法 标题=%s 详情=%s", request.title, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("系统接口：确认导入 发生未预期异常 标题=%s", request.title)
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
        logger.exception("系统接口：美术指导风格分析发生未预期异常 script_id=%s", script_id)
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
        logger.exception("系统接口：保存美术指导发生未预期异常 script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/art_direction/presets")
async def get_style_presets():
    """读取数据库中的可用风格预设。"""
    try:
        # 风格预设现在统一走数据库读取，避免本地文件在不同部署节点之间不一致。
        presets = system_service.list_style_presets()
        return {"presets": [preset.model_dump(mode="json") for preset in presets]}
    except Exception as exc:
        logger.exception("系统接口：读取风格预设发生未预期异常")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/art_direction/user-styles")
async def get_user_art_styles(context: RequestContext = Depends(get_request_context)):
    """读取当前登录用户保存过的自定义美术风格。"""
    try:
        styles = system_service.list_user_art_styles(context.user.id)
        return signed_response({"styles": styles})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系统接口：读取用户美术风格发生未预期异常 user_id=%s", context.user.id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/art_direction/user-styles")
async def save_user_art_styles(request: SaveUserArtStylesRequest, context: RequestContext = Depends(get_request_context)):
    """整体更新当前登录用户的自定义美术风格库。"""
    try:
        styles = system_service.save_user_art_styles(context.user.id, request.styles)
        return signed_response({"styles": styles})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系统接口：保存用户美术风格发生未预期异常 user_id=%s", context.user.id)
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
        logger.exception("系统接口：润色视频提示词发生未预期异常 script_id=%s", request.script_id)
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
        logger.exception("系统接口：润色R2V提示词发生未预期异常 script_id=%s", request.script_id)
        raise HTTPException(status_code=500, detail=str(exc))
