from datetime import datetime
from typing import List, Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field
from ..utils.datetime import epoch_start, utc_now

class AspectRatio(str, Enum):
    SQUARE = "1:1"
    PORTRAIT = "9:16"
    LANDSCAPE = "16:9"
    CINEMA = "21:9"

class GenerationStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class ImageVariant(BaseModel):
    id: str = Field(..., description="这张候选图的唯一标识")
    url: str = Field(..., description="图片地址")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    prompt_used: Optional[str] = Field(None, description="生成这张图时使用的提示词")
    is_favorited: bool = Field(False, description="这张图是否已收藏或置顶；置顶后不会被自动删除")
    # 新增：上传来源标记
    is_uploaded_source: bool = Field(False, description="是否为用户上传的源文件")
    upload_type: Optional[str] = Field(None, description="上传类型；当 is_uploaded_source 为 True 时可为 full_body/head_shot/three_views/image")

# 每个素材最多保留多少张未收藏的历史图片
MAX_VARIANTS_PER_ASSET = 10

class ImageAsset(BaseModel):
    selected_id: Optional[str] = Field(None, description="当前选中的图片版本 ID")
    variants: List[ImageVariant] = Field(default_factory=list, description="该素材的历史出图记录")

class VideoVariant(BaseModel):
    """用于动作参考的视频版本。"""
    id: str = Field(..., description="这条视频的唯一标识")
    url: str = Field(..., description="视频地址")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    prompt_used: Optional[str] = Field(None, description="生成这条视频时使用的提示词")
    audio_url: Optional[str] = Field(None, description="驱动音频地址（用于口型同步）")
    source_image_id: Optional[str] = Field(None, description="作为源输入的静态图片 ID")
    is_favorited: bool = Field(False, description="这条视频是否已收藏")

class AssetUnit(BaseModel):
    """统一素材容器，同时保存静态图和动作参考视频。"""
    # 静态图片
    selected_image_id: Optional[str] = Field(None, description="当前选中的图片 ID")
    image_variants: List[ImageVariant] = Field(default_factory=list, description="静态图片候选列表")
    
    # 动作参考（视频）
    selected_video_id: Optional[str] = Field(None, description="当前选中的动作参考视频 ID")
    video_variants: List[VideoVariant] = Field(default_factory=list, description="动作参考视频候选列表")
    
    # 提示词
    image_prompt: Optional[str] = Field(None, description="图片生成时使用的提示词")
    video_prompt: Optional[str] = Field(None, description="动作参考生成时使用的提示词")
    
    # 用于一致性追踪的时间戳
    image_updated_at: datetime = Field(default_factory=utc_now, description="最近一次更新图片的时间")
    video_updated_at: datetime = Field(default_factory=epoch_start, description="最近一次更新动作参考的时间")

class VideoTask(BaseModel):
    id: str
    project_id: str
    frame_id: Optional[str] = Field(None, description="该视频所属的分镜帧 ID")
    asset_id: Optional[str] = Field(None, description="该视频所属的素材 ID")
    source_job_id: Optional[str] = Field(None, description="创建该业务视频记录的统一任务 ID")
    provider_task_id: Optional[str] = Field(None, description="下游模型供应商返回的任务 ID")
    image_url: str
    prompt: str
    status: str = "pending"  # pending、processing、completed、failed
    video_url: Optional[str] = None
    failed_reason: Optional[str] = Field(None, description="失败原因摘要，供前端快速展示")
    completed_at: Optional[datetime] = Field(None, description="视频任务完成时间")
    duration: int = Field(5, description="视频时长（秒，具体范围取决于模型）")
    seed: Optional[int] = Field(None, description="随机种子，用于复现结果")
    resolution: str = Field("720p", description="视频分辨率")
    generate_audio: bool = Field(False, description="是否生成音频")
    audio_url: Optional[str] = Field(None, description="生成或上传的音频地址")
    prompt_extend: bool = Field(True, description="是否启用提示词扩写")
    negative_prompt: Optional[str] = Field(None, description="负向提示词")
    model: str = Field("wan2.6-i2v", description="生成所使用的模型")
    shot_type: str = Field("single", description="镜头类型：'single' 或 'multi'（仅适用于 wan2.6-i2v）")
    generation_mode: str = Field("i2v", description="生成模式：'i2v'（图生视频）或 'r2v'（参考生视频）")
    reference_video_urls: List[str] = Field(default_factory=list, description="R2V 生成时使用的参考视频地址列表（最多 3 个）")
    # Kling 相关参数
    mode: Optional[str] = Field(None, description="Kling 模式：std/pro")
    sound: Optional[str] = Field(None, description="Kling 音效开关：on/off")
    cfg_scale: Optional[float] = Field(None, description="Kling 的 cfg_scale 参数：0-1")
    # Vidu 相关参数
    vidu_audio: Optional[bool] = Field(None, description="Vidu 是否输出音频")
    movement_amplitude: Optional[str] = Field(None, description="Vidu 动作幅度：auto/small/medium/large")
    created_at: datetime = Field(default_factory=utc_now)
    is_deleted: bool = Field(False, description="软删除标记")

class Character(BaseModel):
    id: str = Field(..., description="角色的唯一标识")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    name: str = Field(..., description="角色名称")
    description: str = Field(..., description="角色外貌与性格描述")
    
    # 新增属性
    age: Optional[str] = Field(None, description="角色年龄")
    gender: Optional[str] = Field(None, description="角色性别")
    clothing: Optional[str] = Field(None, description="角色服装描述")
    visual_weight: int = Field(3, description="视觉权重（1-5）")
    
    # === 新版：Asset Activation v2 - 统一素材单元 ===
    # 每个单元同时包含静态图和动作参考
    full_body: Optional[AssetUnit] = Field(default_factory=AssetUnit, description="全身素材单元（主素材）")
    three_views: Optional[AssetUnit] = Field(default_factory=AssetUnit, description="三视图素材单元")
    head_shot: Optional[AssetUnit] = Field(default_factory=AssetUnit, description="头像素材单元")
    
    # === 旧字段：为向后兼容而保留 ===
    # 第 1 层：全身图（主素材）
    full_body_image_url: Optional[str] = Field(None, description="[LEGACY] 全身主图地址")
    full_body_prompt: Optional[str] = Field(None, description="[LEGACY] 生成全身图时使用的提示词")
    full_body_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="[LEGACY] 全身素材容器")

    # 第 2 层：三视图（派生）
    three_view_image_url: Optional[str] = Field(None, description="[LEGACY] 三视图角色设定图地址")
    three_view_prompt: Optional[str] = Field(None, description="[LEGACY] 生成三视图时使用的提示词")
    three_view_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="[LEGACY] 三视图素材容器")

    # 第 2 层：头像（派生）
    headshot_image_url: Optional[str] = Field(None, description="[LEGACY] 头像地址")
    headshot_prompt: Optional[str] = Field(None, description="[LEGACY] 生成头像时使用的提示词")
    headshot_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="[LEGACY] 头像素材容器")

    # 视频素材（旧版 R2V，后续会迁移到 AssetUnit.video_variants）
    video_assets: List[VideoTask] = Field(default_factory=list, description="[LEGACY] 已生成的参考视频")
    video_prompt: Optional[str] = Field(None, description="[LEGACY] 视频生成使用的提示词")

    # 旧字段（为兼容保留，并映射到新字段）
    image_url: Optional[str] = Field(None, description="[LEGACY] 映射到 three_view_image_url")
    avatar_url: Optional[str] = Field(None, description="[LEGACY] 映射到 headshot_image_url")

    is_consistent: bool = Field(True, description="派生素材是否与全身主素材保持一致")
    
    # 用于一致性追踪的时间戳（旧版，现已迁移到 AssetUnit）
    full_body_updated_at: datetime = Field(default_factory=utc_now, description="[LEGACY] 最近一次更新全身图的时间")
    three_view_updated_at: datetime = Field(default_factory=epoch_start, description="[LEGACY] 最近一次更新三视图的时间")
    headshot_updated_at: datetime = Field(default_factory=epoch_start, description="[LEGACY] 最近一次更新头像的时间")

    base_character_id: Optional[str] = Field(None, description="若该角色是变体，则为其基础角色 ID")
    voice_id: Optional[str] = Field(None, description="要使用的语音模型 ID")
    voice_name: Optional[str] = Field(None, description="人类可读的语音名称")
    voice_speed: float = Field(1.0, description="默认语速（0.5-2.0）")
    voice_pitch: float = Field(1.0, description="默认音高倍率（0.5-2.0）")
    voice_volume: int = Field(50, description="默认音量（0-100）")
    locked: bool = Field(False, description="该素材是否锁定，锁定后不再重新生成")
    status: GenerationStatus = GenerationStatus.PENDING

class Scene(BaseModel):
    id: str = Field(..., description="场景的唯一标识")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    name: str = Field(..., description="地点或场景名称")
    description: str = Field(..., description="环境的视觉描述")
    visual_weight: int = Field(3, description="视觉权重（1-5）")
    time_of_day: Optional[str] = Field(None, description="时间段（例如夜晚、白天）")
    lighting_mood: Optional[str] = Field(None, description="光照氛围")
    image_url: Optional[str] = Field(None, description="生成的场景参考图地址（旧字段）")
    image_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="场景图片素材容器")
    
    # 视频素材（R2V 新增）
    video_assets: List[VideoTask] = Field(default_factory=list, description="该场景生成的参考视频")
    video_prompt: Optional[str] = Field(None, description="视频生成使用的提示词")
    
    locked: bool = Field(False, description="该素材是否锁定，锁定后不再重新生成")
    status: GenerationStatus = GenerationStatus.PENDING

class Prop(BaseModel):
    id: str = Field(..., description="道具的唯一标识")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    name: str = Field(..., description="物体名称")
    description: str = Field(..., description="物体的视觉描述")
    video_url: Optional[str] = None
    audio_url: Optional[str] = None
    sfx_url: Optional[str] = None
    bgm_url: Optional[str] = None
    image_url: Optional[str] = Field(None, description="生成的道具图片地址（旧字段）")
    image_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="道具图片素材容器")
    
    # 视频素材（R2V 新增）
    video_assets: List[VideoTask] = Field(default_factory=list, description="该道具生成的参考视频")
    video_prompt: Optional[str] = Field(None, description="视频生成使用的提示词")
    
    locked: bool = Field(False, description="该素材是否锁定，锁定后不再重新生成")
    status: GenerationStatus = GenerationStatus.PENDING

class StoryboardFrame(BaseModel):
    id: str = Field(..., description="分镜帧的唯一标识")
    frame_order: int = Field(0, description="分镜帧在项目中的排序序号")
    scene_id: str = Field(..., description="关联的场景 ID")
    character_ids: List[str] = Field(default_factory=list, description="该帧中出现的角色 ID 列表")
    prop_ids: List[str] = Field(default_factory=list, description="该帧中出现的道具 ID 列表")
    
    # 旧字段（为兼容保留）
    action_description: str = Field("", description="这一帧发生的事情（旧字段，建议使用 character_acting）")
    facial_expression: Optional[str] = Field(None, description="具体的面部表情")
    dialogue: Optional[str] = Field(None, description="对白文本内容")
    speaker: Optional[str] = Field(None, description="说话人名称")
    
    # === 新版：视觉原子（Storyboard Dramatization v2）===
    visual_atmosphere: Optional[str] = Field(None, description="环境氛围：光线、情绪、体积雾等效果")
    character_acting: Optional[str] = Field(None, description="角色表演：神态、肢体语言、微表情等")
    key_action_physics: Optional[str] = Field(None, description="关键动作与物理细节：形变、材质、运动表现等")
    
    # === 镜头参数 ===
    shot_size: Optional[str] = Field(None, description="景别：特写/近景/中景/全景/远景")
    camera_angle: str = Field("Medium Shot", description="机位或镜头类型（旧字段）")
    camera_movement: Optional[str] = Field(None, description="镜头运动方式")
    composition: Optional[str] = Field(None, description="画面构图指引")
    atmosphere: Optional[str] = Field(None, description="该镜头的情绪氛围（旧字段，建议使用 visual_atmosphere）")
    
    # 构图数据（用于画布的 JSON 结构）
    composition_data: Optional[Dict[str, Any]] = Field(None, description="表示画布构图的 JSON 数据")
    
    # === 提示词 ===
    image_prompt: Optional[str] = Field(None, description="用于 T2I/I2I 的优化提示词（旧字段）")
    image_prompt_cn: Optional[str] = Field(None, description="供用户确认的润色中文提示词")
    image_prompt_en: Optional[str] = Field(None, description="供 Wan 模型生成使用的润色英文提示词")
    
    image_url: Optional[str] = Field(None, description="生成的分镜图片地址（旧字段）")
    image_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="分镜图片素材容器")
    rendered_image_url: Optional[str] = Field(None, description="高保真渲染图地址（旧字段）")
    rendered_image_asset: Optional[ImageAsset] = Field(default_factory=ImageAsset, description="渲染图素材容器")
    
    video_prompt: Optional[str] = Field(None, description="用于 I2V 的优化提示词")
    video_url: Optional[str] = Field(None, description="生成的视频片段地址")
    
    audio_url: Optional[str] = Field(None, description="生成的对白音频地址")
    audio_error: Optional[str] = Field(None, description="音频生成错误信息")
    sfx_url: Optional[str] = Field(None, description="生成的音效地址")
    
    selected_video_id: Optional[str] = Field(None, description="该帧当前选中的 VideoTask ID")
    locked: bool = Field(False, description="该帧是否锁定，锁定后不再重新生成")
    status: GenerationStatus = GenerationStatus.PENDING
    updated_at: datetime = Field(default_factory=utc_now, description="最近一次更新时间")

class ModelSettings(BaseModel):
    """不同生成阶段对应的模型配置。"""
    t2i_model: str = Field("wan2.6-t2i", description="素材生成使用的文生图模型")
    i2i_model: str = Field("wan2.6-image", description="分镜生成使用的图生图模型")
    i2v_model: str = Field("wan2.6-i2v", description="动作生成使用的图生视频模型")
    character_aspect_ratio: str = Field("9:16", description="角色素材的宽高比（9:16、16:9、1:1）")
    scene_aspect_ratio: str = Field("16:9", description="场景素材的宽高比（9:16、16:9、1:1）")
    prop_aspect_ratio: str = Field("1:1", description="道具素材的宽高比（9:16、16:9、1:1）")
    storyboard_aspect_ratio: str = Field("16:9", description="分镜素材的宽高比（9:16、16:9、1:1）")


class CaptchaChallenge(BaseModel):
    id: str
    code_hash: str
    expires_at: datetime
    consumed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class CaptchaChallengePayload(BaseModel):
    captcha_id: str
    image_svg: str
    expires_in_seconds: int
    debug_code: Optional[str] = None


class AuthRateLimitEntry(BaseModel):
    id: str
    action: str
    scope_type: str
    scope_key: str
    created_at: datetime


class StylePreset(BaseModel):
    """数据库中的风格预设定义。"""
    id: str = Field(..., description="风格预设唯一标识")
    name: str = Field(..., description="风格名称")
    description: Optional[str] = Field(None, description="风格说明")
    positive_prompt: str = Field(..., description="正向提示词")
    negative_prompt: Optional[str] = Field(None, description="负向提示词")
    thumbnail_url: Optional[str] = Field(None, description="预览缩略图地址")
    sort_order: int = Field(100, description="显示顺序，越小越靠前")
    is_builtin: bool = Field(False, description="是否为系统内置预设")
    is_active: bool = Field(True, description="是否可用")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class ArtDirection(BaseModel):
    """全局视觉风格的美术指导配置。"""
    selected_style_id: str = Field(..., description="当前选中的风格 ID")
    style_config: Dict[str, Any] = Field(..., description="完整的风格配置")
    custom_styles: List[Dict[str, Any]] = Field(default_factory=list, description="用户自定义风格列表")
    ai_recommendations: List[Dict[str, Any]] = Field(default_factory=list, description="AI 推荐风格列表")

class PromptConfig(BaseModel):
    """润色阶段的自定义系统提示词配置；空字符串表示使用系统默认值。"""
    storyboard_polish: str = Field("", description="分镜润色阶段的自定义系统提示词（Prompt C）")
    video_polish: str = Field("", description="视频 I2V 润色阶段的自定义系统提示词（Prompt D）")
    r2v_polish: str = Field("", description="视频 R2V 润色阶段的自定义系统提示词（Prompt E）")

class Script(BaseModel):
    id: str = Field(..., description="脚本项目的唯一标识")
    title: str = Field(..., description="漫画或视频标题")
    original_text: str = Field(..., description="原始小说文本")
    
    characters: List[Character] = Field(default_factory=list)
    scenes: List[Scene] = Field(default_factory=list)
    props: List[Prop] = Field(default_factory=list)
    frames: List[StoryboardFrame] = Field(default_factory=list)
    video_tasks: List[VideoTask] = Field(default_factory=list)
    
    # 全局风格设置（旧方案，后续会被 art_direction 取代）
    style_preset: str = Field("realistic", description="所有图片生成共用的全局风格预设")
    style_prompt: Optional[str] = Field(None, description="追加到所有生成任务中的自定义风格提示词")
    
    # 美术指导配置（新方案）
    art_direction: Optional[ArtDirection] = Field(None, description="全局视觉风格配置")
    
    # 各生成阶段的模型设置
    model_settings: ModelSettings = Field(default_factory=ModelSettings, description="T2I/I2I/I2V 的模型选择配置")

    # 润色阶段的自定义提示词配置
    prompt_config: PromptConfig = Field(default_factory=PromptConfig, description="润色阶段的自定义系统提示词")

    # 合并后成片的视频地址
    merged_video_url: Optional[str] = Field(None, description="最终合并视频的地址")

    # 剧集关联信息
    series_id: Optional[str] = Field(None, description="所属 Series 的 ID；独立项目时为 None")
    episode_number: Optional[int] = Field(None, description="在所属 Series 中的集数")

    # SaaS 预留租户与审计字段
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    workspace_id: Optional[str] = Field(None, description="所属工作区 ID")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    version: int = Field(1, description="乐观锁版本号")

    created_at: datetime
    updated_at: datetime


class Series(BaseModel):
    """一个 Series 用于管理多个共享素材与配置的剧集。"""
    id: str = Field(..., description="系列的唯一标识")
    title: str = Field(..., description="系列标题")
    description: str = Field("", description="系列简介或梗概")

    # 共享素材库
    characters: List[Character] = Field(default_factory=list, description="共享角色素材")
    scenes: List[Scene] = Field(default_factory=list, description="共享场景素材")
    props: List[Prop] = Field(default_factory=list, description="共享道具素材")

    # 统一视觉风格
    art_direction: Optional[ArtDirection] = Field(None, description="系列级别的美术指导配置")

    # 系列级提示词配置
    prompt_config: PromptConfig = Field(default_factory=PromptConfig, description="系列级别的自定义提示词")

    # 模型设置
    model_settings: ModelSettings = Field(default_factory=ModelSettings, description="系列级别的模型设置")

    # 剧集引用
    episode_ids: List[str] = Field(default_factory=list, description="按顺序排列的 Episode/Script ID 列表")

    # SaaS 预留租户与审计字段
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    workspace_id: Optional[str] = Field(None, description="所属工作区 ID")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    version: int = Field(1, description="乐观锁版本号")

    created_at: datetime
    updated_at: datetime


class Organization(BaseModel):
    """租户下的公司/组织对象。"""

    id: str = Field(..., description="组织唯一标识")
    name: str = Field(..., description="组织名称")
    slug: Optional[str] = Field(None, description="组织可读 slug")
    status: str = Field("active", description="组织状态")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class Workspace(BaseModel):
    """组织下的工作区对象。"""

    id: str = Field(..., description="工作区唯一标识")
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    name: str = Field(..., description="工作区名称")
    slug: Optional[str] = Field(None, description="工作区可读 slug")
    status: str = Field("active", description="工作区状态")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class User(BaseModel):
    """平台用户对象。"""

    id: str = Field(..., description="用户唯一标识")
    email: Optional[str] = Field(None, description="邮箱地址")
    phone: Optional[str] = Field(None, description="手机号")
    display_name: Optional[str] = Field(None, description="显示名称")
    auth_provider: str = Field("email_otp", description="认证提供方")
    password_hash: Optional[str] = Field(None, description="密码哈希，仅服务端内部使用", exclude=True)
    user_art_styles: List[Dict[str, Any]] = Field(default_factory=list, description="用户级自定义美术风格库")
    platform_role: Optional[str] = Field(None, description="平台级角色")
    status: str = Field("active", description="用户状态")
    last_login_at: Optional[datetime] = Field(None, description="最后登录时间")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class Role(BaseModel):
    """平台角色定义。"""

    id: str = Field(..., description="角色唯一标识")
    code: str = Field(..., description="角色编码")
    name: str = Field(..., description="角色名称")
    description: Optional[str] = Field(None, description="角色说明")
    is_system: bool = Field(False, description="是否为系统内置角色")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class Membership(BaseModel):
    """用户与组织/工作区/角色之间的成员关系。"""

    id: str = Field(..., description="成员关系唯一标识")
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    workspace_id: Optional[str] = Field(None, description="所属工作区 ID")
    user_id: str = Field(..., description="用户 ID")
    role_id: Optional[str] = Field(None, description="角色 ID")
    status: str = Field("active", description="成员关系状态")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class BillingAccount(BaseModel):
    """组织级算力豆账本。"""

    id: str = Field(..., description="账本唯一标识")
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    workspace_id: Optional[str] = Field(None, description="默认工作区 ID")
    owner_type: str = Field("organization", description="账本所有者类型")
    owner_id: Optional[str] = Field(None, description="账本所有者 ID")
    status: str = Field("active", description="账本状态")
    currency: str = Field("CNY", description="货币单位")
    balance_credits: int = Field(0, description="当前算力豆余额")
    total_recharged_cents: int = Field(0, description="累计充值金额，单位分")
    total_credited: int = Field(0, description="累计入账算力豆")
    total_bonus_credits: int = Field(0, description="累计赠送算力豆")
    total_consumed_credits: int = Field(0, description="累计消耗算力豆")
    pricing_version: Optional[str] = Field(None, description="当前价格规则版本")
    billing_email: Optional[str] = Field(None, description="账单通知邮箱")
    billing_metadata: Dict[str, Any] = Field(default_factory=dict, description="额外账务元数据")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class BillingTransaction(BaseModel):
    """账务流水；所有扣费、充值、赠送、补扣都必须落这里。"""

    id: str = Field(..., description="流水唯一标识")
    billing_account_id: str = Field(..., description="所属账本 ID")
    organization_id: Optional[str] = Field(None, description="所属组织 ID")
    workspace_id: Optional[str] = Field(None, description="所属工作区 ID")
    transaction_type: str = Field(..., description="流水类型")
    direction: str = Field(..., description="入账或出账方向")
    amount_credits: int = Field(..., description="本次变动的算力豆数量")
    balance_before: int = Field(..., description="变动前余额")
    balance_after: int = Field(..., description="变动后余额")
    cash_amount_cents: Optional[int] = Field(None, description="关联充值金额，单位分")
    related_type: Optional[str] = Field(None, description="关联对象类型")
    related_id: Optional[str] = Field(None, description="关联对象 ID")
    task_type: Optional[str] = Field(None, description="任务类型")
    rule_snapshot_json: Dict[str, Any] = Field(default_factory=dict, description="命中的价格或赠送规则快照")
    remark: Optional[str] = Field(None, description="备注")
    operator_user_id: Optional[str] = Field(None, description="操作人")
    operator_source: str = Field("system", description="操作来源")
    idempotency_key: Optional[str] = Field(None, description="幂等键")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class BillingPricingRule(BaseModel):
    """平台或组织级任务定价规则。"""

    id: str = Field(..., description="规则唯一标识")
    scope_type: str = Field("platform", description="作用域类型")
    organization_id: Optional[str] = Field(None, description="组织级覆写时的组织 ID")
    task_type: str = Field(..., description="任务类型编码")
    charge_mode: str = Field("fixed", description="计费模式")
    price_credits: int = Field(..., description="固定扣费豆数")
    status: str = Field("active", description="规则状态")
    effective_from: datetime = Field(default_factory=utc_now, description="生效开始时间")
    effective_to: Optional[datetime] = Field(None, description="生效结束时间")
    description: Optional[str] = Field(None, description="规则说明")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class BillingRechargeBonusRule(BaseModel):
    """充值赠送规则。"""

    id: str = Field(..., description="赠送规则唯一标识")
    scope_type: str = Field("platform", description="作用域类型")
    organization_id: Optional[str] = Field(None, description="组织级覆写时的组织 ID")
    min_recharge_cents: int = Field(..., description="最小充值金额，单位分")
    max_recharge_cents: Optional[int] = Field(None, description="最大充值金额，单位分")
    bonus_credits: int = Field(..., description="赠送算力豆数量")
    status: str = Field("active", description="规则状态")
    effective_from: datetime = Field(default_factory=utc_now, description="生效开始时间")
    effective_to: Optional[datetime] = Field(None, description="生效结束时间")
    description: Optional[str] = Field(None, description="规则说明")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class ModelProviderConfig(BaseModel):
    """平台级模型供应商配置。"""

    provider_key: str = Field(..., description="供应商唯一键，例如 DASHSCOPE/KLING")
    display_name: str = Field(..., description="供应商展示名称")
    description: Optional[str] = Field(None, description="供应商说明")
    enabled: bool = Field(True, description="供应商是否启用")
    base_url: Optional[str] = Field(None, description="覆盖后的基础地址")
    credentials_json: Dict[str, str] = Field(default_factory=dict, description="供应商凭据明文字典，仅服务端可见")
    settings_json: Dict[str, Any] = Field(default_factory=dict, description="运行时补充设置，如默认文本模型")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class ModelProviderConfigSummary(BaseModel):
    """面向管理端的供应商配置摘要，不回显真实密钥。"""

    provider_key: str = Field(..., description="供应商唯一键")
    display_name: str = Field(..., description="供应商展示名称")
    description: Optional[str] = Field(None, description="供应商说明")
    enabled: bool = Field(True, description="供应商是否启用")
    base_url: Optional[str] = Field(None, description="覆盖后的基础地址")
    credential_fields: List[str] = Field(default_factory=list, description="该供应商需要的凭据字段名")
    configured_fields: List[str] = Field(default_factory=list, description="当前已配置的凭据字段名")
    has_credentials: bool = Field(False, description="是否至少配置了一项凭据")
    settings_json: Dict[str, Any] = Field(default_factory=dict, description="公开的非敏感运行时设置")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class ModelCatalogEntry(BaseModel):
    """平台可管理的模型目录项。"""

    model_id: str = Field(..., description="模型唯一键")
    task_type: str = Field(..., description="适用任务类型：t2i/i2i/i2v")
    provider_key: str = Field(..., description="所属供应商")
    display_name: str = Field(..., description="模型展示名称")
    description: Optional[str] = Field(None, description="模型说明")
    enabled: bool = Field(True, description="是否允许业务前端展示并使用")
    sort_order: int = Field(100, description="排序值，越小越靠前")
    is_public: bool = Field(True, description="是否面向业务前端公开")
    capabilities_json: Dict[str, Any] = Field(default_factory=dict, description="前端渲染所需的能力描述")
    default_settings_json: Dict[str, Any] = Field(default_factory=dict, description="模型默认参数")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class AvailableModelCatalog(BaseModel):
    """面向业务前端返回的可用模型目录。"""

    t2i: List[ModelCatalogEntry] = Field(default_factory=list, description="可用文生图模型")
    i2i: List[ModelCatalogEntry] = Field(default_factory=list, description="可用图生图模型")
    i2v: List[ModelCatalogEntry] = Field(default_factory=list, description="可用图生视频模型")


class TaskConcurrencyTaskTypeOption(BaseModel):
    """可配置并发限制的任务类型选项。"""

    task_type: str = Field(..., description="任务类型编码")
    label: str = Field(..., description="任务类型展示名称")


class TaskConcurrencyLimit(BaseModel):
    """组织级任务并发限制配置。"""

    id: str = Field(..., description="并发限制记录 ID")
    organization_id: str = Field(..., description="所属组织 ID")
    task_type: str = Field(..., description="任务类型编码")
    max_concurrency: int = Field(1, description="允许同时执行的最大并发数；0 表示暂停该类型任务执行")
    created_by: Optional[str] = Field(None, description="创建人 ID")
    updated_by: Optional[str] = Field(None, description="最后修改人 ID")
    created_at: datetime = Field(default_factory=utc_now, description="创建时间")
    updated_at: datetime = Field(default_factory=utc_now, description="更新时间")


class TaskConcurrencyLimitSummary(TaskConcurrencyLimit):
    """带组织名称的并发限制视图。"""

    organization_name: Optional[str] = Field(None, description="组织名称")


class VerificationCode(BaseModel):
    id: str
    target_type: str
    target_value: str
    purpose: str
    code_hash: str
    expires_at: datetime
    attempt_count: int = 0
    max_attempts: int = 5
    consumed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class UserSession(BaseModel):
    id: str
    user_id: str
    current_workspace_id: Optional[str] = None
    session_token_hash: str
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Invitation(BaseModel):
    id: str
    organization_id: str
    workspace_id: str
    email: str
    role_code: str
    invited_by: Optional[str] = None
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class InvitationPreview(BaseModel):
    id: str
    email: str
    role_code: str
    role_name: Optional[str] = None
    organization_id: str
    organization_name: Optional[str] = None
    workspace_id: str
    workspace_name: Optional[str] = None
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    is_expired: bool = False


class MembershipWithRole(BaseModel):
    membership_id: str
    organization_id: Optional[str] = None
    organization_name: Optional[str] = None
    workspace_id: Optional[str] = None
    workspace_name: Optional[str] = None
    user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    role_id: Optional[str] = None
    role_code: Optional[str] = None
    role_name: Optional[str] = None
    status: str = "active"
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class WorkspaceOption(BaseModel):
    organization_id: Optional[str] = None
    organization_name: Optional[str] = None
    workspace_id: str
    workspace_name: Optional[str] = None
    role_code: Optional[str] = None
    role_name: Optional[str] = None


class AuthSessionPayload(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class AuthMeResponse(BaseModel):
    user: User
    current_workspace_id: Optional[str] = None
    current_organization_id: Optional[str] = None
    current_role_code: Optional[str] = None
    current_role_name: Optional[str] = None
    is_platform_super_admin: bool = False
    capabilities: List[str] = Field(default_factory=list)
    workspaces: List[WorkspaceOption] = Field(default_factory=list)
    memberships: List[MembershipWithRole] = Field(default_factory=list)
