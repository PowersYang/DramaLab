"""服务于剧本流程的文本生成与解析 provider。"""

import json
import re
import time
import uuid
from typing import Any, Dict, List

from ...schemas.models import Character, GenerationStatus, Prop, Scene, Script, StoryboardFrame

from ...utils import get_logger
from ...utils.datetime import utc_now
from ...settings.env_settings import get_env
from .default_prompts import (
    DEFAULT_R2V_POLISH_PROMPT,
    DEFAULT_STORYBOARD_POLISH_PROMPT,
    DEFAULT_VIDEO_POLISH_PROMPT,
)
from .llm_adapter import LLMAdapter


def _strip_markdown_json(content: str) -> str:
    """去掉 LLM 返回内容外层可能带的 Markdown 代码块标记。"""
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0]
    elif "```" in content:
        content = content.split("```")[1].split("```")[0]
    return content.strip()


logger = get_logger(__name__)


class ScriptProcessor:
    """负责解析、分析与提示词润色的高层文本 provider。"""

    def __init__(self, api_key: str = None):
        self._api_key = api_key
        self.llm = LLMAdapter()

    @property
    def is_configured(self):
        """暴露底层 LLM 适配器是否已完成配置。"""
        return self.llm.is_configured

    def parse_novel(self, title: str, text: str) -> Script:
        """把原始故事文本解析成项目内部结构化剧本模型。"""
        logger.info("Parsing novel: %s...", title)
        if not self.is_configured:
            logger.error("LLM API key not configured.")
            raise ValueError("LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。")

        prompt = self._construct_prompt(text)
        logger.info(
            "SCRIPT_PROCESSOR: parse_novel title=%s text_length=%s",
            title,
            len(text or ""),
        )
        try:
            content = self.llm.chat(
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            logger.debug("LLM Response Content:\n%s", content)
            content = _strip_markdown_json(content)
            data = json.loads(content)
            return self._create_script_from_data(title, text, data)
        except json.JSONDecodeError as exc:
            error_msg = f"LLM 返回的数据格式错误，无法解析 JSON: {exc}"
            logger.error(error_msg, exc_info=True)
            raise RuntimeError(error_msg)
        except ValueError:
            raise
        except Exception as exc:
            error_msg = f"剧本解析失败: {str(exc)}"
            logger.error(error_msg, exc_info=True)
            raise RuntimeError(error_msg)

    def _create_script_from_data(self, title: str, original_text: str, data: Dict[str, Any]) -> Script:
        """把 LLM 解析结果转换成内部剧本聚合对象。"""
        script_id = str(uuid.uuid4())
        characters = []
        name_to_char = {}
        llm_id_to_uuid = {}

        for char_data in data.get("characters", []):
            char_uuid = str(uuid.uuid4())
            llm_id = char_data.get("id")
            if llm_id:
                llm_id_to_uuid[llm_id] = char_uuid
            char = Character(
                id=char_uuid,
                name=char_data.get("name", "Unknown"),
                description=char_data.get("description", ""),
                age=char_data.get("age"),
                gender=char_data.get("gender"),
                clothing=char_data.get("clothing"),
                visual_weight=char_data.get("visual_weight", 3),
                status=GenerationStatus.PENDING,
            )
            characters.append(char)
            name_to_char[char.name] = char

        for char in characters:
            if "(" in char.name and ")" in char.name:
                base_name = char.name.split("(")[0].strip()
                if base_name in name_to_char and name_to_char[base_name].id != char.id:
                    char.base_character_id = name_to_char[base_name].id

        scenes = []
        for scene_data in data.get("scenes", []):
            scene_uuid = str(uuid.uuid4())
            llm_id = scene_data.get("id")
            if llm_id:
                llm_id_to_uuid[llm_id] = scene_uuid
            scenes.append(
                Scene(
                    id=scene_uuid,
                    name=scene_data.get("name", "Unknown"),
                    description=scene_data.get("description", ""),
                    time_of_day=scene_data.get("time_of_day"),
                    lighting_mood=scene_data.get("lighting_mood"),
                    visual_weight=scene_data.get("visual_weight", 3),
                    status=GenerationStatus.PENDING,
                )
            )

        props = []
        for prop_data in data.get("props", []):
            prop_uuid = str(uuid.uuid4())
            llm_id = prop_data.get("id")
            if llm_id:
                llm_id_to_uuid[llm_id] = prop_uuid
            props.append(
                Prop(
                    id=prop_uuid,
                    name=prop_data.get("name", "Unknown"),
                    description=prop_data.get("description", ""),
                    status=GenerationStatus.PENDING,
                )
            )

        frames = []
        for frame_data in data.get("frames", []):
            char_ids = [llm_id_to_uuid[cid] for cid in frame_data.get("character_ids", []) if cid in llm_id_to_uuid]
            prop_ids = [llm_id_to_uuid[pid] for pid in frame_data.get("prop_ids", []) if pid in llm_id_to_uuid]
            scene_llm_id = frame_data.get("scene_id")
            scene_id = llm_id_to_uuid.get(scene_llm_id)
            if not scene_id and scenes:
                scene_id = scenes[0].id
            elif not scene_id:
                scene_id = str(uuid.uuid4())

            dialogue_data = frame_data.get("dialogue")
            dialogue_text = None
            speaker_name = None
            if isinstance(dialogue_data, dict):
                dialogue_text = dialogue_data.get("text")
                speaker_name = dialogue_data.get("speaker")
            elif isinstance(dialogue_data, str):
                dialogue_text = dialogue_data

            frames.append(
                StoryboardFrame(
                    id=str(uuid.uuid4()),
                    scene_id=scene_id,
                    character_ids=char_ids,
                    prop_ids=prop_ids,
                    action_description=frame_data.get("action_description", ""),
                    facial_expression=frame_data.get("facial_expression"),
                    dialogue=dialogue_text,
                    speaker=speaker_name,
                    camera_angle=frame_data.get("camera_angle", "Medium Shot"),
                    camera_movement=frame_data.get("camera_movement"),
                    composition=frame_data.get("composition"),
                    atmosphere=frame_data.get("atmosphere"),
                    image_prompt=f"{frame_data.get('action_description')} {frame_data.get('facial_expression', '')} {frame_data.get('camera_angle')} {frame_data.get('lighting_mood', '')} {frame_data.get('atmosphere', '')}",
                    status=GenerationStatus.PENDING,
                )
            )

        return Script(
            id=script_id,
            title=title,
            original_text=original_text,
            characters=characters,
            scenes=scenes,
            props=props,
            frames=frames,
            created_at=utc_now(),
            updated_at=utc_now(),
        )

    def create_draft_script(self, title: str, text: str) -> Script:
        """在不执行完整分析的情况下创建最小草稿剧本。"""
        return Script(
            id=str(uuid.uuid4()),
            title=title,
            original_text=text,
            characters=[],
            scenes=[],
            props=[],
            frames=[],
            created_at=utc_now(),
            updated_at=utc_now(),
        )

    def split_into_episodes(self, text: str, suggested_episodes: int = 3) -> List[Dict[str, Any]]:
        """把长文本切分成候选分集片段。"""
        if not self.is_configured:
            raise ValueError("LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。")

        max_text_length = 80000
        if len(text) > max_text_length:
            text = text[:max_text_length] + "\n\n[文本已截断，请基于已有内容进行划分]"

        prompt = f"""你是一名专业的剧本编剧和分集策划师。

请将以下小说/剧本文本按叙事节奏划分为约 {suggested_episodes} 集。

划分原则：
1. 每集应有完整的叙事弧（开端/发展/高潮或悬念）
2. 在自然的情节转折点或场景切换处分集
3. 各集内容量大致均衡，但优先保证叙事完整性
4. 实际集数可以在建议集数 ±2 范围内浮动

输出纯 JSON（不要 markdown 代码块）:
{{
  "episodes": [
    {{
      "episode_number": 1,
      "title": "集标题",
      "summary": "50字以内的内容摘要",
      "start_marker": "该集起始的原文前20字",
      "end_marker": "该集结束的原文后20字",
      "estimated_duration": "预估时长（分钟）"
    }}
  ]
}}

原文如下：

{text}"""

        try:
            content = self.llm.chat(messages=[{"role": "user", "content": prompt}])
            content = _strip_markdown_json(content)
            data = json.loads(content)
            episodes = data.get("episodes", [])
            if not episodes:
                raise RuntimeError("LLM 未返回任何分集数据")
            return episodes
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"LLM 返回的分集数据格式错误: {exc}")
        except ValueError:
            raise
        except Exception as exc:
            raise RuntimeError(f"分集划分失败: {str(exc)}")

    def _construct_prompt(self, text: str) -> str:
        """构造发送给 LLM 的解析提示词。"""
        return f"""
你是一名影视前期拆解助手，只做实体提取。

任务要求：
1. 只提取 `characters`、`scenes`、`props` 三类实体。
2. 所有 `name`、`description`、`age`、`gender`、`clothing` 必须使用简体中文。
3. 不要输出分镜，不要解释，不要补充额外字段。
4. 角色描述只保留稳定外观特征，不要写临时动作或情绪。
5. 同一角色如果服装变化特别大，可拆成变体角色，例如“叶墨（古装）”。
6. `visual_weight` 使用 1-5 的整数，主角/核心场景可更高。

返回 JSON 结构：
{{
  "characters": [
    {{
      "id": "char_001",
      "name": "角色名",
      "description": "稳定外观描述",
      "age": "年龄估计",
      "gender": "性别",
      "clothing": "默认服装描述",
      "visual_weight": 5
    }}
  ],
  "scenes": [
    {{
      "id": "scene_001",
      "name": "场景名",
      "description": "场景视觉描述",
      "visual_weight": 3
    }}
  ],
  "props": [
    {{
      "id": "prop_001",
      "name": "道具名",
      "description": "道具视觉描述"
    }}
  ]
}}

待分析文本：
{text}
"""

    def analyze_script_for_styles(self, script_text: str) -> List[Dict[str, Any]]:
        """为剧本推荐可选视觉风格。"""
        logger.info("Analyzing script for visual style recommendations...")
        if not self.is_configured:
            logger.warning("DASHSCOPE_API_KEY not set. Returning default recommendations.")
            return self._mock_style_recommendations()

        system_prompt = """你是一个专业的电影美术指导和视觉风格顾问。
请根据提供的剧本内容，分析其题材、情绪和氛围，推荐4种截然不同但都适合的视觉风格。

对于每种风格，请提供：
1. 风格名称（简洁、专业，使用英文）
2. 风格描述（1-2句话，用中文）
3. 推荐理由（为什么这个风格适合这个剧本，用中文，50字以内）
4. Stable Diffusion 正向提示词（详细的风格关键词，英文，逗号分隔，不超过50个词）
5. Stable Diffusion 负向提示词（避免的视觉元素，英文，逗号分隔，不超过30个词）

IMPORTANT: 
- 你的回复必须是严格的JSON格式。
- 不要包含任何解释性文字。
- 所有文本中的引号必须使用转义符号 (例如 \")。
- 确保JSON完整，不要被截断。
- 保持内容精炼，避免过长的描述。
- 严禁重复生成相同的内容，不要陷入循环。
- 只返回4个推荐风格，不要多也不要少。

CRITICAL STYLE GUIDELINES:
- 正向提示词必须只描述：光影、色调、材质、艺术媒介、氛围、镜头语言 (e.g., "cinematic lighting, film grain, watercolor texture, dark atmosphere").
- 严禁描述具体实体：不要包含人物、服装、具体物品、环境细节 (e.g., 禁止 "cracked helmet", "blood stains", "monster", "forest", "sword").
- 风格必须是通用的，能套用到任何角色或场景上，而不会改变其原本的物理结构。

返回格式：
{
  "recommendations": [
    {
      "name": "风格名称",
      "description": "风格描述",
      "reason": "推荐理由",
      "positive_prompt": "正向提示词",
      "negative_prompt": "负向提示词"
    }
  ]
}"""
        user_prompt = f"剧本内容：\n\n{script_text[:2000]}"
        try:
            content = self.llm.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
            )
            logger.debug("Style Analysis Response:\n%s", content)
            content = _strip_markdown_json(content)
            # 中文注释：4 组风格 JSON 很容易超过 5000 字符；此前这里先截断再解析，会直接把最后 1 条推荐切掉。
            # 这里改成只记录日志、不做预截断，优先完整解析原始 JSON，再走后续标准化补齐逻辑。
            if len(content) > 5000:
                logger.warning("Style analysis response is long (%s chars), skip pre-truncation and parse full payload", len(content))

            def repair_json(json_str):
                json_str = json_str.strip()
                if not json_str.endswith("}"):
                    open_braces = json_str.count("{") - json_str.count("}")
                    open_brackets = json_str.count("[") - json_str.count("]")
                    open_quotes = json_str.count('"') % 2
                    if open_quotes:
                        json_str += '"'
                    json_str += "]" * open_brackets
                    json_str += "}" * open_braces
                if json_str.count("{") > json_str.count("}"):
                    json_str += "}" * (json_str.count("{") - json_str.count("}"))
                return json_str

            try:
                data = json.loads(content)
            except json.JSONDecodeError as exc:
                logger.error("JSON parsing error: %s", exc)
                logger.error("Raw content length: %s", len(content))
                try:
                    json_match = re.search(r"\{[\s\S]*\}", content)
                    if json_match:
                        content = json_match.group(0)
                    content = repair_json(content)
                    data = json.loads(content)
                except Exception as inner_exc:
                    logger.error("Failed to recover JSON: %s", inner_exc)
                    try:
                        recommendations = []
                        style_matches = re.finditer(r'\{\s*"name":\s*"(.*?)",\s*"description":\s*"(.*?)".*?\}', content, re.DOTALL)
                        if not list(style_matches):
                            pass
                        if not recommendations and "recommendations" in content:
                            fixed_content = content + "}]}"
                            try:
                                data = json.loads(fixed_content)
                                recommendations = data.get("recommendations", [])
                            except Exception:
                                pass
                        if not recommendations:
                            raise ValueError("Regex extraction failed")
                    except Exception:
                        return self._mock_style_recommendations()

            recommendations = data.get("recommendations", [])
            # 把返回数量标准化到 4 个，避免模型偶发少返或多返导致前端展示不稳定。
            recommendations = self._normalize_style_recommendations(recommendations)
            for index, recommendation in enumerate(recommendations):
                recommendation["id"] = f"ai-rec-{index + 1}-{str(uuid.uuid4())[:8]}"
                recommendation["is_custom"] = False
            return recommendations
        except Exception as exc:
            logger.error("Error analyzing script for styles: %s", exc, exc_info=True)
            return self._mock_style_recommendations()

    def _normalize_style_recommendations(self, recommendations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """把推荐列表裁剪/补足为 4 个，保证前端布局和交互恒定。"""
        normalized: List[Dict[str, Any]] = []
        for recommendation in recommendations:
            if not isinstance(recommendation, dict):
                continue
            normalized.append(recommendation)
            if len(normalized) == 4:
                break

        if len(normalized) >= 4:
            return normalized

        fallback_styles = self._mock_style_recommendations()
        existing_names = {str(item.get("name", "")).strip().lower() for item in normalized}
        for fallback in fallback_styles:
            fallback_name = str(fallback.get("name", "")).strip().lower()
            if fallback_name in existing_names:
                continue
            normalized.append(
                {
                    "name": fallback.get("name", ""),
                    "description": fallback.get("description", ""),
                    "reason": fallback.get("reason", ""),
                    "positive_prompt": fallback.get("positive_prompt", ""),
                    "negative_prompt": fallback.get("negative_prompt", ""),
                }
            )
            existing_names.add(fallback_name)
            if len(normalized) == 4:
                break

        return normalized

    def _mock_style_recommendations(self) -> List[Dict[str, Any]]:
        """在 LLM 分析不可用时返回兜底风格推荐。"""
        return [
            {
                "id": f"mock-cinematic-{str(uuid.uuid4())[:8]}",
                "name": "Cinematic Realism",
                "description": "电影级写实风格，专业打光",
                "reason": "适合大多数叙事性内容，提供专业的视觉质感",
                "positive_prompt": "cinematic, photorealistic, 8k, volumetric lighting, film grain, dramatic lighting",
                "negative_prompt": "cartoon, anime, low quality, blurry",
                "is_custom": False,
            },
            {
                "id": f"mock-anime-{str(uuid.uuid4())[:8]}",
                "name": "Anime Style",
                "description": "日式动漫风格，明快色彩",
                "reason": "适合充满情感表现的故事",
                "positive_prompt": "anime style, cel shading, vibrant colors, expressive, detailed character design",
                "negative_prompt": "photorealistic, 3d, blurry, washed out",
                "is_custom": False,
            },
            {
                "id": f"mock-noir-{str(uuid.uuid4())[:8]}",
                "name": "Film Noir",
                "description": "黑色电影风格，高对比度",
                "reason": "适合悬疑、神秘题材的叙事",
                "positive_prompt": "black and white, film noir, high contrast, dramatic shadows, moody lighting",
                "negative_prompt": "colorful, bright, happy, modern",
                "is_custom": False,
            },
            {
                "id": f"mock-painterly-{str(uuid.uuid4())[:8]}",
                "name": "Painterly Drama",
                "description": "绘画感电影风格，强调笔触肌理与情绪色彩",
                "reason": "适合情绪浓烈或带有作者表达的故事氛围",
                "positive_prompt": "painterly texture, cinematic composition, rich color contrast, expressive brushwork, atmospheric lighting, fine art look",
                "negative_prompt": "flat lighting, low detail, messy composition, oversaturated, cheap cg",
                "is_custom": False,
            },
        ]

    def analyze_to_storyboard(self, text: str, entities_json: Dict[str, Any]) -> List[Dict[str, Any]]:
        """把剧本文本和实体上下文转换成分镜帧规划。"""
        logger.info("Analyzing text to storyboard: %s...", text[:100])
        if not self.is_configured:
            logger.warning("DASHSCOPE_API_KEY not set. Returning mock frames.")
            return self._mock_storyboard_frames(text)

        characters_list = entities_json.get("characters", [])
        scenes_list = entities_json.get("scenes", [])
        props_list = entities_json.get("props", [])
        entities_str = f"""
Characters:
{json.dumps(characters_list, ensure_ascii=False, indent=2)}

Scenes:
{json.dumps(scenes_list, ensure_ascii=False, indent=2)}

Props:
{json.dumps(props_list, ensure_ascii=False, indent=2)}
"""
        system_prompt = f"""
# 角色
你是一名电影级的分镜师（Storyboard Artist）和导演。你的任务是将剧本文本拆解为可供 AI 视频模型生成的一系列精细分镜帧。

# 任务目标
不仅仅是提取文本，而是要进行**视觉化拆解**。你需要将剧本中的文字转化为一系列连续的、单一动作的视觉画面。

# 剧本格式说明
剧本遵循以下格式：
- **场景标题行**: `1-1 地点名称 [时间] [内/外]` 
- **人物行**: `人物： 角色名1，角色名2`
- **动作描述**: 以 `△` 开头，描述画面中发生的动作
- **对话**: `角色名（情绪）： 对话内容`，或 `角色名 (V.O.)：` 表示画外音

# 已提取的实体上下文
{entities_str}

# 核心规则 (CRITICAL)
1. **视觉节拍拆解 (VISUAL ATOMIZATION)**:
   - 如果一行动作描述包含多个连续动作，**必须**将其拆分为多个分镜帧。
   - 每个分镜只应包含一个清晰的主要动作，时长控制在 3-5 秒。
2. **合并动作描述 (MERGE ACTION)**:
   - **`action_description` 字段必须包含画面中发生的所有动态要素**。
   - 包括：人物的神态/微表情 + 肢体动作 + 道具的物理运动（如手机震动、烟雾缭绕）。
   - 不要遗漏非人物主体的动作（如“车门打开”、“杯子摔碎”）。
3. **角色可见性**:
   - `character_ref_names` 只列出**当前分镜画面中可见**的角色。
4. **实体约束**: 
   - 场景名、角色名、道具名必须严格匹配"已提取的实体"。
5. **语言**: 所有输出必须使用简体中文。

# 输出格式
返回一个包含 `frames` 数组的 JSON 对象。不要包含 Markdown 格式标记（如 ```json）。

{{
    "frames": [
        {{
            "scene_ref_name": "卧室",
            "character_ref_names": ["叶墨"],
            "prop_ref_names": ["手机"],
            "visual_atmosphere": "昏暗的卧室，窗外透进冷色调月光",
            "action_description": "手机在床头柜上疯狂震动。叶墨眉头紧锁，烦躁地翻身，肩膀挤压枕头产生形变",
            "shot_size": "中景",
            "camera_angle": "俯视",
            "camera_movement": "静止",
            "dialogue": "妈，这才几点啊！",
            "speaker": "叶墨"
        }}
    ]
}}

# 剧本内容
{text}
"""
        try:
            content = self.llm.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "请开始生成分镜帧列表，确保覆盖剧本中的所有内容。"},
                ],
            ).strip()
            logger.debug("Storyboard Analysis Raw Response: %s...", content[:500])
            frames = self._parse_storyboard_json(content)
            if frames is not None:
                return frames
            logger.warning("Storyboard JSON parse failed, retrying with response_format=json_object...")
            retry_content = self.llm.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "请开始生成分镜帧列表，确保覆盖剧本中的所有内容。请务必输出合法的JSON格式。"},
                ],
                response_format={"type": "json_object"},
            ).strip()
            logger.debug("Storyboard Analysis Retry Response: %s...", retry_content[:500])
            frames = self._parse_storyboard_json(retry_content)
            if frames is not None:
                return frames
            raise RuntimeError("AI 模型输出的 JSON 格式不合规，自动重试后仍然失败。请重新点击生成按钮再试一次。")
        except RuntimeError:
            raise
        except Exception as exc:
            logger.error("Error in storyboard analysis: %s", exc, exc_info=True)
            raise RuntimeError(f"分镜分析过程出错: {str(exc)}")

    def _parse_storyboard_json(self, content: str):
        """解析分镜 JSON，并兼容常见代码块包裹格式。"""
        content = _strip_markdown_json(content)
        try:
            result = json.loads(content.strip())
            frames = result.get("frames", [])
            if not frames:
                logger.warning("Parsed JSON successfully but 'frames' array is empty")
                return None
            logger.info("Storyboard Analysis generated %s frames", len(frames))
            return frames
        except json.JSONDecodeError as exc:
            logger.error("Failed to parse storyboard analysis JSON: %s", exc)
            return None

    def _mock_storyboard_frames(self, text: str) -> List[Dict[str, Any]]:
        """为本地开发或异常场景提供兜底分镜帧。"""
        _ = text
        return [
            {
                "scene_ref_name": "卧室",
                "character_ref_names": ["叶墨"],
                "prop_ref_names": ["手机"],
                "visual_atmosphere": "昏暗的卧室，窗外透进冷色调月光",
                "character_acting": "叶墨眉头紧锁，眼神迷离",
                "key_action_physics": "手机在柜上剧烈震动",
                "shot_size": "中景",
                "camera_angle": "平视",
                "camera_movement": "Static",
                "dialogue": None,
                "speaker": None,
            }
        ]

    def polish_storyboard_prompt(self, draft_prompt: str, assets: List[Dict[str, Any]], feedback: str = "", custom_system_prompt: str = "") -> Dict[str, str]:
        """把分镜图片提示词润色成中英文双语结果。"""
        fallback_result = {"prompt_cn": draft_prompt, "prompt_en": draft_prompt}
        if not self.is_configured:
            return fallback_result

        asset_context = []
        for index, asset in enumerate(assets):
            asset_type = asset.get("type", "Unknown")
            name = asset.get("name", "Unknown")
            desc = asset.get("description", "")
            asset_context.append(f"Image {index + 1}: {asset_type} - {name} ({desc})")

        template = custom_system_prompt.strip() if custom_system_prompt and custom_system_prompt.strip() else DEFAULT_STORYBOARD_POLISH_PROMPT
        system_prompt = template.replace("{ASSETS}", "\n".join(asset_context)).replace("{DRAFT}", draft_prompt)
        user_content = system_prompt
        if feedback and feedback.strip():
            user_content += f"""
[用户反馈]
{feedback.strip()}

请根据用户反馈修改提示词，只修改用户指出的问题，保持其他部分不变。
"""

        try:
            content = self.llm.chat(
                messages=[{"role": "user", "content": user_content}],
                response_format={"type": "json_object"},
            ).strip()
            content = _strip_markdown_json(content)
            try:
                result = json.loads(content.strip())
                if "prompt_cn" in result and "prompt_en" in result:
                    return result
                logger.warning("LLM response missing prompt_cn or prompt_en")
                return fallback_result
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse polish response JSON: %s", exc)
                return fallback_result
        except Exception as exc:
            logger.error("Error polishing prompt: %s", exc, exc_info=True)
            return fallback_result

    def polish_video_prompt(self, draft_prompt: str, feedback: str = "", custom_system_prompt: str = "") -> Dict[str, str]:
        """把视频生成提示词润色成中英文双语结果。"""
        fallback = {"prompt_cn": draft_prompt, "prompt_en": draft_prompt}
        if not self.is_configured:
            return fallback

        system_prompt = custom_system_prompt.strip() if custom_system_prompt and custom_system_prompt.strip() else DEFAULT_VIDEO_POLISH_PROMPT
        try:
            user_message = draft_prompt
            if feedback and feedback.strip():
                user_message = f"""[当前提示词]
{draft_prompt}

[用户反馈]
{feedback.strip()}

请根据用户反馈修改提示词，只修改用户指出的问题，保持其他部分不变。"""
            content = self.llm.chat(
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
                response_format={"type": "json_object"},
            ).strip()
            content = _strip_markdown_json(content)
            try:
                result = json.loads(content.strip())
                if "prompt_cn" in result and "prompt_en" in result:
                    return result
                logger.warning("Video polish missing bilingual keys")
                return fallback
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse video polish JSON: %s", exc)
                return fallback
        except Exception:
            logger.exception("Failed to polish video prompt")
            return fallback

    def polish_r2v_prompt(self, draft_prompt: str, slots: List[Dict[str, str]], feedback: str = "", custom_system_prompt: str = "") -> Dict[str, str]:
        """结合参考槽位上下文润色图生视频提示词。"""
        fallback = {"prompt_cn": draft_prompt, "prompt_en": draft_prompt}
        if not self.is_configured:
            return fallback

        slot_context = []
        for index, slot in enumerate(slots):
            char_id = f"character{index + 1}"
            slot_context.append(f"- {char_id}: {slot['description']}")
        slot_context_str = "\n".join(slot_context) if slot_context else "No reference videos provided."

        template = custom_system_prompt.strip() if custom_system_prompt and custom_system_prompt.strip() else DEFAULT_R2V_POLISH_PROMPT
        system_prompt = template.replace("{SLOTS}", slot_context_str)
        try:
            user_message = draft_prompt
            if feedback and feedback.strip():
                user_message = f"""[当前提示词]
{draft_prompt}

[用户反馈]
{feedback.strip()}

请根据用户反馈修改提示词，只修改用户指出的问题，保持其他部分不变。"""

            content = self.llm.chat(
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}],
                response_format={"type": "json_object"},
            ).strip()
            content = _strip_markdown_json(content)
            try:
                result = json.loads(content.strip())
                if "prompt_cn" in result and "prompt_en" in result:
                    return result
                logger.warning("R2V polish missing bilingual keys")
                return fallback
            except json.JSONDecodeError as exc:
                logger.error("Failed to parse R2V polish JSON: %s", exc)
                return fallback
        except Exception:
            logger.exception("Failed to polish R2V prompt")
            return fallback
