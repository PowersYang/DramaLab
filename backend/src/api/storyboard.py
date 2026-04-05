"""项目分镜路由：分镜分析、分镜帧编辑、重绘与帧图管理。"""

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile

from ..application.services import StoryboardFrameService
from ..application.services import AssetService
from ..application.tasks import TaskService
from ..auth.dependencies import get_request_context
from ..application.workflows import StoryboardWorkflow
from ..schemas.models import Script
from ..common import logger, signed_response
from ..schemas.requests import (
    AddFrameRequest,
    AnalyzeToStoryboardRequest,
    BatchRenderFrameRequest,
    CopyFrameRequest,
    ExtractLastFrameRequest,
    RefinePromptRequest,
    RenderFrameRequest,
    ReorderFramesRequest,
    SelectVideoRequest,
    ToggleFrameLockRequest,
    UpdateFrameRequest,
)
from ..schemas.task_models import TaskReceipt
from ..utils.oss_utils import OSSImageUploader
from ..utils.temp_media import staged_upload_file


router = APIRouter(dependencies=[Depends(get_request_context)])
storyboard_frame_service = StoryboardFrameService()
storyboard_workflow = StoryboardWorkflow()
asset_service = AssetService()
task_service = TaskService()


@router.post("/projects/{script_id}/storyboard/analyze")
async def analyze_to_storyboard(
    script_id: str,
    request: AnalyzeToStoryboardRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """调用 AI 分析剧本文本并登记独立任务。"""
    try:
        logger.info("分镜接口：分镜分析 项目ID=%s 文本长度=%s", script_id, len(request.text or ""))
        receipt = task_service.create_job(
            task_type="storyboard.analyze",
            payload={
                "project_id": script_id,
                "text": request.text,
            },
            project_id=script_id,
            queue_name="llm",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=600,
            idempotency_key=idempotency_key,
            dedupe_scope="storyboard-analyze",
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("分镜接口：分镜分析 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：分镜分析 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/storyboard/refine_prompt", response_model=TaskReceipt)
async def refine_storyboard_prompt(
    script_id: str,
    request: RefinePromptRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """把原始分镜提示词润色成中英文双语版本。"""
    try:
        logger.info("分镜接口：润色分镜提示词 项目ID=%s 分镜ID=%s", script_id, request.frame_id)
        receipt = task_service.create_job(
            task_type="storyboard.refine_prompt",
            payload={
                "project_id": script_id,
                "frame_id": request.frame_id,
                "raw_prompt": request.raw_prompt,
                "assets": request.assets,
                "feedback": request.feedback,
            },
            project_id=script_id,
            queue_name="llm",
            resource_type="storyboard_frame",
            resource_id=request.frame_id,
            timeout_seconds=600,
            idempotency_key=idempotency_key,
            dedupe_scope="storyboard-refine-prompt",
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("分镜接口：润色分镜提示词 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：润色分镜提示词 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_storyboard", response_model=TaskReceipt)
async def generate_storyboard(script_id: str, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """触发分镜图生成。"""
    try:
        logger.info("分镜接口：生成分镜图 项目ID=%s", script_id)
        storyboard_workflow.prepare_generate_storyboard(script_id)
        receipt = task_service.create_job(
            task_type="storyboard.generate_all",
            payload={"project_id": script_id},
            project_id=script_id,
            queue_name="image",
            resource_type="project",
            resource_id=script_id,
            timeout_seconds=1800,
            idempotency_key=idempotency_key,
            dedupe_scope="generate-storyboard",
        )
        return signed_response(receipt)
    except Exception as exc:
        logger.exception("分镜接口：生成分镜图 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/toggle_lock", response_model=Script)
async def toggle_frame_lock(script_id: str, request: ToggleFrameLockRequest):
    """切换分镜帧锁定状态。"""
    try:
        logger.info("分镜接口：切换分镜锁定 项目ID=%s 分镜ID=%s", script_id, request.frame_id)
        updated_script = storyboard_frame_service.toggle_lock(script_id, request.frame_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：切换分镜锁定 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：切换分镜锁定 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/update", response_model=Script)
async def update_frame(script_id: str, request: UpdateFrameRequest):
    """更新分镜帧信息，如提示词、场景、角色等。"""
    try:
        logger.info("分镜接口：更新分镜帧 项目ID=%s 分镜ID=%s", script_id, request.frame_id)
        updated_script = storyboard_frame_service.update_frame(
            script_id,
            request.frame_id,
            image_prompt=request.image_prompt,
            action_description=request.action_description,
            dialogue=request.dialogue,
            camera_angle=request.camera_angle,
            scene_id=request.scene_id,
            character_ids=request.character_ids,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：更新分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：更新分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames", response_model=Script)
async def add_frame(script_id: str, request: AddFrameRequest):
    """新增分镜帧。"""
    try:
        logger.info("分镜接口：新增分镜帧 项目ID=%s 插入位置=%s", script_id, request.insert_at)
        updated_script = storyboard_frame_service.add_frame(
            script_id,
            request.scene_id,
            request.action_description,
            request.camera_angle,
            request.insert_at,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：新增分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：新增分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/frames/{frame_id}", response_model=Script)
async def delete_frame(script_id: str, frame_id: str):
    """删除分镜帧。"""
    try:
        logger.info("分镜接口：删除分镜帧 项目ID=%s 分镜ID=%s", script_id, frame_id)
        updated_script = storyboard_frame_service.delete_frame(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：删除分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：删除分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/copy", response_model=Script)
async def copy_frame(script_id: str, request: CopyFrameRequest):
    """复制一帧分镜。"""
    try:
        logger.info("分镜接口：复制分镜帧 项目ID=%s 分镜ID=%s 插入位置=%s", script_id, request.frame_id, request.insert_at)
        updated_script = storyboard_frame_service.copy_frame(
            script_id,
            request.frame_id,
            request.insert_at,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：复制分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：复制分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/projects/{script_id}/frames/reorder", response_model=Script)
async def reorder_frames(script_id: str, request: ReorderFramesRequest):
    """重排分镜帧顺序。"""
    try:
        logger.info("分镜接口：重排分镜帧 项目ID=%s 分镜数=%s", script_id, len(request.frame_ids))
        updated_script = storyboard_frame_service.reorder_frames(script_id, request.frame_ids)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：重排分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：重排分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/storyboard/render", response_model=TaskReceipt)
async def render_frame(script_id: str, request: RenderFrameRequest, idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
    """根据构图数据重绘指定分镜帧。"""
    try:
        logger.info(
            "分镜接口：重绘分镜帧 项目ID=%s 分镜ID=%s 批量数=%s 是否带构图=%s",
            script_id,
            request.frame_id,
            request.batch_size,
            bool(request.composition_data),
        )
        receipt = task_service.create_job(
            task_type="storyboard.render",
            payload={
                "project_id": script_id,
                "frame_id": request.frame_id,
                "composition_data": request.composition_data,
                "prompt": request.prompt,
                "batch_size": request.batch_size,
            },
            project_id=script_id,
            queue_name="image",
            resource_type="storyboard_frame",
            resource_id=request.frame_id,
            timeout_seconds=1200,
            idempotency_key=idempotency_key,
        )
        return signed_response(receipt)
    except ValueError as exc:
        logger.warning("分镜接口：重绘分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：重绘分镜帧 发生未预期异常 项目ID=%s 分镜ID=%s", script_id, request.frame_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/storyboard/render_batch", response_model=list[TaskReceipt])
async def render_frames_batch(
    script_id: str,
    request: BatchRenderFrameRequest,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """批量登记多个分镜渲染任务，供前端一键按顺序入队。"""
    try:
        if not request.items:
            raise ValueError("至少需要一个分镜渲染项")

        logger.info(
            "分镜接口：批量重绘分镜帧 项目ID=%s 条目数=%s",
            script_id,
            len(request.items),
        )
        receipts: list[TaskReceipt] = []
        for index, item in enumerate(request.items):
            receipt = task_service.create_job(
                task_type="storyboard.render",
                payload={
                    "project_id": script_id,
                    "frame_id": item.frame_id,
                    "composition_data": item.composition_data,
                    "prompt": item.prompt,
                    "batch_size": item.batch_size,
                },
                project_id=script_id,
                queue_name="image",
                resource_type="storyboard_frame",
                resource_id=item.frame_id,
                timeout_seconds=1200,
                idempotency_key=f"{idempotency_key}:{index}:{item.frame_id}" if idempotency_key else None,
                dedupe_scope=f"storyboard-render-batch:{item.frame_id}",
            )
            receipts.append(receipt)

        return signed_response(receipts)
    except ValueError as exc:
        logger.warning("分镜接口：批量重绘分镜帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：批量重绘分镜帧 发生未预期异常 项目ID=%s", script_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post(
    "/projects/{script_id}/frames/{frame_id}/select_video",
    response_model=Script,
)
async def select_video(script_id: str, frame_id: str, request: SelectVideoRequest):
    """为某一帧切换当前选中的视频版本。"""
    try:
        logger.info("分镜接口：选择视频版本 项目ID=%s 分镜ID=%s 视频ID=%s", script_id, frame_id, request.video_id)
        updated_script = asset_service.select_video_for_frame(script_id, frame_id, request.video_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：选择视频版本 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：选择视频版本 发生未预期异常 项目ID=%s 分镜ID=%s", script_id, frame_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/{frame_id}/extract_last_frame")
async def extract_last_frame(
    script_id: str,
    frame_id: str,
    request: ExtractLastFrameRequest,
):
    """从已完成视频里抽最后一帧，并加入该帧的渲染图候选列表。"""
    try:
        logger.info("分镜接口：抽取视频最后一帧 项目ID=%s 分镜ID=%s 视频任务ID=%s", script_id, frame_id, request.video_task_id)
        updated_script = storyboard_workflow.extract_last_frame(script_id, frame_id, request.video_task_id)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：抽取视频最后一帧 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        logger.exception("分镜接口：抽取视频最后一帧 运行时异常 项目ID=%s 分镜ID=%s", script_id, frame_id)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：抽取视频最后一帧 发生未预期异常 项目ID=%s 分镜ID=%s", script_id, frame_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/{frame_id}/upload_image")
async def upload_frame_image(
    script_id: str,
    frame_id: str,
    file: UploadFile = File(...),
):
    """给分镜帧上传一张渲染图候选图片。"""
    try:
        logger.info("分镜接口：上传分镜图片 项目ID=%s 分镜ID=%s 文件名=%s", script_id, frame_id, file.filename)
        with staged_upload_file(file.file, file.filename) as file_path:
            object_key = OSSImageUploader().upload_image(file_path, sub_path="uploads")
        if not object_key:
            raise RuntimeError("分镜图片 OSS 上传失败。")

        updated_script = asset_service.upload_frame_image(script_id, frame_id, object_key)
        return signed_response(updated_script)
    except ValueError as exc:
        logger.warning("分镜接口：上传分镜图片 失败 项目ID=%s 详情=%s", script_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("分镜接口：上传分镜图片 发生未预期异常 项目ID=%s 分镜ID=%s", script_id, frame_id)
        raise HTTPException(status_code=500, detail=str(exc))
