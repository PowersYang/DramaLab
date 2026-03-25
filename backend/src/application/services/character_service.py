"""Character application service.

This service isolates character CRUD and voice-related updates from the
larger project aggregate write path.
"""

import time
import uuid

from ...repository import CharacterRepository, ProjectRepository
from ...schemas.models import Character, GenerationStatus


class CharacterService:
    """Application service for character resource operations."""

    def __init__(self):
        self.character_repository = CharacterRepository()
        self.project_repository = ProjectRepository()

    def create_character(self, project_id: str, name: str, description: str):
        """Create a new character inside the target project."""
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
        """Delete a character and remove its references from frames."""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        self.character_repository.delete("project", project_id, character_id)
        # Frame references are still maintained on the project aggregate,
        # so they must be cleaned up after the child row is removed.
        for frame in project.frames:
            if character_id in frame.character_ids:
                frame.character_ids = [cid for cid in frame.character_ids if cid != character_id]
        project.characters = [c for c in project.characters if c.id != character_id]
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project

    def bind_voice(self, project_id: str, character_id: str, voice_id: str, voice_name: str):
        """Bind a TTS voice profile to a character."""
        character = self.character_repository.get("project", project_id, character_id)
        if not character:
            raise ValueError("Character not found")
        character.voice_id = voice_id
        character.voice_name = voice_name
        self.character_repository.save("project", project_id, character)
        return self.project_repository.get(project_id)

    def update_voice_params(self, project_id: str, character_id: str, speed: float, pitch: float, volume: int):
        """Update per-character dialogue synthesis parameters."""
        character = self.character_repository.get("project", project_id, character_id)
        if not character:
            raise ValueError("Character not found")
        character.voice_speed = speed
        character.voice_pitch = pitch
        character.voice_volume = volume
        self.character_repository.save("project", project_id, character)
        return self.project_repository.get(project_id)
