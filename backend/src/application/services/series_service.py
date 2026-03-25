"""Series application service.

This service manages series metadata, episode bindings, and the subset
of shared asset edits that belong to the series aggregate.
"""

import time
import uuid

from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import PromptConfig, Series


class SeriesService:
    """Application service for series-level CRUD and relationship updates."""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()

    def create_series(self, title: str, description: str = ""):
        """Create and persist an empty series aggregate."""
        series = Series(
            id=str(uuid.uuid4()),
            title=title,
            description=description,
            created_at=time.time(),
            updated_at=time.time(),
        )
        self.series_repository.save(series)
        return series

    def list_series(self):
        """Return all series records."""
        return self.series_repository.list()

    def get_series(self, series_id: str):
        """Load a single series aggregate."""
        return self.series_repository.get(series_id)

    def update_series(self, series_id: str, updates: dict):
        """Patch mutable series fields while keeping identity fields immutable."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        for key, value in updates.items():
            if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                setattr(series, key, value)
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def delete_series(self, series_id: str):
        """Delete a series and detach all linked episodes."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        for ep_id in list(series.episode_ids):
            project = self.project_repository.get(ep_id)
            if project:
                project.series_id = None
                project.episode_number = None
                project.updated_at = time.time()
                self.project_repository.save(project)
        self.series_repository.delete(series_id)

    def add_episode(self, series_id: str, script_id: str, episode_number: int | None = None):
        """Attach an existing project to a series, rehoming if necessary."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        if project.series_id and project.series_id != series_id:
            old_series = self.series_repository.get(project.series_id)
            if old_series and script_id in old_series.episode_ids:
                old_series.episode_ids.remove(script_id)
                old_series.updated_at = time.time()
                self.series_repository.save(old_series)
        if script_id not in series.episode_ids:
            series.episode_ids.append(script_id)
        project.series_id = series_id
        project.episode_number = episode_number or len(series.episode_ids)
        project.updated_at = time.time()
        series.updated_at = time.time()
        self.project_repository.save(project)
        self.series_repository.save(series)
        return series

    def remove_episode(self, series_id: str, script_id: str):
        """Detach an episode from its series."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        if script_id in series.episode_ids:
            series.episode_ids.remove(script_id)
        project = self.project_repository.get(script_id)
        if project:
            project.series_id = None
            project.episode_number = None
            project.updated_at = time.time()
            self.project_repository.save(project)
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def get_episodes(self, series_id: str):
        """List projects currently linked to a series."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        return [project for project in self.project_repository.list() if project.series_id == series_id]

    def update_prompt_config(self, series_id: str, config: PromptConfig):
        """Replace the series-level prompt override configuration."""
        return self.update_series(series_id, {"prompt_config": config})

    def update_model_settings(self, series_id: str, updates: dict):
        """Patch non-null model settings fields for the series."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        series.model_settings = series.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def toggle_asset_lock(self, series_id: str, asset_id: str, asset_type: str):
        """Toggle lock state for a shared series asset."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.locked = not asset.locked
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def update_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str):
        """Update the selected image URL for a shared series asset."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def update_asset_attributes(self, series_id: str, asset_id: str, asset_type: str, attributes: dict):
        """Patch mutable attributes on a shared series asset."""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

    def _find_series_asset(self, series, asset_id: str, asset_type: str):
        """Resolve a concrete shared asset object by logical type and id."""
        if asset_type == "character":
            target = next((item for item in series.characters if item.id == asset_id), None)
        elif asset_type == "scene":
            target = next((item for item in series.scenes if item.id == asset_id), None)
        elif asset_type == "prop":
            target = next((item for item in series.props if item.id == asset_id), None)
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")
        if not target:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found in series")
        return target
