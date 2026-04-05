"""项目素材路由：素材生成、图片版本管理、素材上传与素材视频。"""

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from ..application.services import AssetService, VideoTaskService
from ..auth.dependencies import get_request_context
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
from ..utils.temp_media import staged_upload_file


router = APIRouter(dependencies=[Depends(get_request_context)])
asset_service = AssetService()
asset_workflow = AssetWorkflow()
video_task_service = VideoTaskService()


@router.post("/projects/{script_id}/assets/generate_motion_ref")
async def generate_motion_ref(
    script_id: str,
    request: GenerateMotionRefRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """硬切到统一资产任务入口，旧路由直接下线。"""
    _ = request
    _ = idempotency_key
    logger.warning("素材接口：旧动作参考入口已下线 项目ID=%s，请改用 /asset-jobs/generate_motion_ref", script_id)
    raise HTTPException(
        status_code=410,
        detail="Legacy endpoint removed. Use POST /asset-jobs/generate_motion_ref",
    )


@router.post("/projects/{script_id}/assets/generate")
async def generate_single_asset(
    script_id: str,
    request: GenerateAssetRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """硬切到统一资产任务入口，旧路由直接下线。"""
    _ = request
    _ = idempotency_key
    logger.warning("素材接口：旧素材生成入口已下线 项目ID=%s，请改用 /asset-jobs/generate", script_id)
    raise HTTPException(
        status_code=410,
        detail="Legacy endpoint removed. Use POST /asset-jobs/generate",
    )


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
            "素材接口：生成素材视频 项目ID=%s 素材ID=%s 素材类型=%s 时长=%s",
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
        logger.info("素材接口：生成素材视频 已创建任务 项目ID=%s 任务ID=%s", script_id, receipt.job_id)
        _ = script
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("素材接口：生成素材视频 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：生成素材视频 发生未预期异常 项目ID=%s", script_id)
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
            "素材接口：删除素材视频 项目ID=%s 素材ID=%s 素材类型=%s 视频ID=%s",
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
        logger.warning("素材接口：删除素材视频 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：删除素材视频 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/toggle_lock", response_model=Script)
async def toggle_asset_lock(script_id: str, request: ToggleLockRequest):
    """切换素材锁定状态。"""
    try:
        logger.info("素材接口：切换素材锁定 项目ID=%s 素材ID=%s 素材类型=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.toggle_lock(
            script_id,
            request.asset_id,
            request.asset_type,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("素材接口：切换素材锁定 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：切换素材锁定 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_image", response_model=Script)
async def update_asset_image(script_id: str, request: UpdateAssetImageRequest):
    """手动更新素材图片地址。"""
    try:
        logger.info("素材接口：更新素材图片 项目ID=%s 素材ID=%s 素材类型=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.update_image(
            script_id,
            request.asset_id,
            request.asset_type,
            request.image_url,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("素材接口：更新素材图片 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：更新素材图片 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_attributes", response_model=Script)
async def update_asset_attributes(
    script_id: str,
    request: UpdateAssetAttributesRequest,
):
    """批量更新素材任意字段。"""
    try:
        logger.info(
            "素材接口：更新素材属性 项目ID=%s 素材ID=%s 素材类型=%s 字段=%s",
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
        logger.warning("素材接口：更新素材属性 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：更新素材属性 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/update_description", response_model=Script)
async def update_asset_description(
    script_id: str,
    request: UpdateAssetDescriptionRequest,
):
    """更新素材描述。"""
    try:
        logger.info("素材接口：更新素材描述 项目ID=%s 素材ID=%s 素材类型=%s", script_id, request.asset_id, request.asset_type)
        updated_script = asset_service.update_description(
            script_id,
            request.asset_id,
            request.asset_type,
            request.description,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("素材接口：更新素材描述 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：更新素材描述 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/select", response_model=Script)
async def select_asset_variant(script_id: str, request: SelectVariantRequest):
    """把某张候选图设为素材当前选中项。"""
    try:
        logger.info(
            "素材接口：选择素材候选图 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 生成类型=%s",
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
        logger.warning("素材接口：选择素材候选图 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：选择素材候选图 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/delete", response_model=Script)
async def delete_asset_variant(script_id: str, request: DeleteVariantRequest):
    """删除素材下的某张候选图。"""
    try:
        logger.info(
            "素材接口：删除素材候选图 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s",
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
        logger.warning("素材接口：删除素材候选图 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：删除素材候选图 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/assets/variant/favorite", response_model=Script)
async def toggle_variant_favorite(script_id: str, request: FavoriteVariantRequest):
    """切换候选图收藏状态；已收藏图片不会被自动清理。"""
    try:
        logger.info(
            "素材接口：切换候选图收藏 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 是否收藏=%s",
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
        logger.warning("素材接口：切换候选图收藏 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：切换候选图收藏 发生未预期异常 项目ID=%s", script_id)
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
            "素材接口：上传素材图片 项目ID=%s 素材ID=%s 素材类型=%s 上传类型=%s 文件名=%s",
            script_id,
            asset_id,
            asset_type,
            upload_type,
            file.filename,
        )
        with staged_upload_file(file.file, file.filename) as file_path:
            oss_url = OSSImageUploader().upload_image(file_path, sub_path="uploads")
        if not oss_url:
            raise RuntimeError("OSS 上传失败。由于已移除本地静态文件挂载，无法再回退到本地 URL。")

        updated_script = asset_service.upload_variant(
            script_id=script_id,
            asset_type=asset_type,
            asset_id=asset_id,
            upload_type=upload_type,
            image_url=oss_url,
            description=description,
        )
        if not updated_script:
            raise HTTPException(status_code=404, detail="项目或素材不存在")
        logger.info("素材接口：上传素材图片 完成 项目ID=%s 素材ID=%s", script_id, asset_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("素材接口：上传素材图片 参数非法 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("素材接口：上传素材图片 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))
