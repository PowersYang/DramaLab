"""
项目核心路由：项目本体、角色、场景、道具与项目级风格。
"""

import hashlib
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from ..application.services import CharacterService, ProjectService, PropService, SceneService
from ..application.services.art_direction_resolution_service import ArtDirectionResolutionService
from ..application.tasks import TaskService
from ..auth.constants import CAP_ASSET_EDIT, CAP_PROJECT_CREATE, CAP_PROJECT_DELETE, CAP_PROJECT_EDIT
from ..auth.dependencies import RequestContext, get_request_context, require_capability
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
    UpdateProjectArtDirectionOverrideRequest,
    UpdateStyleRequest, UpdatePromptConfigRequest, UpdateModelSettingsRequest,
)
from ..schemas.task_models import TaskReceipt


router = APIRouter(dependencies=[Depends(get_request_context)])
logger = get_logger(__name__)
project_service = ProjectService()
character_service = CharacterService()
scene_service = SceneService()
prop_service = PropService()
asset_workflow = AssetWorkflow()
task_service = TaskService()
art_direction_resolution_service = ArtDirectionResolutionService()


@router.post("/projects", response_model=Script)
async def create_project(
    request: CreateProjectRequest,
    skip_analysis: bool = False,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_CREATE)),
):
    """根据小说文本创建新项目。"""
    # 路由层只记录轻量上下文，避免和请求中间件重复打印完整正文。
    logger.info("项目接口：创建项目 标题=%s 跳过解析=%s", request.title, skip_analysis)
    result = project_service.create_project(
        request.title,
        request.text,
        skip_analysis,
        organization_id=context.current_organization_id,
        workspace_id=context.current_workspace_id,
        created_by=context.user.id,
    )
    logger.info("项目接口：创建项目 完成 项目ID=%s", result.id)
    return signed_response(result)


@router.put("/projects/{script_id}/reparse", response_model=TaskReceipt)
async def reparse_project(
    script_id: str,
    request: ReparseProjectRequest,
    http_request: Request,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """重新解析已有项目文本，并替换其中的实体数据。"""
    request_id = getattr(http_request.state, "request_id", None)
    try:
        logger.info("项目接口：重新解析项目 项目ID=%s 请求ID=%s", script_id, request_id)
        project = project_service.get_project(script_id)
        if not project:
            raise ValueError("项目不存在")
        if project.workspace_id != context.current_workspace_id:
            raise ValueError("项目不存在")
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
            "项目接口：重新解析项目 已入队 项目ID=%s 请求ID=%s 任务ID=%s",
            script_id,
            request_id,
            receipt.job_id,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning(
            "项目接口：重新解析项目 未找到 项目ID=%s 请求ID=%s 详情=%s",
            script_id,
            request_id,
            exc,
        )
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("项目接口：重新解析项目 发生未预期异常 项目ID=%s 请求ID=%s", script_id, request_id)
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
async def list_projects(context: RequestContext = Depends(get_request_context)):
    """列出后端当前保存的全部项目。"""
    started_at = time.perf_counter()
    projects = project_service.list_projects(workspace_id=context.current_workspace_id)
    logger.info(
        "项目接口：列出项目 数量=%s 工作区ID=%s 耗时ms=%.2f",
        len(projects),
        context.current_workspace_id,
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(projects)


@router.get("/projects/briefs", response_model=list[dict])
async def list_project_briefs(context: RequestContext = Depends(get_request_context)):
    """返回轻量项目列表，供任务中心等弱依赖页面使用。"""
    started_at = time.perf_counter()
    projects = project_service.list_project_briefs(workspace_id=context.current_workspace_id)
    logger.info(
        "项目接口：列出项目简表 数量=%s 耗时ms=%.2f",
        len(projects),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(projects)


@router.get("/projects/summaries", response_model=list[dict])
async def list_project_summaries(context: RequestContext = Depends(get_request_context)):
    """返回项目中心卡片所需的轻量汇总数据。"""
    started_at = time.perf_counter()
    projects = project_service.list_project_summaries(workspace_id=context.current_workspace_id)
    logger.info(
        "项目接口：列出项目汇总 数量=%s 耗时ms=%.2f",
        len(projects),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(projects)


@router.get("/projects/{script_id}", response_model=Script)
async def get_project(script_id: str, context: RequestContext = Depends(get_request_context)):
    """按项目 ID 读取项目详情。"""
    started_at = time.perf_counter()
    script = project_service.get_project(script_id)
    if not script:
        logger.warning("项目接口：获取项目 未找到 项目ID=%s", script_id)
        raise HTTPException(status_code=404, detail="项目不存在")
    if script.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    script = art_direction_resolution_service.apply_resolved_art_direction(script)
    logger.info(
        "项目接口：获取项目 命中 项目ID=%s 角色=%s 场景=%s 道具=%s 分镜=%s 视频任务=%s 耗时ms=%.2f",
        script_id,
        len(script.characters or []),
        len(script.scenes or []),
        len(script.props or []),
        len(script.frames or []),
        len(script.video_tasks or []),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(script)


@router.get("/projects/{script_id}/art_direction")
async def get_project_art_direction(
    script_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """返回项目当前生效的美术来源与解析结果。"""
    project = project_service.get_project(script_id)
    if not project or project.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return signed_response(art_direction_resolution_service.build_project_payload(project))


@router.put("/projects/{script_id}/art_direction/override")
async def update_project_art_direction_override(
    script_id: str,
    request: UpdateProjectArtDirectionOverrideRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """保存项目级美术覆写；系列项目会标记为已偏离剧集。"""
    project = project_service.get_project(script_id)
    if not project or project.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    updated = art_direction_resolution_service.save_project_override(
        script_id,
        selected_style_id=request.selected_style_id,
        style_config=request.style_config,
        updated_by=context.user.id,
    )
    return signed_response(updated)


@router.delete("/projects/{script_id}/art_direction/override")
async def clear_project_art_direction_override(
    script_id: str,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """清空项目级美术覆写，恢复继承剧集。"""
    project = project_service.get_project(script_id)
    if not project or project.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="项目不存在")
    updated = art_direction_resolution_service.clear_project_override(script_id, updated_by=context.user.id)
    return signed_response(updated)


@router.delete("/projects/{script_id}")
async def delete_project(
    script_id: str,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_DELETE)),
):
    """按 ID 删除项目。注意：这是永久删除。"""
    try:
        logger.info("项目接口：删除项目 项目ID=%s", script_id)
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("项目不存在")
        result = project_service.delete_project(script_id)
        logger.info("项目接口：删除项目 完成 项目ID=%s", script_id)
        return result
    except ValueError as exc:
        logger.warning("项目接口：删除项目 未找到 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("项目接口：删除项目 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/sync_descriptions", response_model=TaskReceipt)
async def sync_descriptions(
    script_id: str,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """把脚本模块里的实体描述同步回素材模块。"""
    try:
        logger.info("项目接口：同步描述 项目ID=%s", script_id)
        project = project_service.get_project(script_id)
        if not project:
            raise ValueError("项目不存在")
        if project.workspace_id != context.current_workspace_id:
            raise ValueError("项目不存在")
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
        logger.info("项目接口：同步描述 已入队 项目ID=%s 任务ID=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("项目接口：同步描述 未找到 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("项目接口：同步描述 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters", response_model=Script)
async def add_character(
    script_id: str,
    request: AddCharacterRequest,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """新增角色。"""
    try:
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("Script not found")
        updated_script = character_service.create_character(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/characters/{char_id}", response_model=Script)
async def delete_character(
    script_id: str,
    char_id: str,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """删除角色。"""
    try:
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("Script not found")
        updated_script = character_service.delete_character(script_id, char_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/scenes", response_model=Script)
async def add_scene(
    script_id: str,
    request: AddSceneRequest,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """新增场景。"""
    try:
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("Script not found")
        updated_script = scene_service.create_scene(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/scenes/{scene_id}", response_model=Script)
async def delete_scene(
    script_id: str,
    scene_id: str,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """删除场景。"""
    try:
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("Script not found")
        updated_script = scene_service.delete_scene(script_id, scene_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/projects/{script_id}/style", response_model=Script)
async def update_project_style(
    script_id: str,
    request: UpdateStyleRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """更新项目的全局风格设置。"""
    try:
        logger.info("项目接口：更新项目风格 项目ID=%s 风格预设=%s", script_id, request.style_preset)
        project = project_service.get_project(script_id)
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("项目不存在")
        updated_script = project_service.update_style(script_id, request.style_preset, request.style_prompt)
        logger.info("项目接口：更新项目风格 完成 项目ID=%s", script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("项目接口：更新项目风格 未找到 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("项目接口：更新项目风格 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_assets")
async def generate_assets(script_id: str, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """触发项目素材生成。"""
    logger.info("项目接口：生成项目素材 项目ID=%s", script_id)
    script = project_service.get_project(script_id)
    if not script:
        logger.warning("项目接口：生成项目素材 未找到 项目ID=%s", script_id)
        raise HTTPException(status_code=404, detail="项目不存在")
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
        logger.info("项目接口：生成项目素材 已入队 项目ID=%s 任务ID=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("项目接口：生成项目素材 发生未预期异常 项目ID=%s", script_id)
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
        logger.info("项目接口：更新模型配置 项目ID=%s", script_id)
        updated_script = project_service.update_model_settings(script_id, **request.model_dump())
        logger.info("项目接口：更新模型配置 完成 项目ID=%s", script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("项目接口：更新模型配置 未找到 项目ID=%s 详情=%s", script_id, exc)
        status_code = 400 if "model" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))
    except Exception as exc:
        logger.exception("项目接口：更新模型配置 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects/{script_id}/prompt_config")
async def get_prompt_config(script_id: str):
    """读取项目自定义提示词配置，并附带系统默认值。"""
    try:
        logger.info("项目接口：获取项目提示词配置 项目ID=%s", script_id)
        script = project_service.get_project(script_id)
        if not script:
            logger.warning("项目接口：获取项目提示词配置 未找到 项目ID=%s", script_id)
            raise HTTPException(status_code=404, detail="项目不存在")
        config = script.prompt_config if hasattr(script, "prompt_config") else PromptConfig()
        logger.info("项目接口：获取项目提示词配置 完成 项目ID=%s", script_id)
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
        logger.exception("项目接口：获取项目提示词配置 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/projects/{script_id}/prompt_config")
async def update_prompt_config(script_id: str, request: UpdatePromptConfigRequest):
    """更新项目自定义提示词配置；空字符串表示回退系统默认值。"""
    try:
        logger.info("项目接口：更新项目提示词配置 项目ID=%s", script_id)
        config = project_service.update_prompt_config(
            script_id,
            storyboard_polish=request.storyboard_polish,
            video_polish=request.video_polish,
            r2v_polish=request.r2v_polish,
        )
        logger.info("项目接口：更新项目提示词配置 完成 项目ID=%s", script_id)
        return {"prompt_config": config.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("项目接口：更新项目提示词配置 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
