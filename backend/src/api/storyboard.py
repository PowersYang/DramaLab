"""
项目分镜路由：分镜分析、分镜帧编辑、重绘与帧图管理。
"""

import os
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.src.schema.models import Script
from ..common import logger, pipeline, signed_response
from ..schema.requests import (
    AddFrameRequest,
    AnalyzeToStoryboardRequest,
    CopyFrameRequest,
    ExtractLastFrameRequest,
    RefinePromptRequest,
    RenderFrameRequest,
    ReorderFramesRequest,
    SelectVideoRequest,
    ToggleFrameLockRequest,
    UpdateFrameRequest,
)


router = APIRouter()


@router.post("/projects/{script_id}/storyboard/analyze")
async def analyze_to_storyboard(
    script_id: str,
    request: AnalyzeToStoryboardRequest,
):
    """调用 AI 分析脚本文本并重建分镜帧。"""
    try:
        updated_script = pipeline.analyze_text_to_frames(script_id, request.text)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("Error in analyze_to_storyboard: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/storyboard/refine_prompt")
async def refine_storyboard_prompt(script_id: str, request: RefinePromptRequest):
    """把原始分镜提示词润色成中英文双语版本。"""
    try:
        return pipeline.refine_frame_prompt(
            script_id,
            request.frame_id,
            request.raw_prompt,
            request.assets,
            request.feedback,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("Error in refine_storyboard_prompt: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_storyboard", response_model=Script)
async def generate_storyboard(script_id: str):
    """触发分镜图生成。"""
    try:
        return signed_response(pipeline.generate_storyboard(script_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/toggle_lock", response_model=Script)
async def toggle_frame_lock(script_id: str, request: ToggleFrameLockRequest):
    """切换分镜帧锁定状态。"""
    try:
        updated_script = pipeline.toggle_frame_lock(script_id, request.frame_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/update", response_model=Script)
async def update_frame(script_id: str, request: UpdateFrameRequest):
    """更新分镜帧信息，如提示词、场景、角色等。"""
    try:
        updated_script = pipeline.update_frame(
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
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames", response_model=Script)
async def add_frame(script_id: str, request: AddFrameRequest):
    """新增分镜帧。"""
    try:
        updated_script = pipeline.add_frame(
            script_id,
            request.scene_id,
            request.action_description,
            request.camera_angle,
            request.insert_at,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/frames/{frame_id}", response_model=Script)
async def delete_frame(script_id: str, frame_id: str):
    """删除分镜帧。"""
    try:
        updated_script = pipeline.delete_frame(script_id, frame_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/copy", response_model=Script)
async def copy_frame(script_id: str, request: CopyFrameRequest):
    """复制一帧分镜。"""
    try:
        updated_script = pipeline.copy_frame(
            script_id,
            request.frame_id,
            request.insert_at,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/projects/{script_id}/frames/reorder", response_model=Script)
async def reorder_frames(script_id: str, request: ReorderFramesRequest):
    """重排分镜帧顺序。"""
    try:
        updated_script = pipeline.reorder_frames(script_id, request.frame_ids)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/storyboard/render", response_model=Script)
async def render_frame(script_id: str, request: RenderFrameRequest):
    """根据构图数据重绘指定分镜帧。"""
    try:
        logger.info("Rendering frame %s", request.frame_id)
        updated_script = pipeline.generate_storyboard_render(
            script_id,
            request.frame_id,
            request.composition_data,
            request.prompt,
            request.batch_size,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Error rendering frame %s: %s", request.frame_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post(
    "/projects/{script_id}/frames/{frame_id}/select_video",
    response_model=Script,
)
async def select_video(script_id: str, frame_id: str, request: SelectVideoRequest):
    """为某一帧切换当前选中的视频版本。"""
    try:
        updated_script = pipeline.select_video_for_frame(
            script_id,
            frame_id,
            request.video_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/{frame_id}/extract_last_frame")
async def extract_last_frame(
    script_id: str,
    frame_id: str,
    request: ExtractLastFrameRequest,
):
    """从已完成视频里抽最后一帧，并加入该帧的渲染图候选列表。"""
    try:
        updated_script = pipeline.extract_last_frame(
            script_id,
            frame_id,
            request.video_task_id,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception("Error extracting last frame: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/frames/{frame_id}/upload_image")
async def upload_frame_image(
    script_id: str,
    frame_id: str,
    file: UploadFile = File(...),
):
    """给分镜帧上传一张渲染图候选图片。"""
    try:
        file_ext = os.path.splitext(file.filename)[1]
        filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join("output/uploads", filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        updated_script = pipeline.upload_frame_image(script_id, frame_id, file_path)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Error uploading frame image: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
