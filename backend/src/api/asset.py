"""
项目素材路由：素材生成、图片版本管理、素材上传与素材视频。
"""

import os
import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from ..application.services import AssetService, ProjectService
from ..application.workflows import AssetWorkflow, MediaWorkflow
from backend.src.schemas.models import Script
from ..common import logger, signed_response
from ..schemas.requests import (
    DeleteVariantRequest,
    FavoriteVariantRequest,
    GenerateAssetRequest,
    GenerateAssetVideoRequest,
    GenerateMotionRefRequest,
    SelectVariantRequest,
    ToggleLockRequest,
    UpdateAssetAttributesRequest,
    UpdateAssetDescriptionRequest,
    UpdateAssetImageRequest,
)
from ..utils.oss_utils import OSSImageUploader


router = APIRouter()
asset_service = AssetService()
asset_workflow = AssetWorkflow()
project_service = ProjectService()
media_workflow = MediaWorkflow()


@router.post("/projects/{script_id}/assets/generate_motion_ref")
async def generate_motion_ref(
    script_id: str,
    request: GenerateMotionRefRequest,
    background_tasks: BackgroundTasks,
):
    """为指定素材生成动作参考视频。"""
    try:
        script, task_id = asset_workflow.generate_motion_ref_task(
            script_id=script_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
            prompt=request.prompt,
            audio_url=request.audio_url,
            duration=request.duration,
            batch_size=request.batch_size,
        )
        background_tasks.add_task(asset_workflow.process_motion_ref_task, script_id, task_id)
        response_data = script.model_dump()
        response_data["_task_id"] = task_id
        return signed_response(response_data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/generate")
async def generate_single_asset(
    script_id: str,
    request: GenerateAssetRequest,
    background_tasks: BackgroundTasks,
):
    """按指定参数生成单个素材。"""
    try:
        script, task_id = asset_workflow.create_asset_generation_task(
            script_id,
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
        background_tasks.add_task(asset_workflow.process_asset_generation_task, task_id)
        response_data = script.model_dump()
        response_data["_task_id"] = task_id
        return signed_response(response_data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    """返回素材生成任务的当前状态。"""
    status = asset_workflow.get_task_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    if status["status"] == "completed":
        script = project_service.get_project(status["script_id"])
        if script:
            status["script"] = signed_response(script).body.decode("utf-8")
    return status


@router.post(
    "/projects/{script_id}/assets/{asset_type}/{asset_id}/generate_video",
    response_model=Script,
)
async def generate_asset_video(
    script_id: str,
    asset_type: str,
    asset_id: str,
    request: GenerateAssetVideoRequest,
    background_tasks: BackgroundTasks,
):
    """为指定素材生成 I2V 视频。"""
    try:
        script, task_id = asset_workflow.create_asset_video_task(
            script_id,
            asset_id,
            asset_type,
            request.prompt,
            request.duration,
            request.aspect_ratio,
        )
        background_tasks.add_task(media_workflow.process_video_task, script_id, task_id)
        return signed_response(script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete(
    "/projects/{script_id}/assets/{asset_type}/{asset_id}/videos/{video_id}",
    response_model=Script,
)
async def delete_asset_video(
    script_id: str,
    asset_type: str,
    asset_id: str,
    video_id: str,
):
    """删除某个素材下的一条视频记录。"""
    try:
        updated_script = asset_service.delete_asset_video(
            script_id,
            asset_id,
            asset_type,
            video_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/toggle_lock", response_model=Script)
async def toggle_asset_lock(script_id: str, request: ToggleLockRequest):
    """切换素材锁定状态。"""
    try:
        updated_script = asset_service.toggle_lock(
            script_id,
            request.asset_id,
            request.asset_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_image", response_model=Script)
async def update_asset_image(script_id: str, request: UpdateAssetImageRequest):
    """手动更新素材图片地址。"""
    try:
        updated_script = asset_service.update_image(
            script_id,
            request.asset_id,
            request.asset_type,
            request.image_url,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_attributes", response_model=Script)
async def update_asset_attributes(
    script_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新素材任意字段。"""
    try:
        updated_script = asset_service.update_attributes(
            script_id,
            request.asset_id,
            request.asset_type,
            request.attributes,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_description", response_model=Script)
async def update_asset_description(
    script_id: str,
    request: UpdateAssetDescriptionRequest,
):
    """更新素材描述。"""
    try:
        updated_script = asset_service.update_description(
            script_id,
            request.asset_id,
            request.asset_type,
            request.description,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/select", response_model=Script)
async def select_asset_variant(script_id: str, request: SelectVariantRequest):
    """把某张候选图设为素材当前选中项。"""
    try:
        updated_script = asset_service.select_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/delete", response_model=Script)
async def delete_asset_variant(script_id: str, request: DeleteVariantRequest):
    """删除素材下的某张候选图。"""
    try:
        updated_script = asset_service.delete_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/favorite", response_model=Script)
async def toggle_variant_favorite(script_id: str, request: FavoriteVariantRequest):
    """切换候选图收藏状态；已收藏图片不会被自动清理。"""
    try:
        updated_script = asset_service.toggle_variant_favorite(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.is_favorited,
            request.generation_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/{asset_type}/{asset_id}/upload")
async def upload_asset(
    script_id: str,
    asset_type: str,
    asset_id: str,
    upload_type: str,
    description: str | None = None,
    file: UploadFile = File(...),
):
    """给素材手动上传一张图片，并登记为新的候选图。"""
    try:
        file_ext = os.path.splitext(file.filename)[1]
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join("output/uploads", filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        oss_url = OSSImageUploader().upload_image(file_path)
        if not oss_url:
            oss_url = f"uploads/{filename}"

        updated_script = asset_service.upload_variant(
            script_id=script_id,
            asset_type=asset_type,
            asset_id=asset_id,
            upload_type=upload_type,
            image_url=oss_url,
            description=description,
        )
        if not updated_script:
            raise HTTPException(status_code=404, detail="Script or asset not found")
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Error uploading asset: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
