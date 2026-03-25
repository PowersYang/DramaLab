"""Project application service.

This service owns project-level CRUD and lightweight settings updates.
It replaces the old pipeline-centered write path for project resources.
"""

import time

from ...repository import ProjectRepository, SeriesRepository
from ...providers import ScriptProcessor
from ...schemas.models import ModelSettings, PromptConfig


class ProjectService:
    """Application service for project aggregate operations."""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.text_provider = ScriptProcessor()

    def create_project(self, title: str, text: str, skip_analysis: bool = False):
        """Create and persist a project from raw text input."""
        if skip_analysis:
            project = self.text_provider.create_draft_script(title, text)
        else:
            project = self.text_provider.parse_novel(title, text)
        self.project_repository.save(project)
        return project

    def reparse_project(self, script_id: str, text: str):
        """Re-run script parsing while preserving stable metadata fields."""
        existing = self.get_project(script_id)
        if not existing:
            raise ValueError("Script not found")

        reparsed = self.text_provider.parse_novel(existing.title, text)
        # Preserve identity, tenant placeholders, and user-edited config
        # while replacing the parsed content structure.
        reparsed.id = existing.id
        reparsed.created_at = existing.created_at
        reparsed.updated_at = time.time()
        reparsed.art_direction = existing.art_direction
        reparsed.model_settings = existing.model_settings
        reparsed.style_preset = existing.style_preset
        reparsed.style_prompt = existing.style_prompt
        reparsed.merged_video_url = existing.merged_video_url
        reparsed.series_id = existing.series_id
        reparsed.episode_number = existing.episode_number
        reparsed.organization_id = existing.organization_id
        reparsed.workspace_id = existing.workspace_id
        reparsed.created_by = existing.created_by
        reparsed.updated_by = existing.updated_by

        self.project_repository.save(reparsed)
        return reparsed

    def list_projects(self):
        """Return all persisted projects."""
        return self.project_repository.list()

    def get_project(self, script_id: str):
        """Load a single project aggregate."""
        return self.project_repository.get(script_id)

    def delete_project(self, script_id: str):
        """Delete a project and detach it from its series if needed."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")

        if project.series_id:
            series = self.series_repository.get(project.series_id)
            if series and script_id in series.episode_ids:
                series.episode_ids.remove(script_id)
                series.updated_at = time.time()
                self.series_repository.save(series)

        self.project_repository.delete(script_id)
        return {"status": "deleted", "id": script_id, "title": project.title}

    def sync_descriptions(self, script_id: str):
        """Clear cached prompts so descriptions can be regenerated consistently."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")

        for character in project.characters:
            character.full_body_prompt = None
            character.three_view_prompt = None
            character.headshot_prompt = None
            character.video_prompt = None
        for scene in project.scenes:
            if hasattr(scene, "prompt"):
                scene.prompt = None
        for prop in project.props:
            if hasattr(prop, "prompt"):
                prop.prompt = None

        project.updated_at = time.time()
        self.project_repository.save(project)
        return project

    def update_style(self, script_id: str, style_preset: str, style_prompt: str | None = None):
        """Update project-level visual style selection."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        project.style_preset = style_preset
        project.style_prompt = style_prompt
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project

    def update_model_settings(self, script_id: str, **updates):
        """Patch non-null model settings fields on the project."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Script not found")
        project.model_settings = project.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project

    def get_prompt_config(self, script_id: str):
        """Return prompt config, defaulting to an empty config object."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")
        return project.prompt_config if hasattr(project, "prompt_config") else PromptConfig()

    def update_prompt_config(self, script_id: str, storyboard_polish: str = "", video_polish: str = "", r2v_polish: str = ""):
        """Replace the project prompt override configuration."""
        project = self.get_project(script_id)
        if not project:
            raise ValueError("Project not found")
        project.prompt_config = PromptConfig(
            storyboard_polish=storyboard_polish,
            video_polish=video_polish,
            r2v_polish=r2v_polish,
        )
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project.prompt_config
