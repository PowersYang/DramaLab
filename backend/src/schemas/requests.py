from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TimelineAssetRequest(BaseModel):
    id: str
    kind: str
    source_url: str
    label: str = ""
    source_duration: float = 0
    frame_id: Optional[str] = None
    video_task_id: Optional[str] = None
    role: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TimelineTrackRequest(BaseModel):
    id: str
    track_type: str
    label: str
    order: int = 0
    enabled: bool = True
    locked: bool = False
    gain: float = 1.0
    solo: bool = False


class TimelineClipRequest(BaseModel):
    id: str
    asset_id: str
    track_id: str
    clip_order: int = 0
    timeline_start: float = 0
    timeline_end: float = 0
    source_start: float = 0
    source_end: float = 0
    volume: float = 1.0
    fade_in_duration: float = 0.0
    fade_out_duration: float = 0.0
    lane_index: int = 0
    linked_clip_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class UpdateProjectTimelineRequest(BaseModel):
    version: int = 0
    tracks: List[TimelineTrackRequest] = Field(default_factory=list)
    assets: List[TimelineAssetRequest] = Field(default_factory=list)
    clips: List[TimelineClipRequest] = Field(default_factory=list)


class FinalMixClipRequest(BaseModel):
    frame_id: str
    video_id: str
    clip_order: int
    trim_start: float = 0
    trim_end: float = 0


class FinalMixTimelineRequest(BaseModel):
    clips: List[FinalMixClipRequest] = Field(default_factory=list)


class GenerateAssetRequest(BaseModel):
    asset_id: str
    asset_type: str
    style_preset: str = "Cinematic"
    reference_image_url: Optional[str] = None
    style_prompt: Optional[str] = None
    generation_type: str = "all"
    prompt: Optional[str] = None
    apply_style: bool = True
    negative_prompt: Optional[str] = None
    batch_size: int = 1
    model_name: Optional[str] = None


class ToggleLockRequest(BaseModel):
    asset_id: str
    asset_type: str


class UpdateAssetImageRequest(BaseModel):
    asset_id: str
    asset_type: str
    image_url: str


class UpdateAssetAttributesRequest(BaseModel):
    asset_id: str
    asset_type: str
    attributes: Dict[str, Any]


class UploadAssetRequest(BaseModel):
    upload_type: str
    description: Optional[str] = None


class CreateProjectRequest(BaseModel):
    title: str
    text: str


class ReparseProjectRequest(BaseModel):
    text: str


class CreateSeriesRequest(BaseModel):
    title: str
    description: str = ""


class UpdateSeriesRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class AddEpisodeRequest(BaseModel):
    script_id: str
    episode_number: Optional[int] = None


class UpdateModelSettingsRequest(BaseModel):
    t2i_model: Optional[str] = None
    i2i_model: Optional[str] = None
    i2v_model: Optional[str] = None
    character_aspect_ratio: Optional[str] = None
    scene_aspect_ratio: Optional[str] = None
    prop_aspect_ratio: Optional[str] = None
    storyboard_aspect_ratio: Optional[str] = None


class ImportAssetsRequest(BaseModel):
    source_series_id: str
    asset_ids: List[str]


class ConfirmImportRequest(BaseModel):
    title: str
    description: str = ""
    import_id: str = ""
    text: Optional[str] = None
    episodes: List[Dict[str, Any]]


class AddCharacterRequest(BaseModel):
    name: str
    description: str


class AddSceneRequest(BaseModel):
    name: str
    description: str


class UpdateStyleRequest(BaseModel):
    style_preset: str
    style_prompt: Optional[str] = None


class GenerateMotionRefRequest(BaseModel):
    asset_id: str
    asset_type: str
    prompt: Optional[str] = None
    audio_url: Optional[str] = None
    negative_prompt: Optional[str] = None
    duration: int = 5
    batch_size: int = 1


class AnalyzeToStoryboardRequest(BaseModel):
    text: str


class RefinePromptRequest(BaseModel):
    frame_id: str
    raw_prompt: str
    assets: list = Field(default_factory=list)
    feedback: str = Field("", max_length=2000)


class CreateVideoTaskRequest(BaseModel):
    image_url: str
    prompt: str
    frame_id: Optional[str] = None
    duration: int = 5
    seed: Optional[int] = None
    resolution: str = "720p"
    generate_audio: bool = False
    audio_url: Optional[str] = None
    prompt_extend: bool = True
    negative_prompt: Optional[str] = None
    batch_size: int = 1
    model: str = "wan2.6-i2v"
    shot_type: str = "single"
    generation_mode: str = "i2v"
    reference_video_urls: List[str] = Field(default_factory=list)
    mode: Optional[str] = None
    sound: Optional[str] = None
    cfg_scale: Optional[float] = None
    vidu_audio: Optional[bool] = None
    movement_amplitude: Optional[str] = None


class GenerateAssetVideoRequest(BaseModel):
    prompt: Optional[str] = None
    duration: int = 5
    aspect_ratio: Optional[str] = None


class UpdateAssetDescriptionRequest(BaseModel):
    asset_id: str
    asset_type: str
    description: str


class SelectVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str
    generation_type: Optional[str] = None


class DeleteVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str


class FavoriteVariantRequest(BaseModel):
    asset_id: str
    asset_type: str
    variant_id: str
    generation_type: Optional[str] = None
    is_favorited: bool


class UpdatePromptConfigRequest(BaseModel):
    storyboard_polish: str = ""
    video_polish: str = ""
    r2v_polish: str = ""


class BindVoiceRequest(BaseModel):
    voice_id: str
    voice_name: str


class UpdateVoiceParamsRequest(BaseModel):
    speed: float = 1.0
    pitch: float = 1.0
    volume: int = 50


class PreviewVoiceRequest(BaseModel):
    text: Optional[str] = Field(None, max_length=120)


class GenerateLineAudioRequest(BaseModel):
    speed: float = 1.0
    pitch: float = 1.0
    volume: int = 50


class ToggleFrameLockRequest(BaseModel):
    frame_id: str


class UpdateFrameRequest(BaseModel):
    frame_id: str
    image_prompt: Optional[str] = None
    action_description: Optional[str] = None
    dialogue: Optional[str] = None
    camera_angle: Optional[str] = None
    scene_id: Optional[str] = None
    character_ids: Optional[List[str]] = None


class AddFrameRequest(BaseModel):
    scene_id: Optional[str] = None
    action_description: str = ""
    camera_angle: str = "medium_shot"
    insert_at: Optional[int] = None


class CreateOrganizationRequest(BaseModel):
    name: str
    slug: Optional[str] = None
    status: str = "active"


class UpdateOrganizationRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    status: Optional[str] = None


class CreateWorkspaceRequest(BaseModel):
    organization_id: Optional[str] = None
    name: str
    slug: Optional[str] = None
    status: str = "active"


class UpdateWorkspaceRequest(BaseModel):
    organization_id: Optional[str] = None
    name: Optional[str] = None
    slug: Optional[str] = None
    status: Optional[str] = None


class CreateUserRequest(BaseModel):
    email: Optional[str] = None
    display_name: Optional[str] = None
    status: str = "active"


class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    display_name: Optional[str] = None
    status: Optional[str] = None


class CreateRoleRequest(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    is_system: bool = False


class UpdateRoleRequest(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_system: Optional[bool] = None


class CreateModelProviderRequest(BaseModel):
    provider_key: str
    display_name: str
    description: Optional[str] = None
    enabled: bool = False
    base_url: Optional[str] = None
    credential_fields: List[str] = Field(default_factory=list)
    credentials_patch: Dict[str, Optional[str]] = Field(default_factory=dict)
    settings_json: Dict[str, Any] = Field(default_factory=dict)


class UpdateModelProviderRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    base_url: Optional[str] = None
    credentials_patch: Dict[str, Optional[str]] = Field(default_factory=dict)
    settings_patch: Dict[str, Any] = Field(default_factory=dict)


class CreateModelCatalogEntryRequest(BaseModel):
    model_id: str
    task_type: str
    provider_key: str
    display_name: str
    description: Optional[str] = None
    enabled: bool = True
    sort_order: int = 100
    is_public: bool = True
    capabilities_json: Dict[str, Any] = Field(default_factory=dict)
    default_settings_json: Dict[str, Any] = Field(default_factory=dict)


class UpdateModelCatalogEntryRequest(BaseModel):
    task_type: Optional[str] = None
    provider_key: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None
    is_public: Optional[bool] = None
    capabilities_json: Optional[Dict[str, Any]] = None
    default_settings_json: Optional[Dict[str, Any]] = None


class UpsertTaskConcurrencyLimitRequest(BaseModel):
    organization_id: str
    task_type: str
    max_concurrency: int = Field(..., ge=0)


class UpsertBillingPricingRuleRequest(BaseModel):
    organization_id: Optional[str] = None
    task_type: str
    price_credits: int = Field(..., ge=0)
    reserve_credits: Optional[int] = Field(None, ge=0)
    minimum_credits: int = Field(0, ge=0)
    charge_mode: str = "fixed"
    pricing_config_json: Dict[str, Any] = Field(default_factory=dict)
    usage_metric_key: Optional[str] = None
    status: str = "active"
    description: Optional[str] = None


class UpsertBillingRechargeBonusRuleRequest(BaseModel):
    organization_id: Optional[str] = None
    min_recharge_cents: int = Field(..., ge=0)
    max_recharge_cents: Optional[int] = Field(None, ge=0)
    bonus_credits: int = Field(..., ge=0)
    status: str = "active"
    description: Optional[str] = None


class CreateManualRechargeRequest(BaseModel):
    organization_id: str
    amount_cents: int = Field(..., gt=0)
    remark: Optional[str] = None
    workspace_id: Optional[str] = None
    billing_email: Optional[str] = None
    idempotency_key: Optional[str] = None


class CreatePaymentOrderRequest(BaseModel):
    channel: str
    amount_cents: int = Field(..., gt=0)
    subject: Optional[str] = None
    description: Optional[str] = None
    idempotency_key: Optional[str] = None


class SimulatePaymentOrderPaidRequest(BaseModel):
    provider_trade_no: Optional[str] = None
    provider_buyer_id: Optional[str] = None


class ManualAdjustBillingChargeRequest(BaseModel):
    direction: str
    amount_credits: int = Field(..., gt=0)
    reason: str
    remark: Optional[str] = None
    idempotency_key: Optional[str] = None


class RunBillingReconcileRequest(BaseModel):
    dry_run: bool = False


class CreateMembershipRequest(BaseModel):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None
    user_id: str
    role_id: Optional[str] = None
    status: str = "active"


class UpdateMembershipRequest(BaseModel):
    organization_id: Optional[str] = None
    workspace_id: Optional[str] = None
    user_id: Optional[str] = None
    role_id: Optional[str] = None
    status: Optional[str] = None


class SendEmailCodeRequest(BaseModel):
    email: Optional[str] = None
    target: Optional[str] = None
    channel: str = "email"
    purpose: str = "signin"
    captcha_id: str
    captcha_code: str


class VerifyEmailCodeRequest(BaseModel):
    email: Optional[str] = None
    target: Optional[str] = None
    channel: str = "email"
    code: str
    purpose: str = "signin"
    display_name: Optional[str] = None
    signup_kind: Optional[str] = None
    organization_name: Optional[str] = None
    invitation_id: Optional[str] = None


class PasswordSignInRequest(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    identifier: Optional[str] = None
    channel: str = "email"
    password: str
    captcha_id: str
    captcha_code: str


class PasswordSignUpRequest(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    identifier: Optional[str] = None
    channel: str = "email"
    password: str
    captcha_id: str
    captcha_code: str
    display_name: Optional[str] = None
    signup_kind: Optional[str] = None
    organization_name: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    identifier: Optional[str] = None
    channel: str = "email"
    code: str
    new_password: str
    captcha_id: str
    captcha_code: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class SwitchWorkspaceRequest(BaseModel):
    workspace_id: str


class InviteWorkspaceMemberRequest(BaseModel):
    email: str
    role_code: str


class UpdateWorkspaceMemberRoleRequest(BaseModel):
    role_code: str


class UpdateCurrentOrganizationRequest(BaseModel):
    name: str


class UpdateCurrentWorkspaceRequest(BaseModel):
    name: str


class CopyFrameRequest(BaseModel):
    frame_id: str
    insert_at: Optional[int] = None


class ReorderFramesRequest(BaseModel):
    frame_ids: List[str]


class RenderFrameRequest(BaseModel):
    frame_id: str
    composition_data: Optional[Dict[str, Any]] = None
    prompt: str
    batch_size: int = 1


class BatchRenderFrameItemRequest(BaseModel):
    frame_id: str
    composition_data: Optional[Dict[str, Any]] = None
    prompt: str
    batch_size: int = 1


class BatchRenderFrameRequest(BaseModel):
    items: List[BatchRenderFrameItemRequest] = Field(default_factory=list)


class SelectVideoRequest(BaseModel):
    video_id: str


class ExtractLastFrameRequest(BaseModel):
    video_task_id: str


class ExportRequest(BaseModel):
    resolution: str = "1080p"
    format: str = "mp4"
    subtitles: str = "none"
    final_mix_timeline: Optional[FinalMixTimelineRequest] = None


class MergeVideosRequest(BaseModel):
    final_mix_timeline: Optional[FinalMixTimelineRequest] = None


class AnalyzeStyleRequest(BaseModel):
    script_text: str


class SaveArtDirectionRequest(BaseModel):
    selected_style_id: str
    style_config: Dict[str, Any]
    custom_styles: List[Dict[str, Any]] = Field(default_factory=list)
    ai_recommendations: List[Dict[str, Any]] = Field(default_factory=list)


class UserArtStyleWriteRequest(BaseModel):
    id: str
    name: str
    description: str = ""
    positive_prompt: str
    negative_prompt: str = ""
    thumbnail_url: Optional[str] = None
    is_custom: bool = True
    reason: Optional[str] = None
    sort_order: Optional[int] = None


class SaveUserArtStylesRequest(BaseModel):
    styles: List[UserArtStyleWriteRequest] = Field(default_factory=list)


class PolishVideoPromptRequest(BaseModel):
    draft_prompt: str
    feedback: str = Field("", max_length=2000)
    script_id: str = ""


class RefSlot(BaseModel):
    description: str


class PolishR2VPromptRequest(BaseModel):
    draft_prompt: str
    slots: List[RefSlot]
    feedback: str = Field("", max_length=2000)
    script_id: str = ""


class CreatePropRequest(BaseModel):
    name: str
    description: str = ""
