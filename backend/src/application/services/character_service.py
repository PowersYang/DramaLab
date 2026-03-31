"""
角色应用服务。

这里把角色 CRUD 和语音相关更新从项目整体写入路径里拆开。
"""

import uuid

from ...repository import CharacterRepository, ProjectRepository
from .project_command_service import ProjectCommandService
from ...schemas.models import Character, GenerationStatus
from ...utils.datetime import utc_now


class CharacterService:
    """负责角色资源相关应用操作。"""

    def __init__(self):
        self.character_repository = CharacterRepository()
        self.project_repository = ProjectRepository()
        self.project_command_service = ProjectCommandService()

    def create_character(self, project_id: str, name: str, description: str):
        """在目标项目中创建一个新角色。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        character = Character(
            id=f"char_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description,
            status=GenerationStatus.PENDING,
        )
        self.character_repository.save("project", project_id, character)
        return self.project_repository.get(project_id)

    def delete_character(self, project_id: str, character_id: str):
        """删除角色，并清理分镜帧里的关联引用。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        # 分镜帧上的角色引用仍然维护在项目聚合里，所以删除子对象后还要同步清理。
        cleaned_frames = []
        for frame in project.frames:
            if character_id in frame.character_ids:
                frame.character_ids = [cid for cid in frame.character_ids if cid != character_id]
                frame.updated_at = utc_now()
                cleaned_frames.append(frame)
        return self.project_command_service.delete_asset_and_cleanup_frames(project_id, project.version, "character", character_id, cleaned_frames=cleaned_frames)

    def bind_voice(self, project_id: str, character_id: str, voice_id: str, voice_name: str):
        """为角色绑定 TTS 音色。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        character = self.character_repository.get("project", project_id, character_id)
        if not character:
            raise ValueError("Character not found")
        character.voice_id = voice_id
        character.voice_name = voice_name
        self.character_repository.save("project", project_id, character)
        return self.project_repository.get(project_id)

    def update_voice_params(self, project_id: str, character_id: str, speed: float, pitch: float, volume: int):
        """更新角色级对白合成参数。"""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        character = self.character_repository.get("project", project_id, character_id)
        if not character:
            raise ValueError("Character not found")
        character.voice_speed = speed
        character.voice_pitch = pitch
        character.voice_volume = volume
        self.character_repository.save("project", project_id, character)
        return self.project_repository.get(project_id)
