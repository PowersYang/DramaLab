"""
项目媒体路由：视频任务、语音音频、混音、合成与导出。
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..application.services import ProjectService, VideoTaskService
from ..application.workflows import MediaWorkflow
from backend.src.schemas.models import Script, VideoTask
from ..common import logger, signed_response
from ..schemas.requests import (
    BindVoiceRequest,
    CreateVideoTaskRequest,
    ExportRequest,
    GenerateLineAudioRequest,
    UpdateVoiceParamsRequest,
)


router = APIRouter()
video_task_service = VideoTaskService()
media_workflow = MediaWorkflow()
project_service = ProjectService()


@router.post("/projects/{script_id}/generate_video", response_model=Script)
async def generate_video(script_id: str):
    """触发视频生成。"""
    try:
        return signed_response(media_workflow.generate_video(script_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_audio", response_model=Script)
async def generate_audio(script_id: str):
    """触发音频生成。"""
    try:
        return signed_response(media_workflow.generate_audio(script_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/video_tasks", response_model=list[VideoTask])
async def create_video_task(
    script_id: str,
    request: CreateVideoTaskRequest,
    background_tasks: BackgroundTasks,
):
    """创建一个或多个视频生成任务。"""
    try:
        tasks = video_task_service.create_tasks(
            script_id=script_id,
            image_url=request.image_url,
            prompt=request.prompt,
            frame_id=request.frame_id,
            duration=request.duration,
            seed=request.seed,
            resolution=request.resolution,
            generate_audio=request.generate_audio,
            audio_url=request.audio_url,
            prompt_extend=request.prompt_extend,
            negative_prompt=request.negative_prompt,
            batch_size=request.batch_size,
            model=request.model,
            shot_type=request.shot_type,
            generation_mode=request.generation_mode,
            reference_video_urls=request.reference_video_urls,
            mode=request.mode,
            sound=request.sound,
            cfg_scale=request.cfg_scale,
            vidu_audio=request.vidu_audio,
            movement_amplitude=request.movement_amplitude,
        )
        for task in tasks:
            background_tasks.add_task(media_workflow.process_video_task, script_id, task.id)
        return signed_response(tasks)
    except Exception as exc:
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters/{char_id}/voice", response_model=Script)
async def bind_voice(script_id: str, char_id: str, request: BindVoiceRequest):
    """给角色绑定语音。"""
    try:
        updated_script = video_task_service.bind_voice(script_id, char_id, request.voice_id, request.voice_name)
        return signed_response(updated_script)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put(
    "/projects/{script_id}/characters/{char_id}/voice_params",
    response_model=Script,
)
async def update_voice_params(
    script_id: str,
    char_id: str,
    request: UpdateVoiceParamsRequest,
):
    """更新角色语音参数。"""
    try:
        updated_script = video_task_service.update_voice_params(script_id, char_id, request.speed, request.pitch, request.volume)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/voices")
async def get_voices():
    """返回当前可用语音列表。"""
    return media_workflow.get_available_voices()


@router.post("/projects/{script_id}/frames/{frame_id}/audio", response_model=Script)
async def generate_line_audio(
    script_id: str,
    frame_id: str,
    request: GenerateLineAudioRequest,
):
    """按指定参数为某一帧生成对白音频。"""
    try:
        updated_script = media_workflow.generate_dialogue_line(script_id, frame_id, request.speed, request.pitch, request.volume)
        return signed_response(updated_script)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/mix/generate_sfx", response_model=Script)
async def generate_mix_sfx(script_id: str):
    """为全片触发音效生成流程。"""
    try:
        return signed_response(media_workflow.generate_audio(script_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/mix/generate_bgm", response_model=Script)
async def generate_mix_bgm(script_id: str):
    """触发背景音乐生成。"""
    try:
        return signed_response(media_workflow.generate_audio(script_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/merge", response_model=Script)
async def merge_videos(script_id: str):
    """把所有已选中的分镜视频合成为最终成片。"""
    try:
        return signed_response(media_workflow.merge_videos(script_id))
    except ValueError as exc:
        logger.error("[MERGE ERROR] Validation failed: %s", exc)
        logger.exception("An error occurred")
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        logger.error("[MERGE ERROR] Runtime error: %s", exc)
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error("[MERGE ERROR] Unexpected error: %s", exc)
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(exc)}")


@router.post("/projects/{script_id}/export")
async def export_project(script_id: str, request: ExportRequest):
    """
    导出项目视频。

    当前实现仍复用既有合成流程；
    `resolution`、`format`、`subtitles` 参数已预留，
    但尚未真正接入导出管线。
    """
    _ = request
    try:
        script = project_service.get_project(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        if script.merged_video_url:
            return signed_response({"url": script.merged_video_url})
        return signed_response(media_workflow.export_project(script_id, request.model_dump()))
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.error("[EXPORT ERROR] %s", exc)
        logger.exception("An error occurred")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(exc)}")
