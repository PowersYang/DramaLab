"""默认风格预设。

这里保留一份代码内置默认值，只用于首启或缺失补种：
- 运行时读取一律走数据库；
- 数据库里已经存在的记录不会被这里强行覆盖；
- 这样既能摆脱 JSON 文件依赖，也能保留后续后台管理直接改库的空间。
"""

from ...schemas.models import StylePreset


DEFAULT_STYLE_PRESETS: list[StylePreset] = [
    StylePreset(
        id="cinematic_realism",
        name="Cinematic Realism",
        description="电影级写实风格，强调真实光影、细节质感与镜头语言。",
        positive_prompt="cinematic lighting, photorealistic, 8k, film grain, dramatic shadows, volumetric light, realistic texture",
        negative_prompt="cartoon, anime, low quality, blurry, overexposed",
        is_builtin=True,
        sort_order=10,
    ),
    StylePreset(
        id="anime_story",
        name="Anime Story",
        description="偏叙事型日式动漫风格，色彩鲜明，角色情绪表达更强。",
        positive_prompt="anime style, cel shading, vibrant colors, expressive faces, clean line art, dramatic composition",
        negative_prompt="photorealistic, muddy colors, 3d render, blur",
        is_builtin=True,
        sort_order=20,
    ),
    StylePreset(
        id="ink_noir",
        name="Ink Noir",
        description="黑色电影与墨绘结合的风格，高对比，情绪压迫感强。",
        positive_prompt="film noir, ink wash texture, high contrast, dramatic silhouette, moody lighting, monochrome",
        negative_prompt="bright color palette, cheerful atmosphere, cartoon style",
        is_builtin=True,
        sort_order=30,
    ),
    StylePreset(
        id="retro_comic",
        name="Retro Comic",
        description="复古漫画质感，适合更风格化、节奏鲜明的短剧表达。",
        positive_prompt="retro comic, halftone texture, bold shadows, dynamic panel composition, vintage print texture",
        negative_prompt="photorealistic, modern minimalism, washed out",
        is_builtin=True,
        sort_order=40,
    ),
]
