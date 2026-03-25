from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


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


class EnvConfig(BaseModel):
    DASHSCOPE_API_KEY: Optional[str] = None
    ALIBABA_CLOUD_ACCESS_KEY_ID: Optional[str] = None
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: Optional[str] = None
    OSS_BUCKET_NAME: Optional[str] = None
    OSS_ENDPOINT: Optional[str] = None
    OSS_BASE_PATH: Optional[str] = None
    KLING_ACCESS_KEY: Optional[str] = None
    KLING_SECRET_KEY: Optional[str] = None
    VIDU_API_KEY: Optional[str] = None
    endpoint_overrides: Dict[str, str] = Field(default_factory=dict)


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


class SelectVideoRequest(BaseModel):
    video_id: str


class ExtractLastFrameRequest(BaseModel):
    video_task_id: str


class ExportRequest(BaseModel):
    resolution: str = "1080p"
    format: str = "mp4"
    subtitles: str = "none"


class AnalyzeStyleRequest(BaseModel):
    script_text: str


class SaveArtDirectionRequest(BaseModel):
    selected_style_id: str
    style_config: Dict[str, Any]
    custom_styles: List[Dict[str, Any]] = Field(default_factory=list)
    ai_recommendations: List[Dict[str, Any]] = Field(default_factory=list)


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
