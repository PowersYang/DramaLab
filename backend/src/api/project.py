"""
项目核心路由：项目本体、角色、场景、道具与项目级风格。
"""

import asyncio
import time
import uuid
from functools import partial

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..service.llm import DEFAULT_STORYBOARD_POLISH_PROMPT, DEFAULT_VIDEO_POLISH_PROMPT, DEFAULT_R2V_POLISH_PROMPT
from backend.src.schema.models import GenerationStatus, Prop, Script, PromptConfig
from ..common import pipeline, signed_response
from ..schema.requests import (
    AddCharacterRequest,
    AddSceneRequest,
    CreateProjectRequest,
    CreatePropRequest,
    ReparseProjectRequest,
    UpdateStyleRequest, UpdatePromptConfigRequest,
)


router = APIRouter()


@router.post("/projects", response_model=Script)
async def create_project(request: CreateProjectRequest, skip_analysis: bool = False):
    """根据小说文本创建新项目。"""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(pipeline.create_project, request.title, request.text, skip_analysis),
    )
    return signed_response(result)


@router.put("/projects/{script_id}/reparse", response_model=Script)
async def reparse_project(script_id: str, request: ReparseProjectRequest):
    """重新解析已有项目文本，并替换其中的实体数据。"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(pipeline.reparse_project, script_id, request.text),
        )
        return signed_response(result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects/", response_model=list[dict])
async def list_projects():
    """列出后端当前保存的全部项目。"""
    return signed_response(list(pipeline.scripts.values()))


@router.get("/projects/{script_id}", response_model=Script)
async def get_project(script_id: str):
    """按项目 ID 读取项目详情。"""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    return signed_response(script)


@router.delete("/projects/{script_id}")
async def delete_project(script_id: str):
    """按 ID 删除项目。注意：这是永久删除。"""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        if script.series_id:
            series = pipeline.get_series(script.series_id)
            if series and script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
                pipeline._save_series_data()

        del pipeline.scripts[script_id]
        pipeline._save_data()
        return {"status": "deleted", "id": script_id, "title": script.title}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/sync_descriptions", response_model=Script)
async def sync_descriptions(script_id: str):
    """把脚本模块里的实体描述同步回素材模块。"""
    try:
        updated_script = pipeline.sync_descriptions_from_script_entities(script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters", response_model=Script)
async def add_character(script_id: str, request: AddCharacterRequest):
    """新增角色。"""
    try:
        updated_script = pipeline.add_character(
            script_id,
            request.name,
            request.description,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/characters/{char_id}", response_model=Script)
async def delete_character(script_id: str, char_id: str):
    """删除角色。"""
    try:
        updated_script = pipeline.delete_character(script_id, char_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/scenes", response_model=Script)
async def add_scene(script_id: str, request: AddSceneRequest):
    """新增场景。"""
    try:
        updated_script = pipeline.add_scene(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/scenes/{scene_id}", response_model=Script)
async def delete_scene(script_id: str, scene_id: str):
    """删除场景。"""
    try:
        updated_script = pipeline.delete_scene(script_id, scene_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/projects/{script_id}/style", response_model=Script)
async def update_project_style(script_id: str, request: UpdateStyleRequest):
    """更新项目的全局风格设置。"""
    try:
        updated_script = pipeline.update_project_style(
            script_id,
            request.style_preset,
            request.style_prompt,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_assets", response_model=Script)
async def generate_assets(script_id: str, background_tasks: BackgroundTasks):
    """触发项目素材生成。"""
    _ = background_tasks
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        updated_script = pipeline.generate_assets(script_id)
        return signed_response(updated_script)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/props")
async def create_prop(script_id: str, request: CreatePropRequest):
    """在项目里新增道具。"""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    new_prop = Prop(
        id=f"prop_{uuid.uuid4().hex[:8]}",
        name=request.name,
        description=request.description,
        status=GenerationStatus.PENDING,
    )

    script.props.append(new_prop)
    script.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


@router.delete("/projects/{script_id}/props/{prop_id}")
async def delete_prop(script_id: str, prop_id: str):
    """从项目里删除道具。"""
    script = pipeline.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")

    original_count = len(script.props)
    script.props = [prop for prop in script.props if prop.id != prop_id]
    if len(script.props) == original_count:
        raise HTTPException(status_code=404, detail="Prop not found")

    for frame in script.frames:
        if prop_id in frame.prop_ids:
            frame.prop_ids.remove(prop_id)

    script.updated_at = time.time()
    pipeline._save_data()
    return signed_response(script)


@router.post("/projects/{script_id}/model_settings", response_model=Script)
async def update_model_settings(script_id: str, request: UpdateModelSettingsRequest):
    """更新项目级模型配置与宽高比设置。"""
    try:
        updated_script = pipeline.update_model_settings(
            script_id,
            request.t2i_model,
            request.i2i_model,
            request.i2v_model,
            request.character_aspect_ratio,
            request.scene_aspect_ratio,
            request.prop_aspect_ratio,
            request.storyboard_aspect_ratio,
        )
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects/{script_id}/prompt_config")
async def get_prompt_config(script_id: str):
    """读取项目自定义提示词配置，并附带系统默认值。"""
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        config = script.prompt_config if hasattr(script, "prompt_config") else PromptConfig()
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
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/projects/{script_id}/prompt_config")
async def update_prompt_config(script_id: str, request: UpdatePromptConfigRequest):
    """更新项目自定义提示词配置；空字符串表示回退系统默认值。"""
    try:
        script = pipeline.get_script(script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Project not found")
        script.prompt_config = PromptConfig(
            storyboard_polish=request.storyboard_polish,
            video_polish=request.video_polish,
            r2v_polish=request.r2v_polish,
        )
        pipeline._save_data()
        return {"prompt_config": script.prompt_config.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
