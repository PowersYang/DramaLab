"""
系列路由：系列基础信息、分集关系、共享素材与系列级配置。
"""

import hashlib
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from ..application.tasks import TaskService
from ..application.services import ProjectService, SeriesService
from ..application.services.art_direction_resolution_service import ArtDirectionResolutionService
from ..application.services.series_asset_inbox_service import SeriesAssetInboxService
from ..application.services.series_command_service import SeriesCommandService
from ..auth.constants import CAP_ASSET_EDIT, CAP_PROJECT_CREATE, CAP_PROJECT_EDIT
from ..auth.dependencies import RequestContext, get_request_context, require_capability
from ..application.workflows import AssetWorkflow, SeriesWorkflow
from ..common.log import get_logger
from ..providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from ..schemas.models import PromptConfig
from ..schemas.models import Script
from ..common import signed_response
from ..schemas.task_models import TaskReceipt
from ..schemas.requests import (
    AddEpisodeRequest,
    CreateEpisodeRequest,
    CreateSeriesRequest,
    ExtractSeriesAssetsRequest,
    GenerateAssetRequest,
    GenerateMotionRefRequest,
    ImportAssetsRequest,
    RemoveSeriesAssetInboxItemsRequest,
    SelectVariantRequest,
    SyncSeriesAssetsRequest,
    ToggleLockRequest,
    UpsertSeriesAssetInboxRequest,
    UpdateAssetAttributesRequest,
    UpdateAssetImageRequest,
    UpdateModelSettingsRequest,
    UpdateSeriesArtDirectionRequest,
    UpdateSeriesRequest,
)


router = APIRouter(dependencies=[Depends(get_request_context)])
logger = get_logger(__name__)
series_service = SeriesService()
project_service = ProjectService()
series_workflow = SeriesWorkflow()
asset_workflow = AssetWorkflow()
task_service = TaskService()
series_command_service = SeriesCommandService()
art_direction_resolution_service = ArtDirectionResolutionService()
series_asset_inbox_service = SeriesAssetInboxService()

# 中文注释：系列动作参考任务单独走专用队列，避免旧版本 worker 在共享 video 队列里抢到任务后走错执行分支。
SERIES_MOTION_REF_QUEUE = "video_series_motion"


@router.post("/series")
async def create_series(
    request: CreateSeriesRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_CREATE)),
):
    """创建一个新的系列。"""
    # 系列创建属于项目组织入口，记录标题和是否含描述，便于排查导入或手工创建来源。
    logger.info("系列接口：创建系列 标题=%s 是否有简介=%s", request.title, bool(request.description))
    series = series_service.create_series(
        request.title,
        request.description,
        organization_id=context.current_organization_id,
        workspace_id=context.current_workspace_id,
        created_by=context.user.id,
    )
    logger.info("系列接口：创建系列 完成 系列ID=%s", series.id)
    return signed_response(series)


@router.get("/series")
async def list_series(context: RequestContext = Depends(get_request_context)):
    """列出所有系列。"""
    started_at = time.perf_counter()
    series_list = series_service.list_series(workspace_id=context.current_workspace_id)
    logger.info(
        "系列接口：列出系列 数量=%s 工作区ID=%s 耗时ms=%.2f",
        len(series_list),
        context.current_workspace_id,
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(series_list)


@router.get("/series/briefs")
async def list_series_briefs(context: RequestContext = Depends(get_request_context)):
    """返回轻量系列列表，供任务中心等列表页使用。"""
    started_at = time.perf_counter()
    series_list = series_service.list_series_briefs(workspace_id=context.current_workspace_id)
    logger.info(
        "系列接口：列出系列简表 数量=%s 耗时ms=%.2f",
        len(series_list),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(series_list)


@router.get("/series/summaries")
async def list_series_summaries(context: RequestContext = Depends(get_request_context)):
    """返回项目中心系列卡片所需的轻量汇总数据。"""
    started_at = time.perf_counter()
    series_list = series_service.list_series_summaries(workspace_id=context.current_workspace_id)
    logger.info(
        "系列接口：列出系列汇总 数量=%s 耗时ms=%.2f",
        len(series_list),
        (time.perf_counter() - started_at) * 1000,
    )
    return signed_response(series_list)


@router.get("/series/{series_id}")
async def get_series(
    series_id: str,
    include_episodes: bool = True,
    context: RequestContext = Depends(get_request_context),
):
    """获取系列详情，包括共享素材和分集列表。"""
    logger.info("系列接口：获取系列 系列ID=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("系列接口：获取系列 未找到 系列ID=%s", series_id)
        raise HTTPException(status_code=404, detail="系列不存在")
    if series.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="系列不存在")

    result = series.model_dump()
    if include_episodes:
        episodes = series_service.get_episodes(series_id)
        result["episodes"] = [
            {
                "id": episode.id,
                "title": episode.title,
                "episode_number": episode.episode_number,
                "created_at": episode.created_at,
                "updated_at": episode.updated_at,
            }
            for episode in episodes
        ]
        logger.info("系列接口：获取系列 完成 系列ID=%s 分集数=%s", series_id, len(episodes))
    else:
        logger.info("系列接口：获取系列 完成 系列ID=%s 分集=跳过", series_id)
    return signed_response(result)


@router.post("/series/{series_id}/assets/extract", response_model=TaskReceipt)
async def extract_series_assets(
    series_id: str,
    request: ExtractSeriesAssetsRequest,
    http_request: Request,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """提交系列资产识别任务，只返回候选结果预览，不直接写库。"""
    request_id = getattr(http_request.state, "request_id", None)
    try:
        logger.info("系列接口：识别系列资产 系列ID=%s 请求ID=%s", series_id, request_id)
        series = series_service.get_series(series_id)
        if not series or series.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        text_digest = hashlib.sha256((request.text or "").encode("utf-8")).hexdigest()[:16]
        receipt = task_service.create_job(
            task_type="series.assets.extract",
            payload={"series_id": series_id, "text": request.text},
            project_id=None,
            series_id=series_id,
            queue_name="llm",
            resource_type="series",
            resource_id=series_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope=f"series_assets_extract:{series_id}:{text_digest}",
        )
        logger.info(
            "系列接口：识别系列资产 已入队 系列ID=%s 请求ID=%s 任务ID=%s",
            series_id,
            request_id,
            receipt.job_id,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("系列接口：识别系列资产 未找到 系列ID=%s 请求ID=%s 详情=%s", series_id, request_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：识别系列资产 发生未预期异常 系列ID=%s 请求ID=%s", series_id, request_id)
        raise HTTPException(
            status_code=500,
            detail={
                "message": str(exc),
                "request_id": request_id,
            },
        )


@router.put("/series/{series_id}")
async def update_series(
    series_id: str,
    request: UpdateSeriesRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """更新系列标题或简介。"""
    try:
        updates = {
            key: value for key, value in request.model_dump().items() if value is not None
        }
        logger.info("系列接口：更新系列 系列ID=%s 字段=%s", series_id, sorted(updates.keys()))
        existing = series_service.get_series(series_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        series = series_service.update_series(series_id, updates)
        logger.info("系列接口：更新系列 完成 系列ID=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：更新系列 未找到 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/art_direction")
async def get_series_art_direction(
    series_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """返回剧集美术主档。"""
    series = series_service.get_series(series_id)
    if not series or series.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="系列不存在")
    return signed_response(
        {
            "series_id": series.id,
            "art_direction": series.art_direction.model_dump(mode="json") if series.art_direction else None,
            "art_direction_updated_at": series.art_direction_updated_at,
            "art_direction_updated_by": series.art_direction_updated_by,
        }
    )


@router.put("/series/{series_id}/art_direction")
async def update_series_art_direction(
    series_id: str,
    request: UpdateSeriesArtDirectionRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """更新剧集级美术主档。"""
    series = series_service.get_series(series_id)
    if not series or series.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="系列不存在")
    updated = art_direction_resolution_service.save_series_art_direction(
        series_id,
        selected_style_id=request.selected_style_id,
        style_config=request.style_config,
        ai_recommendations=request.ai_recommendations,
        updated_by=context.user.id,
    )
    return signed_response(updated)


@router.get("/series/{series_id}/art_direction/projects")
async def list_series_art_direction_projects(
    series_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """返回剧集下各项目的美术来源状态摘要。"""
    series = series_service.get_series(series_id)
    if not series or series.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="系列不存在")
    episodes = series_service.get_episodes(series_id)
    payload = [
        {
            "project_id": episode.id,
            "title": episode.title,
            "episode_number": episode.episode_number,
            "source": art_direction_resolution_service.build_project_payload(episode)["source"],
            "is_dirty_from_series": art_direction_resolution_service.build_project_payload(episode)["is_dirty_from_series"],
        }
        for episode in episodes
    ]
    return signed_response({"projects": payload})


@router.delete("/series/{series_id}")
async def delete_series(
    series_id: str,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """删除系列，并解除与各分集的关联。"""
    try:
        logger.info("系列接口：删除系列 系列ID=%s", series_id)
        existing = series_service.get_series(series_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        series_service.delete_series(series_id)
        logger.info("系列接口：删除系列 完成 系列ID=%s", series_id)
        return {"status": "deleted"}
    except ValueError as exc:
        logger.warning("系列接口：删除系列 未找到 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/series/{series_id}/episodes")
async def add_episode_to_series(
    series_id: str,
    request: AddEpisodeRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """把一个已有项目挂到系列里，作为某一集。"""
    try:
        logger.info(
            "系列接口：添加分集 系列ID=%s 项目ID=%s 集数=%s",
            series_id,
            request.script_id,
            request.episode_number,
        )
        existing = series_service.get_series(series_id)
        project = project_service.get_project(request.script_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        if not project or project.workspace_id != context.current_workspace_id:
            raise ValueError("项目不存在")
        series = series_service.add_episode(series_id, request.script_id, request.episode_number)
        logger.info("系列接口：添加分集 完成 系列ID=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：添加分集 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/series/{series_id}/episodes/create", response_model=Script)
async def create_episode_in_series(
    series_id: str,
    request: CreateEpisodeRequest,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    try:
        logger.info(
            "系列接口：创建分集草稿 系列ID=%s 标题=%s 集数=%s",
            series_id,
            request.title,
            request.episode_number,
        )
        existing = series_service.get_series(series_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        project = series_service.create_episode_draft(
            series_id=series_id,
            title=request.title,
            text=request.text,
            episode_number=request.episode_number,
            organization_id=context.current_organization_id,
            workspace_id=context.current_workspace_id,
            created_by=context.user.id,
        )
        logger.info("系列接口：创建分集草稿 完成 系列ID=%s 项目ID=%s", series_id, project.id)
        return signed_response(project)
    except ValueError as exc:
        logger.warning("系列接口：创建分集草稿 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/series/{series_id}/episodes/{script_id}")
async def remove_episode_from_series(
    series_id: str,
    script_id: str,
    context: RequestContext = Depends(require_capability(CAP_PROJECT_EDIT)),
):
    """把某一集从系列里移除，但不删除项目本身。"""
    try:
        logger.info("系列接口：移除分集 系列ID=%s 项目ID=%s", series_id, script_id)
        existing = series_service.get_series(series_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        series = series_service.remove_episode(series_id, script_id)
        logger.info("系列接口：移除分集 完成 系列ID=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：移除分集 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/episodes")
async def get_series_episodes(series_id: str, context: RequestContext = Depends(get_request_context)):
    """获取某个系列下的全部分集。"""
    try:
        existing = series_service.get_series(series_id)
        if not existing or existing.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        episodes = series_service.get_episodes(series_id)
        logger.info("系列接口：获取分集列表 系列ID=%s 数量=%s", series_id, len(episodes))
        return signed_response(episodes)
    except ValueError as exc:
        logger.warning("系列接口：获取分集列表 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/episode_briefs")
async def get_series_episode_briefs(series_id: str, context: RequestContext = Depends(get_request_context)):
    """获取某个系列下的轻量分集列表，避免列表页加载完整项目聚合。"""
    try:
        started_at = time.perf_counter()
        series = series_service.get_series(series_id)
        if not series or series.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        episodes = project_service.list_episode_briefs(series_id, workspace_id=context.current_workspace_id)
        logger.info(
            "系列接口：获取分集简表 系列ID=%s 数量=%s 耗时ms=%.2f",
            series_id,
            len(episodes),
            (time.perf_counter() - started_at) * 1000,
        )
        return signed_response(episodes)
    except ValueError as exc:
        logger.warning("系列接口：获取分集简表 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/prompt_config")
async def get_series_prompt_config(series_id: str, context: RequestContext = Depends(get_request_context)):
    """读取系列级提示词配置，并带上系统默认值。"""
    logger.info("系列接口：获取系列提示词配置 系列ID=%s", series_id)
    series = series_service.get_series(series_id)
    if not series or series.workspace_id != context.current_workspace_id:
        logger.warning("系列接口：获取系列提示词配置 未找到 系列ID=%s", series_id)
        raise HTTPException(status_code=404, detail="系列不存在")
    return {
        "prompt_config": series.prompt_config.model_dump(),
        "defaults": {
            "storyboard_polish": DEFAULT_STORYBOARD_POLISH_PROMPT,
            "video_polish": DEFAULT_VIDEO_POLISH_PROMPT,
            "r2v_polish": DEFAULT_R2V_POLISH_PROMPT,
        },
    }


@router.put("/series/{series_id}/prompt_config")
async def update_series_prompt_config(series_id: str, config: PromptConfig):
    """更新系列级提示词配置。"""
    try:
        logger.info("系列接口：更新系列提示词配置 系列ID=%s", series_id)
        series = series_service.update_prompt_config(series_id, config)
        logger.info("系列接口：更新系列提示词配置 完成 系列ID=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：更新系列提示词配置 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/model_settings")
async def get_series_model_settings(series_id: str):
    """读取系列级模型配置。"""
    logger.info("系列接口：获取系列模型配置 系列ID=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("系列接口：获取系列模型配置 未找到 系列ID=%s", series_id)
        raise HTTPException(status_code=404, detail="系列不存在")
    return series.model_settings.model_dump()


@router.put("/series/{series_id}/model_settings")
async def update_series_model_settings(
    series_id: str,
    settings: UpdateModelSettingsRequest,
):
    """更新系列级模型配置。"""
    updates = {
        key: value for key, value in settings.model_dump().items() if value is not None
    }
    logger.info("系列接口：更新系列模型配置 系列ID=%s 字段=%s", series_id, sorted(updates.keys()))
    if not updates:
        series = series_service.get_series(series_id)
        if not series:
            raise HTTPException(status_code=404, detail="系列不存在")
        return signed_response(series)

    try:
        current_series = series_service.get_series(series_id)
        if not current_series:
            raise HTTPException(status_code=404, detail="系列不存在")
        model_settings = current_series.model_settings.model_copy(update=updates)
        series = series_service.update_model_settings(series_id, model_settings.model_dump())
        logger.info("系列接口：更新系列模型配置 完成 系列ID=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：更新系列模型配置 失败 系列ID=%s 详情=%s", series_id, exc)
        status_code = 400 if "model" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.get("/series/{series_id}/assets")
async def get_series_assets(series_id: str):
    """读取系列下的全部共享素材。"""
    logger.info("系列接口：获取系列素材 系列ID=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("系列接口：获取系列素材 未找到 系列ID=%s", series_id)
        raise HTTPException(status_code=404, detail="系列不存在")
    return signed_response(
        {
            "characters": [character.model_dump() for character in series.characters],
            "scenes": [scene.model_dump() for scene in series.scenes],
            "props": [prop.model_dump() for prop in series.props],
        }
    )


@router.get("/series/{series_id}/assets/inbox")
async def get_series_asset_inbox(
    series_id: str,
    context: RequestContext = Depends(get_request_context),
):
    """读取系列资产待确认收件箱。"""
    logger.info("系列接口：读取资产收件箱 系列ID=%s", series_id)
    series = series_service.get_series(series_id)
    if not series or series.workspace_id != context.current_workspace_id:
        raise HTTPException(status_code=404, detail="系列不存在")
    inbox = series_asset_inbox_service.get_inbox(series_id)
    return signed_response(inbox)


@router.put("/series/{series_id}/assets/inbox")
async def upsert_series_asset_inbox(
    series_id: str,
    request: UpsertSeriesAssetInboxRequest,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """写入或追加系列资产待确认收件箱。"""
    try:
        logger.info(
            "系列接口：写入资产收件箱 系列ID=%s 模式=%s 角色=%s 场景=%s 道具=%s",
            series_id,
            request.mode,
            len(request.characters),
            len(request.scenes),
            len(request.props),
        )
        series = series_service.get_series(series_id)
        if not series or series.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        inbox = series_asset_inbox_service.upsert_inbox(
            series_id=series_id,
            characters=request.characters,
            scenes=request.scenes,
            props=request.props,
            mode=request.mode,
            expected_version=request.expected_version,
        )
        return signed_response(inbox)
    except ValueError as exc:
        status_code = 409 if "version conflict" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.post("/series/{series_id}/assets/inbox/remove")
async def remove_series_asset_inbox_items(
    series_id: str,
    request: RemoveSeriesAssetInboxItemsRequest,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """从系列资产收件箱移除候选项。"""
    try:
        logger.info(
            "系列接口：移除资产收件箱候选 系列ID=%s 角色=%s 场景=%s 道具=%s",
            series_id,
            len(request.character_ids),
            len(request.scene_ids),
            len(request.prop_ids),
        )
        series = series_service.get_series(series_id)
        if not series or series.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        inbox = series_asset_inbox_service.remove_items(
            series_id=series_id,
            character_ids=request.character_ids,
            scene_ids=request.scene_ids,
            prop_ids=request.prop_ids,
            expected_version=request.expected_version,
        )
        return signed_response(inbox)
    except ValueError as exc:
        status_code = 409 if "version conflict" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))


@router.put("/series/{series_id}/assets")
async def sync_series_assets(
    series_id: str,
    request: SyncSeriesAssetsRequest,
    context: RequestContext = Depends(require_capability(CAP_ASSET_EDIT)),
):
    """按前端确认结果整批同步剧集资产。"""
    try:
        logger.info(
            "系列接口：同步系列素材 系列ID=%s 角色数=%s 场景数=%s 道具数=%s 期望版本=%s",
            series_id,
            len(request.characters),
            len(request.scenes),
            len(request.props),
            request.expected_version,
        )
        series = series_service.get_series(series_id)
        if not series:
            raise ValueError("系列不存在")
        if series.workspace_id != context.current_workspace_id:
            raise ValueError("系列不存在")
        updated = series_command_service.sync_assets(
            series_id=series_id,
            expected_version=request.expected_version,
            characters=request.characters,
            scenes=request.scenes,
            props=request.props,
        )
        logger.info("系列接口：同步系列素材 完成 系列ID=%s 版本=%s", series_id, updated.version)
        return signed_response(updated)
    except ValueError as exc:
        logger.warning("系列接口：同步系列素材 失败 系列ID=%s 详情=%s", series_id, exc)
        status_code = 409 if "version conflict" in str(exc).lower() else 404
        raise HTTPException(status_code=status_code, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：同步系列素材 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/generate")
async def generate_series_asset(
    series_id: str,
    request: GenerateAssetRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """硬切到统一资产任务入口，旧路由直接下线。"""
    _ = request
    _ = idempotency_key
    logger.warning("系列接口：旧系列素材生成入口已下线 系列ID=%s，请改用 /asset-jobs/generate", series_id)
    raise HTTPException(
        status_code=410,
        detail="Legacy endpoint removed. Use POST /asset-jobs/generate",
    )


@router.post("/series/{series_id}/assets/generate_motion_ref", response_model=TaskReceipt)
async def generate_series_motion_ref(
    series_id: str,
    request: GenerateMotionRefRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """硬切到统一资产任务入口，旧路由直接下线。"""
    _ = request
    _ = idempotency_key
    logger.warning("系列接口：旧系列动作参考入口已下线 系列ID=%s，请改用 /asset-jobs/generate_motion_ref", series_id)
    raise HTTPException(
        status_code=410,
        detail="Legacy endpoint removed. Use POST /asset-jobs/generate_motion_ref",
    )


@router.post("/series/{series_id}/assets/toggle_lock")
async def toggle_series_asset_lock(series_id: str, request: ToggleLockRequest):
    """切换系列素材的锁定状态。"""
    try:
        logger.info("系列接口：切换素材锁定 系列ID=%s 素材ID=%s 素材类型=%s", series_id, request.asset_id, request.asset_type)
        series = series_service.toggle_asset_lock(series_id, request.asset_id, request.asset_type)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：切换素材锁定 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：切换素材锁定 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_image")
async def update_series_asset_image(
    series_id: str,
    request: UpdateAssetImageRequest,
):
    """手动更新系列素材的图片地址。"""
    try:
        logger.info("系列接口：更新素材图片 系列ID=%s 素材ID=%s 素材类型=%s", series_id, request.asset_id, request.asset_type)
        series = series_service.update_asset_image(series_id, request.asset_id, request.asset_type, request.image_url)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：更新素材图片 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：更新素材图片 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_attributes")
async def update_series_asset_attributes(
    series_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新系列素材上的任意字段。"""
    try:
        logger.info(
            "系列接口：更新素材属性 系列ID=%s 素材ID=%s 素材类型=%s 字段=%s",
            series_id,
            request.asset_id,
            request.asset_type,
            sorted(request.attributes.keys()),
        )
        series = series_service.update_asset_attributes(series_id, request.asset_id, request.asset_type, request.attributes)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：更新素材属性 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：更新素材属性 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/variant/select")
async def select_series_asset_variant(
    series_id: str,
    request: SelectVariantRequest,
):
    """选中系列共享资产候选图，并同步顶层图片 URL。"""
    try:
        logger.info(
            "系列接口：选择候选图 系列ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 生成类型=%s",
            series_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type,
        )
        series = series_service.select_variant(
            series_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type,
        )
        return signed_response(series)
    except ValueError as exc:
        logger.warning("系列接口：选择候选图 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：选择候选图 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/import")
async def import_series_assets(
    series_id: str,
    request: ImportAssetsRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """把另一个系列中的素材深拷贝导入当前系列。"""
    try:
        logger.info(
            "系列接口：导入系列素材 系列ID=%s 来源系列ID=%s 素材数=%s",
            series_id,
            request.source_series_id,
            len(request.asset_ids),
        )
        series = series_service.get_series(series_id)
        if not series:
            raise ValueError("系列不存在")
        receipt = task_service.create_job(
            task_type="series.assets.import",
            payload={
                "series_id": series_id,
                "source_series_id": request.source_series_id,
                "asset_ids": request.asset_ids,
            },
            project_id=None,
            series_id=series_id,
            queue_name="image",
            resource_type="series",
            resource_id=series_id,
            timeout_seconds=1200,
            idempotency_key=idempotency_key,
            dedupe_scope=f"series_import_assets:{request.source_series_id}:{','.join(sorted(request.asset_ids))}",
        )
        logger.info("系列接口：导入系列素材 已入队 系列ID=%s 任务ID=%s", series_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("系列接口：导入系列素材 失败 系列ID=%s 详情=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("系列接口：导入系列素材 发生未预期异常 系列ID=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))
