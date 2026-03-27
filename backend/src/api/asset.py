"""
项目素材路由：素材生成、图片版本管理、素材上传与素材视频。
"""

import os
import shutil
import uuid

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from ..application.services import AssetService, VideoTaskService
from ..application.tasks import TaskService
from ..application.workflows import AssetWorkflow
from ..schemas.models import Script
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
from ..schemas.task_models import TaskReceipt
from ..utils.oss_utils import OSSImageUploader


router = APIRouter()
asset_service = AssetService()
asset_workflow = AssetWorkflow()
video_task_service = VideoTaskService()
task_service = TaskService()


@router.post("/projects/{script_id}/assets/generate_motion_ref")
async def generate_motion_ref(
    script_id: str,
    request: GenerateMotionRefRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """为指定素材生成动作参考视频。"""
    try:
        # 动作参考生成通常较慢，先记录素材维度和批次，便于区分排队慢还是模型侧慢。
        logger.info(
            "ASSET_API: generate_motion_ref script_id=%s asset_id=%s asset_type=%s duration=%s batch_size=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            request.duration,
            request.batch_size,
        )
        asset_workflow.prepare_motion_ref_generation(
            script_id=script_id,
            asset_id=request.asset_id,
            asset_type=request.asset_type,
        )
        receipt = task_service.create_job(
            task_type="asset.motion_ref.generate",
            payload={
                "project_id": script_id,
                "asset_id": request.asset_id,
                "asset_type": request.asset_type,
                "prompt": request.prompt,
                "audio_url": request.audio_url,
                "duration": request.duration,
                "batch_size": request.batch_size,
            },
            project_id=script_id,
            queue_name="video",
            resource_type=request.asset_type,
            resource_id=request.asset_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
        )
        logger.info("ASSET_API: generate_motion_ref task_created script_id=%s job_id=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("ASSET_API: generate_motion_ref failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: generate_motion_ref unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/generate")
async def generate_single_asset(
    script_id: str,
    request: GenerateAssetRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """按指定参数生成单个素材。"""
    try:
        logger.info(
            "ASSET_API: generate_single_asset script_id=%s asset_id=%s asset_type=%s generation_type=%s batch_size=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            request.generation_type,
            request.batch_size,
        )
        asset_workflow.prepare_project_asset_generation(
            script_id,
            request.asset_id,
            request.asset_type,
        )
        receipt = task_service.create_job(
            task_type="asset.generate",
            payload={
                "project_id": script_id,
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
            project_id=script_id,
            queue_name="image",
            resource_type=request.asset_type,
            resource_id=request.asset_id,
            timeout_seconds=1200,
            idempotency_key=idempotency_key,
            dedupe_scope=f"{request.asset_type}:{request.asset_id}:{request.generation_type}",
        )
        logger.info("ASSET_API: generate_single_asset task_created script_id=%s job_id=%s", script_id, receipt.job_id)
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("ASSET_API: generate_single_asset failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: generate_single_asset unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post(
    "/projects/{script_id}/assets/{asset_type}/{asset_id}/generate_video",
    response_model=TaskReceipt,
)
async def generate_asset_video(
    script_id: str,
    asset_type: str,
    asset_id: str,
    request: GenerateAssetVideoRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """为指定素材生成 I2V 视频。"""
    try:
        logger.info(
            "ASSET_API: generate_asset_video script_id=%s asset_id=%s asset_type=%s duration=%s",
            script_id,
            asset_id,
            asset_type,
            request.duration,
        )
        script, task = asset_workflow.create_asset_video_task(
            script_id,
            asset_id,
            asset_type,
            request.prompt,
            request.duration,
            request.aspect_ratio,
        )
        receipt = video_task_service.task_service.create_video_generation_job(
            video_task=task,
            task_type="video.generate.asset",
            resource_type=asset_type,
            resource_id=asset_id,
            idempotency_key=idempotency_key,
        )
        logger.info("ASSET_API: generate_asset_video task_created script_id=%s job_id=%s", script_id, receipt.job_id)
        _ = script
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("ASSET_API: generate_asset_video failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: generate_asset_video unexpected_error script_id=%s", script_id)
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
        logger.info(
            "ASSET_API: delete_asset_video script_id=%s asset_id=%s asset_type=%s video_id=%s",
            script_id,
            asset_id,
            asset_type,
            video_id,
        )
        updated_script = asset_service.delete_asset_video(
            script_id,
            asset_id,
            asset_type,
            video_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: delete_asset_video failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: delete_asset_video unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/toggle_lock", response_model=Script)
async def toggle_asset_lock(script_id: str, request: ToggleLockRequest):
    """切换素材锁定状态。"""
    try:
        logger.info("ASSET_API: toggle_asset_lock script_id=%s asset_id=%s asset_type=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.toggle_lock(
            script_id,
            request.asset_id,
            request.asset_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: toggle_asset_lock failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: toggle_asset_lock unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_image", response_model=Script)
async def update_asset_image(script_id: str, request: UpdateAssetImageRequest):
    """手动更新素材图片地址。"""
    try:
        logger.info("ASSET_API: update_asset_image script_id=%s asset_id=%s asset_type=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.update_image(
            script_id,
            request.asset_id,
            request.asset_type,
            request.image_url,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: update_asset_image failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: update_asset_image unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_attributes", response_model=Script)
async def update_asset_attributes(
    script_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新素材任意字段。"""
    try:
        logger.info(
            "ASSET_API: update_asset_attributes script_id=%s asset_id=%s asset_type=%s fields=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            sorted(request.attributes.keys()),
        )
        updated_script = asset_service.update_attributes(
            script_id,
            request.asset_id,
            request.asset_type,
            request.attributes,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: update_asset_attributes failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: update_asset_attributes unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_description", response_model=Script)
async def update_asset_description(
    script_id: str,
    request: UpdateAssetDescriptionRequest,
):
    """更新素材描述。"""
    try:
        logger.info("ASSET_API: update_asset_description script_id=%s asset_id=%s asset_type=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.update_description(
            script_id,
            request.asset_id,
            request.asset_type,
            request.description,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: update_asset_description failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: update_asset_description unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/select", response_model=Script)
async def select_asset_variant(script_id: str, request: SelectVariantRequest):
    """把某张候选图设为素材当前选中项。"""
    try:
        logger.info(
            "ASSET_API: select_asset_variant script_id=%s asset_id=%s asset_type=%s variant_id=%s generation_type=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type,
        )
        updated_script = asset_service.select_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.generation_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: select_asset_variant failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: select_asset_variant unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/delete", response_model=Script)
async def delete_asset_variant(script_id: str, request: DeleteVariantRequest):
    """删除素材下的某张候选图。"""
    try:
        logger.info(
            "ASSET_API: delete_asset_variant script_id=%s asset_id=%s asset_type=%s variant_id=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
        )
        updated_script = asset_service.delete_variant(
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: delete_asset_variant failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: delete_asset_variant unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/favorite", response_model=Script)
async def toggle_variant_favorite(script_id: str, request: FavoriteVariantRequest):
    """切换候选图收藏状态；已收藏图片不会被自动清理。"""
    try:
        logger.info(
            "ASSET_API: toggle_variant_favorite script_id=%s asset_id=%s asset_type=%s variant_id=%s is_favorited=%s",
            script_id,
            request.asset_id,
            request.asset_type,
            request.variant_id,
            request.is_favorited,
        )
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
        logger.warning("ASSET_API: toggle_variant_favorite failed script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: toggle_variant_favorite unexpected_error script_id=%s", script_id)
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
        logger.info(
            "ASSET_API: upload_asset script_id=%s asset_id=%s asset_type=%s upload_type=%s filename=%s",
            script_id,
            asset_id,
            asset_type,
            upload_type,
            file.filename,
        )
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
        logger.info("ASSET_API: upload_asset completed script_id=%s asset_id=%s", script_id, asset_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("ASSET_API: upload_asset invalid_request script_id=%s detail=%s", script_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("ASSET_API: upload_asset unexpected_error script_id=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
