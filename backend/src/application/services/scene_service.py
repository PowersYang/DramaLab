"""Scene application service.

Scene CRUD is handled here so controllers no longer need to update the
full project aggregate through a monolithic pipeline.
"""

import time
import uuid

from ...repository import ProjectRepository, SceneRepository
from ...schemas.models import GenerationStatus, Scene


class SceneService:
    """Application service for scene resource operations."""

    def __init__(self):
        self.scene_repository = SceneRepository()
        self.project_repository = ProjectRepository()

    def create_scene(self, project_id: str, name: str, description: str):
        """Create a new scene inside the target project."""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        scene = Scene(
            id=f"scene_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description,
            status=GenerationStatus.PENDING,
        )
        self.scene_repository.save("project", project_id, scene)
        return self.project_repository.get(project_id)

    def delete_scene(self, project_id: str, scene_id: str):
        """Delete a scene and clear frame references that point to it."""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Script not found")
        self.scene_repository.delete("project", project_id, scene_id)
        for frame in project.frames:
            if frame.scene_id == scene_id:
                frame.scene_id = ""
        project.scenes = [s for s in project.scenes if s.id != scene_id]
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project
