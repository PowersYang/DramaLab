from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from ..utils.datetime import epoch_start, utc_now


# Keep ORM models portable across SQLite tests and PostgreSQL production.
# JSONB is only used when the active dialect is PostgreSQL.
JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class TenantAuditMixin:
    organization_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    workspace_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class SoftDeleteMixin:
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class OrganizationRecord(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class WorkspaceRecord(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    organization_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("organizations.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class RoleRecord(Base):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class MembershipRecord(Base):
    __tablename__ = "memberships"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    organization_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("organizations.id"), nullable=True, index=True)
    workspace_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("workspaces.id"), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    role_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("roles.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class BillingAccountRecord(Base):
    __tablename__ = "billing_accounts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    organization_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("organizations.id"), nullable=True, index=True)
    workspace_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("workspaces.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    billing_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    billing_metadata: Mapped[dict] = mapped_column("metadata", JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class StylePresetRecord(Base):
    __tablename__ = "style_presets"
    __table_args__ = (
        Index("ix_style_presets_active_sort", "is_active", "sort_order", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    positive_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    negative_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ProjectRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_org_workspace_updated", "organization_id", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    style_preset: Mapped[str] = mapped_column(String(128), default="realistic", nullable=False)
    style_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    merged_video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    series_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    art_direction: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    model_settings: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    prompt_config: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class SeriesRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "series"
    __table_args__ = (
        Index("ix_series_org_workspace_updated", "organization_id", "workspace_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    art_direction: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    model_settings: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    prompt_config: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class CharacterRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "characters"
    __table_args__ = (
        Index("ix_characters_owner", "owner_type", "owner_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    age: Mapped[str | None] = mapped_column(String(128), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(64), nullable=True)
    clothing: Mapped[str | None] = mapped_column(Text, nullable=True)
    visual_weight: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    full_body_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_body_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_body_asset_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    three_view_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    three_view_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    three_view_asset_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    headshot_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    headshot_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    headshot_asset_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_consistent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    full_body_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    three_view_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=epoch_start, nullable=False)
    headshot_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=epoch_start, nullable=False)
    base_character_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    voice_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    voice_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voice_speed: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    voice_pitch: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    voice_volume: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)


class SceneRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "scenes"
    __table_args__ = (
        Index("ix_scenes_owner", "owner_type", "owner_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    visual_weight: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    time_of_day: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lighting_mood: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)


class PropRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "props"
    __table_args__ = (
        Index("ix_props_owner", "owner_type", "owner_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sfx_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    bgm_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)


class CharacterAssetUnitRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "character_asset_units"
    __table_args__ = (
        Index("ix_character_asset_units_character", "character_id", "unit_type", unique=True),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    character_id: Mapped[str] = mapped_column(String(64), ForeignKey("characters.id"), nullable=False)
    unit_type: Mapped[str] = mapped_column(String(32), nullable=False)
    selected_image_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selected_video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    image_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    video_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=epoch_start, nullable=False)


class ImageVariantRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "image_variants"
    __table_args__ = (
        Index("ix_image_variants_owner", "owner_type", "owner_id", "variant_group"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_group: Mapped[str] = mapped_column(String(64), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_used: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_uploaded_source: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    upload_type: Mapped[str | None] = mapped_column(String(64), nullable=True)


class VideoVariantRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "video_variants"
    __table_args__ = (
        Index("ix_video_variants_owner", "owner_type", "owner_id", "variant_group"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    variant_group: Mapped[str] = mapped_column(String(64), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_used: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_image_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_favorited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class StoryboardFrameRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "storyboard_frames"
    __table_args__ = (
        Index("ix_storyboard_frames_project", "project_id", "frame_order"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id"), nullable=False, index=True)
    frame_order: Mapped[int] = mapped_column(Integer, nullable=False)
    scene_id: Mapped[str] = mapped_column(String(64), nullable=False)
    character_ids: Mapped[list] = mapped_column(JSON_TYPE, default=list, nullable=False)
    prop_ids: Mapped[list] = mapped_column(JSON_TYPE, default=list, nullable=False)
    action_description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    facial_expression: Mapped[str | None] = mapped_column(Text, nullable=True)
    dialogue: Mapped[str | None] = mapped_column(Text, nullable=True)
    speaker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    visual_atmosphere: Mapped[str | None] = mapped_column(Text, nullable=True)
    character_acting: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_action_physics: Mapped[str | None] = mapped_column(Text, nullable=True)
    shot_size: Mapped[str | None] = mapped_column(String(128), nullable=True)
    camera_angle: Mapped[str] = mapped_column(String(128), default="Medium Shot", nullable=False)
    camera_movement: Mapped[str | None] = mapped_column(String(128), nullable=True)
    composition: Mapped[str | None] = mapped_column(Text, nullable=True)
    atmosphere: Mapped[str | None] = mapped_column(Text, nullable=True)
    composition_data: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    image_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_prompt_cn: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_prompt_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rendered_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    rendered_image_selected_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    sfx_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)


class VideoTaskRecord(TenantAuditMixin, SoftDeleteMixin, Base):
    __tablename__ = "video_tasks"
    __table_args__ = (
        Index("ix_video_tasks_project", "project_id", "created_at"),
        Index("ix_video_tasks_owner_asset", "asset_id", "frame_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id"), nullable=False, index=True)
    frame_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_job_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    failed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolution: Mapped[str] = mapped_column(String(64), default="720p", nullable=False)
    generate_audio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_extend: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    negative_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(128), default="wan2.6-i2v", nullable=False)
    shot_type: Mapped[str] = mapped_column(String(64), default="single", nullable=False)
    generation_mode: Mapped[str] = mapped_column(String(64), default="i2v", nullable=False)
    reference_video_urls: Mapped[list] = mapped_column(JSON_TYPE, default=list, nullable=False)
    mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sound: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cfg_scale: Mapped[float | None] = mapped_column(Float, nullable=True)
    vidu_audio: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    movement_amplitude: Mapped[str | None] = mapped_column(String(64), nullable=True)


class TaskJobRecord(TenantAuditMixin, Base):
    __tablename__ = "task_jobs"
    __table_args__ = (
        Index("ix_task_jobs_queue_sched", "status", "queue_name", "scheduled_at"),
        Index("ix_task_jobs_project_created", "project_id", "created_at"),
        Index("ix_task_jobs_series_created", "series_id", "created_at"),
        Index("ix_task_jobs_resource_created", "resource_type", "resource_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False, index=True)
    queue_name: Mapped[str] = mapped_column(String(32), default="default", nullable=False, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    series_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    payload_json: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    result_json: Mapped[dict | None] = mapped_column(JSON_TYPE, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    max_attempts: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=1800, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class TaskAttemptRecord(TenantAuditMixin, Base):
    __tablename__ = "task_attempts"
    __table_args__ = (
        Index("ix_task_attempts_job_attempt", "job_id", "attempt_no"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), ForeignKey("task_jobs.id"), nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    worker_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32), default="running", nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metrics_json: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class TaskEventRecord(TenantAuditMixin, Base):
    __tablename__ = "task_events"
    __table_args__ = (
        Index("ix_task_events_job_created", "job_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), ForeignKey("task_jobs.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_payload_json: Mapped[dict] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
