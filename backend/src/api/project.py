"""
项目核心路由：项目本体、角色、场景、道具与项目级风格。
"""

import hashlib

from fastapi import APIRouter, Header, HTTPException, Request

from ..application.services import CharacterService, ProjectService, PropService, SceneService
from ..application.tasks import TaskService
from ..application.workflows import AssetWorkflow
from ..common.log import get_logger
from ..providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from ..schemas.models import PromptConfig, Script
from ..common import signed_response
from ..schemas.requests import (
    AddCharacterRequest,
    AddSceneRequest,
    CreateProjectRequest,
    CreatePropRequest,
    ReparseProjectRequest,
    UpdateStyleRequest, UpdatePromptConfigRequest, UpdateModelSettingsRequest,
)
from ..schemas.task_models import TaskReceipt


router = APIRouter()
logger = get_logger(__name__)
project_service = ProjectService()
character_service = CharacterService()
scene_service = SceneService()
prop_service = PropService()
asset_workflow = AssetWorkflow()
task_service = TaskService()


@router.post("/projects", response_model=Script)
async def create_project(request: CreateProjectRequest, skip_analysis: bool = False):
    """根据小说文本创建新项目。"""
    # 路由层只记录轻量上下文，避免和请求中间件重复打印完整正文。
    logger.info("PROJECT_API: create_project title=%s skip_analysis=%s", request.title, skip_analysis)
    result = project_service.create_project(request.title, request.text, skip_analysis)
    logger.info("PROJECT_API: create_project completed project_id=%s", result.id)
    return signed_response(result)


@router.put("/projects/{script_id}/reparse", response_model=TaskReceipt)
async def reparse_project(
    script_id: str,
    request: ReparseProjectRequest,
    http_request: Request,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """重新解析已有项目文本，并替换其中的实体数据。"""
    request_id = getattr(http_request.state, "request_id", None)
    try:
        logger.info("PROJECT_API: reparse_project script_id=%s request_id=%s", script_id, request_id)
        project = project_service.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        text_digest = hashlib.sha256((request.text or "").encode("utf-8")).hexdigest()[:16]
        receipt = task_service.create_job(
            task_type="project.reparse",
            payload={"project_id": script_id, "text": request.text},
            project_id=script_id,
            queue_name="llm",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=f"project_reparse:{text_digest}",
        )
        logger.info(
            "PROJECT_API: reparse_project queued script_id=%s request_id=%s job_id=%s",
            script_id,
            request_id,
            receipt.job_id,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning(
            "PROJECT_API: reparse_project not_found script_id=%s request_id=%s detail=%s",
            script_id,
            request_id,
            exc,
        )
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("PROJECT_API: reparse_project failed script_id=%s request_id=%s", script_id, request_id)
        # 把 request_id 回传给前端，便于代理层报错后快速定位到后端异常栈。
        raise HTTPException(
            status_code=500,
            detail={
                "message": str(exc),
                "request_id": request_id,
            },
        )


@router.get("/projects", response_model=list[dict])
@router.get("/projects/", response_model=list[dict])
async def list_projects():
    """列出后端当前保存的全部项目。"""
    projects = project_service.list_projects()
    logger.info("PROJECT_API: list_projects count=%s", len(projects))
    return signed_response(projects)


@router.get("/projects/{script_id}", response_model=Script)
async def get_project(script_id: str):
    """按项目 ID 读取项目详情。"""
    script = project_service.get_project(script_id)
    if not script:
        logger.warning("PROJECT_API: get_project not_found script_id=%s", script_id)
        raise HTTPException(status_code=404, detail="Project not found")
    logger.info("PROJECT_API: get_project hit script_id=%s", script_id)
    return signed_response(script)


@router.delete("/projects/{script_id}")
async def delete_project(script_id: str):
    """按 ID 删除项目。注意：这是永久删除。"""
    try:
        logger.info("PROJECT_API: delete_project script_id=%s", script_id)
        result = project_service.delete_project(script_id)
        logger.info("PROJECT_API: delete_project completed script_id=%s", script_id)
        return result
    except ValueError as exc:
        logger.warning("PROJECT_API: delete_project not_found script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("PROJECT_API: delete_project failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/sync_descriptions", response_model=TaskReceipt)
async def sync_descriptions(script_id: str, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """把脚本模块里的实体描述同步回素材模块。"""
    try:
        logger.info("PROJECT_API: sync_descriptions script_id=%s", script_id)
        project = project_service.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        receipt = task_service.create_job(
            task_type="project.sync_descriptions",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="llm",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=900,
            idempotency_key=idempotency_key,
            dedupe_scope="project_sync_descriptions",
        )
        logger.info("PROJECT_API: sync_descriptions queued script_id=%s job_id=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("PROJECT_API: sync_descriptions not_found script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("PROJECT_API: sync_descriptions failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters", response_model=Script)
async def add_character(script_id: str, request: AddCharacterRequest):
    """新增角色。"""
    try:
        updated_script = character_service.create_character(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/characters/{char_id}", response_model=Script)
async def delete_character(script_id: str, char_id: str):
    """删除角色。"""
    try:
        updated_script = character_service.delete_character(script_id, char_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/scenes", response_model=Script)
async def add_scene(script_id: str, request: AddSceneRequest):
    """新增场景。"""
    try:
        updated_script = scene_service.create_scene(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/scenes/{scene_id}", response_model=Script)
async def delete_scene(script_id: str, scene_id: str):
    """删除场景。"""
    try:
        updated_script = scene_service.delete_scene(script_id, scene_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/projects/{script_id}/style", response_model=Script)
async def update_project_style(script_id: str, request: UpdateStyleRequest):
    """更新项目的全局风格设置。"""
    try:
        logger.info("PROJECT_API: update_project_style script_id=%s style_preset=%s", script_id, request.style_preset)
        updated_script = project_service.update_style(script_id, request.style_preset, request.style_prompt)
        logger.info("PROJECT_API: update_project_style completed script_id=%s", script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("PROJECT_API: update_project_style not_found script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("PROJECT_API: update_project_style failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_assets")
async def generate_assets(script_id: str, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """触发项目素材生成。"""
    logger.info("PROJECT_API: generate_assets script_id=%s", script_id)
    script = project_service.get_project(script_id)
    if not script:
        logger.warning("PROJECT_API: generate_assets not_found script_id=%s", script_id)
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        asset_workflow.prepare_generate_assets(script_id)
        receipt = task_service.create_job(
            task_type="asset.generate_batch",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="image",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="generate-assets",
        )
        logger.info("PROJECT_API: generate_assets queued script_id=%s job_id=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("PROJECT_API: generate_assets failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/props")
async def create_prop(script_id: str, request: CreatePropRequest):
    """在项目里新增道具。"""
    try:
        return signed_response(prop_service.create_prop(script_id, request.name, request.description))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/projects/{script_id}/props/{prop_id}")
async def delete_prop(script_id: str, prop_id: str):
    """从项目里删除道具。"""
    try:
        return signed_response(prop_service.delete_prop(script_id, prop_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/projects/{script_id}/model_settings", response_model=Script)
async def update_model_settings(script_id: str, request: UpdateModelSettingsRequest):
    """更新项目级模型配置与宽高比设置。"""
    try:
        logger.info("PROJECT_API: update_model_settings script_id=%s", script_id)
        updated_script = project_service.update_model_settings(script_id, **request.model_dump())
        logger.info("PROJECT_API: update_model_settings completed script_id=%s", script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("PROJECT_API: update_model_settings not_found script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("PROJECT_API: update_model_settings failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects/{script_id}/prompt_config")
async def get_prompt_config(script_id: str):
    """读取项目自定义提示词配置，并附带系统默认值。"""
    try:
        logger.info("PROJECT_API: get_prompt_config script_id=%s", script_id)
        script = project_service.get_project(script_id)
        if not script:
            logger.warning("PROJECT_API: get_prompt_config not_found script_id=%s", script_id)
            raise HTTPException(status_code=404, detail="Project not found")
        config = script.prompt_config if hasattr(script, "prompt_config") else PromptConfig()
        logger.info("PROJECT_API: get_prompt_config completed script_id=%s", script_id)
        return {
            "prompt_config": config.model_dump(),
            "defaults": {
                "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
                "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
                "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PROJECT_API: get_prompt_config failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/projects/{script_id}/prompt_config")
async def update_prompt_config(script_id: str, request: UpdatePromptConfigRequest):
    """更新项目自定义提示词配置；空字符串表示回退系统默认值。"""
    try:
        logger.info("PROJECT_API: update_prompt_config script_id=%s", script_id)
        config = project_service.update_prompt_config(
            script_id,
            storyboard_polish=request.storyboard_polish,
            video_polish=request.video_polish,
            r2v_polish=request.r2v_polish,
        )
        logger.info("PROJECT_API: update_prompt_config completed script_id=%s", script_id)
        return {"prompt_config": config.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PROJECT_API: update_prompt_config failed script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
