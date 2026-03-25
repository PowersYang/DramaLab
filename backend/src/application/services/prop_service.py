"""Prop application service.

Prop mutations are isolated here so they can evolve independently from
the project aggregate load/save cycle.
"""

import time
import uuid

from ...repository import ProjectRepository, PropRepository
from ...schemas.models import GenerationStatus, Prop


class PropService:
    """Application service for prop resource operations."""

    def __init__(self):
        self.prop_repository = PropRepository()
        self.project_repository = ProjectRepository()

    def create_prop(self, project_id: str, name: str, description: str):
        """Create a new prop inside the target project."""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        prop = Prop(
            id=f"prop_{uuid.uuid4().hex[:8]}",
            name=name,
            description=description,
            status=GenerationStatus.PENDING,
        )
        self.prop_repository.save("project", project_id, prop)
        return self.project_repository.get(project_id)

    def delete_prop(self, project_id: str, prop_id: str):
        """Delete a prop and remove its references from frames."""
        project = self.project_repository.get(project_id)
        if not project:
            raise ValueError("Project not found")
        self.prop_repository.delete("project", project_id, prop_id)
        for frame in project.frames:
            if prop_id in frame.prop_ids:
                frame.prop_ids = [pid for pid in frame.prop_ids if pid != prop_id]
        project.props = [prop for prop in project.props if prop.id != prop_id]
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project
