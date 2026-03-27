"""
系列路由：系列基础信息、分集关系、共享素材与系列级配置。
"""

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from ..application.tasks import TaskService
from ..application.services import SeriesService
from ..application.workflows import AssetWorkflow, SeriesWorkflow
from ..common.log import get_logger
from ..providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from ..schemas.models import PromptConfig
from ..common import signed_response
from ..schemas.requests import (
    AddEpisodeRequest,
    CreateSeriesRequest,
    GenerateAssetRequest,
    ImportAssetsRequest,
    ToggleLockRequest,
    UpdateAssetAttributesRequest,
    UpdateAssetImageRequest,
    UpdateModelSettingsRequest,
    UpdateSeriesRequest,
)


router = APIRouter()
logger = get_logger(__name__)
series_service = SeriesService()
series_workflow = SeriesWorkflow()
asset_workflow = AssetWorkflow()
task_service = TaskService()


@router.post("/series")
async def create_series(request: CreateSeriesRequest):
    """创建一个新的系列。"""
    # 系列创建属于项目组织入口，记录标题和是否含描述，便于排查导入或手工创建来源。
    logger.info("SERIES_API: create_series title=%s has_description=%s", request.title, bool(request.description))
    series = series_service.create_series(request.title, request.description)
    logger.info("SERIES_API: create_series completed series_id=%s", series.id)
    return signed_response(series)


@router.get("/series")
async def list_series():
    """列出所有系列。"""
    series_list = series_service.list_series()
    logger.info("SERIES_API: list_series count=%s", len(series_list))
    return signed_response(series_list)


@router.get("/series/{series_id}")
async def get_series(series_id: str):
    """获取系列详情，包括共享素材和分集列表。"""
    logger.info("SERIES_API: get_series series_id=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("SERIES_API: get_series not_found series_id=%s", series_id)
        raise HTTPException(status_code=404, detail="Series not found")

    episodes = series_service.get_episodes(series_id)
    result = series.model_dump()
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
    logger.info("SERIES_API: get_series completed series_id=%s episodes=%s", series_id, len(episodes))
    return signed_response(result)


@router.put("/series/{series_id}")
async def update_series(series_id: str, request: UpdateSeriesRequest):
    """更新系列标题或简介。"""
    try:
        updates = {
            key: value for key, value in request.model_dump().items() if value is not None
        }
        logger.info("SERIES_API: update_series series_id=%s fields=%s", series_id, sorted(updates.keys()))
        series = series_service.update_series(series_id, updates)
        logger.info("SERIES_API: update_series completed series_id=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: update_series not_found series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/series/{series_id}")
async def delete_series(series_id: str):
    """删除系列，并解除与各分集的关联。"""
    try:
        logger.info("SERIES_API: delete_series series_id=%s", series_id)
        series_service.delete_series(series_id)
        logger.info("SERIES_API: delete_series completed series_id=%s", series_id)
        return {"status": "deleted"}
    except ValueError as exc:
        logger.warning("SERIES_API: delete_series not_found series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/series/{series_id}/episodes")
async def add_episode_to_series(series_id: str, request: AddEpisodeRequest):
    """把一个已有项目挂到系列里，作为某一集。"""
    try:
        logger.info(
            "SERIES_API: add_episode_to_series series_id=%s script_id=%s episode_number=%s",
            series_id,
            request.script_id,
            request.episode_number,
        )
        series = series_service.add_episode(series_id, request.script_id, request.episode_number)
        logger.info("SERIES_API: add_episode_to_series completed series_id=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: add_episode_to_series failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/series/{series_id}/episodes/{script_id}")
async def remove_episode_from_series(series_id: str, script_id: str):
    """把某一集从系列里移除，但不删除项目本身。"""
    try:
        logger.info("SERIES_API: remove_episode_from_series series_id=%s script_id=%s", series_id, script_id)
        series = series_service.remove_episode(series_id, script_id)
        logger.info("SERIES_API: remove_episode_from_series completed series_id=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: remove_episode_from_series failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/episodes")
async def get_series_episodes(series_id: str):
    """获取某个系列下的全部分集。"""
    try:
        episodes = series_service.get_episodes(series_id)
        logger.info("SERIES_API: get_series_episodes series_id=%s count=%s", series_id, len(episodes))
        return signed_response(episodes)
    except ValueError as exc:
        logger.warning("SERIES_API: get_series_episodes failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/prompt_config")
async def get_series_prompt_config(series_id: str):
    """读取系列级提示词配置，并带上系统默认值。"""
    logger.info("SERIES_API: get_series_prompt_config series_id=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("SERIES_API: get_series_prompt_config not_found series_id=%s", series_id)
        raise HTTPException(status_code=404, detail="Series not found")
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
        logger.info("SERIES_API: update_series_prompt_config series_id=%s", series_id)
        series = series_service.update_prompt_config(series_id, config)
        logger.info("SERIES_API: update_series_prompt_config completed series_id=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: update_series_prompt_config failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/model_settings")
async def get_series_model_settings(series_id: str):
    """读取系列级模型配置。"""
    logger.info("SERIES_API: get_series_model_settings series_id=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("SERIES_API: get_series_model_settings not_found series_id=%s", series_id)
        raise HTTPException(status_code=404, detail="Series not found")
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
    logger.info("SERIES_API: update_series_model_settings series_id=%s fields=%s", series_id, sorted(updates.keys()))
    if not updates:
        series = series_service.get_series(series_id)
        if not series:
            raise HTTPException(status_code=404, detail="Series not found")
        return signed_response(series)

    try:
        current_series = series_service.get_series(series_id)
        if not current_series:
            raise HTTPException(status_code=404, detail="Series not found")
        model_settings = current_series.model_settings.model_copy(update=updates)
        series = series_service.update_model_settings(series_id, model_settings.model_dump())
        logger.info("SERIES_API: update_series_model_settings completed series_id=%s", series_id)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: update_series_model_settings failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/assets")
async def get_series_assets(series_id: str):
    """读取系列下的全部共享素材。"""
    logger.info("SERIES_API: get_series_assets series_id=%s", series_id)
    series = series_service.get_series(series_id)
    if not series:
        logger.warning("SERIES_API: get_series_assets not_found series_id=%s", series_id)
        raise HTTPException(status_code=404, detail="Series not found")
    return signed_response(
        {
            "characters": [character.model_dump() for character in series.characters],
            "scenes": [scene.model_dump() for scene in series.scenes],
            "props": [prop.model_dump() for prop in series.props],
        }
    )


@router.post("/series/{series_id}/assets/generate")
async def generate_series_asset(
    series_id: str,
    request: GenerateAssetRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """为系列异步生成单个共享素材。"""
    try:
        logger.info(
            "SERIES_API: generate_series_asset series_id=%s asset_id=%s asset_type=%s generation_type=%s batch_size=%s",
            series_id,
            request.asset_id,
            request.asset_type,
            request.generation_type,
            request.batch_size,
        )
        asset_workflow.prepare_series_asset_generation(
            series_id,
            request.asset_id,
            request.asset_type,
        )
        receipt = task_service.create_job(
            task_type="series.asset.generate",
            payload={
                "series_id": series_id,
                "asset_id": request.asset_id,
                "asset_type": request.asset_type,
                "style_preset": request.style_preset,
                "reference_image_url": request.reference_image_url,
                "style_prompt": request.style_prompt,
                "generation_type": request.generation_type,
                "prompt": request.prompt,
                "apply_style": request.apply_style,
                "negative_prompt": request.negative_prompt,
                "batch_size": request.batch_size,
                "model_name": request.model_name,
            },
            project_id=None,
            series_id=series_id,
            queue_name="image",
            resource_type=request.asset_type,
            resource_id=request.asset_id,
            timeout_seconds=1200,
            idempotency_key=idempotency_key,
            dedupe_scope=f"series:{series_id}:{request.asset_type}:{request.asset_id}:{request.generation_type}",
        )
        logger.info("SERIES_API: generate_series_asset task_created series_id=%s job_id=%s", series_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("SERIES_API: generate_series_asset failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("SERIES_API: generate_series_asset unexpected_error series_id=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/toggle_lock")
async def toggle_series_asset_lock(series_id: str, request: ToggleLockRequest):
    """切换系列素材的锁定状态。"""
    try:
        logger.info("SERIES_API: toggle_series_asset_lock series_id=%s asset_id=%s asset_type=%s", series_id, request.asset_id, request.asset_type)
        series = series_service.toggle_asset_lock(series_id, request.asset_id, request.asset_type)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: toggle_series_asset_lock failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("SERIES_API: toggle_series_asset_lock unexpected_error series_id=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_image")
async def update_series_asset_image(
    series_id: str,
    request: UpdateAssetImageRequest,
):
    """手动更新系列素材的图片地址。"""
    try:
        logger.info("SERIES_API: update_series_asset_image series_id=%s asset_id=%s asset_type=%s", series_id, request.asset_id, request.asset_type)
        series = series_service.update_asset_image(series_id, request.asset_id, request.asset_type, request.image_url)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: update_series_asset_image failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("SERIES_API: update_series_asset_image unexpected_error series_id=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_attributes")
async def update_series_asset_attributes(
    series_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新系列素材上的任意字段。"""
    try:
        logger.info(
            "SERIES_API: update_series_asset_attributes series_id=%s asset_id=%s asset_type=%s fields=%s",
            series_id,
            request.asset_id,
            request.asset_type,
            sorted(request.attributes.keys()),
        )
        series = series_service.update_asset_attributes(series_id, request.asset_id, request.asset_type, request.attributes)
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: update_series_asset_attributes failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("SERIES_API: update_series_asset_attributes unexpected_error series_id=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/import")
async def import_series_assets(series_id: str, request: ImportAssetsRequest):
    """把另一个系列中的素材深拷贝导入当前系列。"""
    try:
        logger.info(
            "SERIES_API: import_series_assets series_id=%s source_series_id=%s asset_count=%s",
            series_id,
            request.source_series_id,
            len(request.asset_ids),
        )
        series, imported_ids, skipped_ids = series_workflow.import_assets_from_series(
            series_id,
            request.source_series_id,
            request.asset_ids,
        )
        # 导入结果单独记录成功/跳过数量，后续查素材缺失时能快速判断是源数据不存在还是导入被过滤。
        logger.info(
            "SERIES_API: import_series_assets completed series_id=%s imported=%s skipped=%s",
            series_id,
            len(imported_ids),
            len(skipped_ids),
        )
        return signed_response(series)
    except ValueError as exc:
        logger.warning("SERIES_API: import_series_assets failed series_id=%s detail=%s", series_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("SERIES_API: import_series_assets unexpected_error series_id=%s", series_id)
        raise HTTPException(status_code=500, detail=str(exc))
