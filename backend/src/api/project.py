"""
项目核心路由：项目本体、角色、场景、道具与项目级风格。
"""

import asyncio
from functools import partial

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..application.services import CharacterService, ProjectService, PropService, SceneService
from ..application.workflows import AssetWorkflow
from ..providers.text.default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from ..schemas.models import PromptConfig, Script
from ..common import signed_response
from ..schemas.requests import (
    AddCharacterRequest,
    AddSceneRequest,
    CreateProjectRequest,
    CreatePropRequest,
    ReparseProjectRequest,
    UpdateStyleRequest, UpdatePromptConfigRequest, UpdateModelSettingsRequest,
)


router = APIRouter()
project_service = ProjectService()
character_service = CharacterService()
scene_service = SceneService()
prop_service = PropService()
asset_workflow = AssetWorkflow()


@router.post("/projects", response_model=Script)
async def create_project(request: CreateProjectRequest, skip_analysis: bool = False):
    """根据小说文本创建新项目。"""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        partial(project_service.create_project, request.title, request.text, skip_analysis),
    )
    return signed_response(result)


@router.put("/projects/{script_id}/reparse", response_model=Script)
async def reparse_project(script_id: str, request: ReparseProjectRequest):
    """重新解析已有项目文本，并替换其中的实体数据。"""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            partial(project_service.reparse_project, script_id, request.text),
        )
        return signed_response(result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects", response_model=list[dict])
@router.get("/projects/", response_model=list[dict])
async def list_projects():
    """列出后端当前保存的全部项目。"""
    return signed_response(project_service.list_projects())


@router.get("/projects/{script_id}", response_model=Script)
async def get_project(script_id: str):
    """按项目 ID 读取项目详情。"""
    script = project_service.get_project(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    return signed_response(script)


@router.delete("/projects/{script_id}")
async def delete_project(script_id: str):
    """按 ID 删除项目。注意：这是永久删除。"""
    try:
        return project_service.delete_project(script_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/sync_descriptions", response_model=Script)
async def sync_descriptions(script_id: str):
    """把脚本模块里的实体描述同步回素材模块。"""
    try:
        updated_script = project_service.sync_descriptions(script_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/characters", response_model=Script)
async def add_character(script_id: str, request: AddCharacterRequest):
    """新增角色。"""
    try:
        updated_script = character_service.create_character(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/characters/{char_id}", response_model=Script)
async def delete_character(script_id: str, char_id: str):
    """删除角色。"""
    try:
        updated_script = character_service.delete_character(script_id, char_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/scenes", response_model=Script)
async def add_scene(script_id: str, request: AddSceneRequest):
    """新增场景。"""
    try:
        updated_script = scene_service.create_scene(script_id, request.name, request.description)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/projects/{script_id}/scenes/{scene_id}", response_model=Script)
async def delete_scene(script_id: str, scene_id: str):
    """删除场景。"""
    try:
        updated_script = scene_service.delete_scene(script_id, scene_id)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/projects/{script_id}/style", response_model=Script)
async def update_project_style(script_id: str, request: UpdateStyleRequest):
    """更新项目的全局风格设置。"""
    try:
        updated_script = project_service.update_style(script_id, request.style_preset, request.style_prompt)
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/generate_assets", response_model=Script)
async def generate_assets(script_id: str, background_tasks: BackgroundTasks):
    """触发项目素材生成。"""
    _ = background_tasks
    script = project_service.get_project(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        updated_script = asset_workflow.generate_assets(script_id)
        return signed_response(updated_script)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/projects/{script_id}/props")
async def create_prop(script_id: str, request: CreatePropRequest):
    """在项目里新增道具。"""
    try:
        return signed_response(prop_service.create_prop(script_id, request.name, request.description))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/projects/{script_id}/props/{prop_id}")
async def delete_prop(script_id: str, prop_id: str):
    """从项目里删除道具。"""
    try:
        return signed_response(prop_service.delete_prop(script_id, prop_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/projects/{script_id}/model_settings", response_model=Script)
async def update_model_settings(script_id: str, request: UpdateModelSettingsRequest):
    """更新项目级模型配置与宽高比设置。"""
    try:
        updated_script = project_service.update_model_settings(script_id, **request.model_dump())
        return signed_response(updated_script)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/projects/{script_id}/prompt_config")
async def get_prompt_config(script_id: str):
    """读取项目自定义提示词配置，并附带系统默认值。"""
    try:
        script = project_service.get_project(script_id)
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
        config = project_service.update_prompt_config(
            script_id,
            storyboard_polish=request.storyboard_polish,
            video_polish=request.video_polish,
            r2v_polish=request.r2v_polish,
        )
        return {"prompt_config": config.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
