"""
系列路由：系列基础信息、分集关系、共享素材与系列级配置。
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..service.llm import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from backend.src.schema.models import PromptConfig
from ..common import pipeline, signed_response
from ..schema.requests import (
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


@router.post("/series")
async def create_series(request: CreateSeriesRequest):
    """创建一个新的系列。"""
    series = pipeline.create_series(request.title, request.description)
    return signed_response(series)


@router.get("/series")
async def list_series():
    """列出所有系列。"""
    return signed_response(pipeline.list_series())


@router.get("/series/{series_id}")
async def get_series(series_id: str):
    """获取系列详情，包括共享素材和分集列表。"""
    series = pipeline.get_series(series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    episodes = pipeline.get_series_episodes(series_id)
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
    return signed_response(result)


@router.put("/series/{series_id}")
async def update_series(series_id: str, request: UpdateSeriesRequest):
    """更新系列标题或简介。"""
    try:
        updates = {
            key: value for key, value in request.model_dump().items() if value is not None
        }
        series = pipeline.update_series(series_id, updates)
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/series/{series_id}")
async def delete_series(series_id: str):
    """删除系列，并解除与各分集的关联。"""
    try:
        pipeline.delete_series(series_id)
        return {"status": "deleted"}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/series/{series_id}/episodes")
async def add_episode_to_series(series_id: str, request: AddEpisodeRequest):
    """把一个已有项目挂到系列里，作为某一集。"""
    try:
        series = pipeline.add_episode_to_series(
            series_id,
            request.script_id,
            request.episode_number,
        )
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/series/{series_id}/episodes/{script_id}")
async def remove_episode_from_series(series_id: str, script_id: str):
    """把某一集从系列里移除，但不删除项目本身。"""
    try:
        series = pipeline.remove_episode_from_series(series_id, script_id)
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/episodes")
async def get_series_episodes(series_id: str):
    """获取某个系列下的全部分集。"""
    try:
        episodes = pipeline.get_series_episodes(series_id)
        return signed_response(episodes)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/prompt_config")
async def get_series_prompt_config(series_id: str):
    """读取系列级提示词配置，并带上系统默认值。"""
    series = pipeline.get_series(series_id)
    if not series:
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
        series = pipeline.update_series(series_id, {"prompt_config": config})
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/model_settings")
async def get_series_model_settings(series_id: str):
    """读取系列级模型配置。"""
    series = pipeline.get_series(series_id)
    if not series:
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
    if not updates:
        series = pipeline.get_series(series_id)
        if not series:
            raise HTTPException(status_code=404, detail="Series not found")
        return signed_response(series)

    try:
        current_series = pipeline.get_series(series_id)
        if not current_series:
            raise HTTPException(status_code=404, detail="Series not found")
        model_settings = current_series.model_settings.model_copy(update=updates)
        series = pipeline.update_series(
            series_id,
            {"model_settings": model_settings},
        )
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/series/{series_id}/assets")
async def get_series_assets(series_id: str):
    """读取系列下的全部共享素材。"""
    series = pipeline.get_series(series_id)
    if not series:
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
    background_tasks: BackgroundTasks,
):
    """为系列异步生成单个共享素材。"""
    try:
        series, task_id = pipeline.generate_series_asset(
            series_id,
            request.asset_id,
            request.asset_type,
            request.style_preset,
            request.reference_image_url,
            request.style_prompt,
            request.generation_type,
            request.prompt,
            request.apply_style,
            request.negative_prompt,
            request.batch_size,
            request.model_name,
        )
        background_tasks.add_task(pipeline.process_asset_generation_task, task_id)
        response_data = series.model_dump()
        response_data["_task_id"] = task_id
        return signed_response(response_data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/toggle_lock")
async def toggle_series_asset_lock(series_id: str, request: ToggleLockRequest):
    """切换系列素材的锁定状态。"""
    try:
        series = pipeline.toggle_series_asset_lock(
            series_id,
            request.asset_id,
            request.asset_type,
        )
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_image")
async def update_series_asset_image(
    series_id: str,
    request: UpdateAssetImageRequest,
):
    """手动更新系列素材的图片地址。"""
    try:
        series = pipeline.update_series_asset_image(
            series_id,
            request.asset_id,
            request.asset_type,
            request.image_url,
        )
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/update_attributes")
async def update_series_asset_attributes(
    series_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新系列素材上的任意字段。"""
    try:
        series = pipeline.update_series_asset_attributes(
            series_id,
            request.asset_id,
            request.asset_type,
            request.attributes,
        )
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/series/{series_id}/assets/import")
async def import_series_assets(series_id: str, request: ImportAssetsRequest):
    """把另一个系列中的素材深拷贝导入当前系列。"""
    try:
        series, imported_ids, skipped_ids = pipeline.import_assets_from_series(
            series_id,
            request.source_series_id,
            request.asset_ids,
        )
        _ = (imported_ids, skipped_ids)
        return signed_response(series)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
