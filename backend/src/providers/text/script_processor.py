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

    def get_last_metrics(self) -> Dict[str, Any] | None:
        """暴露最近一次文本模型调用采集到的 usage metrics。"""
        return self.llm.get_last_response_metrics()

    def parse_novel(self, title: str, text: str) -> Script:
        """把原始故事文本解析成项目内部结构化剧本模型。"""
        logger.info("正在解析小说：%s...", title)
        if not self.is_configured:
            logger.error("未配置文本模型访问密钥。")
            raise ValueError("LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。")

        prompt = self._construct_prompt(text)
        logger.info(
            "剧本处理器：解析小说 标题=%s 文本长度=%s",
            title,
            len(text or ""),
        )
        try:
            content = self.llm.chat(
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            logger.debug("LLM 响应内容：\n%s", content)
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
            你是一名影视前期拆解助手，只做实体提取。用户会给你输入一段完整的剧本，或者角色、场景、道具的相关描述。
            你需要通过用户输入信息提取出角色、场景和道具实体。
             
            任务要求：
            1. 只提取 `characters`（角色）、`scenes`（场景）、`props`（道具） 三类实体。
            2. 所有 `name`、`description`、`age`、`gender`、`clothing` 必须使用简体中文。
            3. 不要输出分镜，不要解释，不要补充额外字段。
            4. 角色描述只保留稳定外观特征，不要写临时动作或情绪。
            5. 同一角色如果服装变化特别大，可拆成变体角色，例如“叶墨（古装）”。
            6. `visual_weight` 使用 1-5 的整数，主角/核心场景可更高。
            7. 同一角色的不同称呼必须合并为同一个人物：
               - 包括姓名、职称、关系称呼、代称
               - 需要判断是否为同一人，并统一为一个角色
               - name 使用“最明确的称呼”（优先姓名，其次固定称呼）
               - description 中可以补充“别称/身份”，但不要创建新角色
            8. 如果两个称呼可能指同一人，优先合并，不要拆分，除非文本明确说明是不同人物。 
            9. 角色命名规则：
               - 有姓名：使用姓名
               - 无姓名但有稳定称呼：使用最具体称呼
               - 避免使用关系型称呼作为主名
            
            
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
        logger.info("正在分析剧本以生成视觉风格建议...")
        if not self.is_configured:
            logger.warning("平台设置未配置文本模型供应商，返回默认建议。")
            return self._mock_style_recommendations()

        system_prompt = """你是一个专业的电影美术指导和视觉风格顾问。
            请根据提供的剧本内容，分析其题材、情绪和氛围，推荐4种截然不同但都适合的视觉风格。
            
            对于每种风格，请提供：
            1. 风格名称（简洁、专业，使用中文）
            2. 风格描述（1-2句话，用中文）
            3. 推荐理由（为什么这个风格适合这个剧本，用中文，50字以内）
            4. Stable Diffusion 正向提示词（详细的风格关键词，中文，逗号分隔，不超过50个词）
            5. Stable Diffusion 负向提示词（避免的视觉元素，中文，逗号分隔，不超过30个词）
            
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
            logger.debug("风格分析响应：\n%s", content)
            content = _strip_markdown_json(content)
            if len(content) > 5000:
                logger.warning("风格分析响应较长（%s 字符），跳过预截断并解析完整内容", len(content))

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
                logger.error("JSON 解析错误：%s", exc)
                logger.error("原始内容长度：%s", len(content))
                try:
                    json_match = re.search(r"\{[\s\S]*\}", content)
                    if json_match:
                        content = json_match.group(0)
                    content = repair_json(content)
                    data = json.loads(content)
                except Exception as inner_exc:
                    logger.error("JSON 恢复失败：%s", inner_exc)
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
            logger.error("分析剧本风格时出错：%s", exc, exc_info=True)
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
        logger.info("正在将文本分析为分镜：%s...", text[:100])
        if not self.is_configured:
            logger.warning("平台设置未配置文本模型供应商，返回模拟分镜帧。")
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
            你是一名电影级分镜师（Storyboard Artist）和导演助手。你的任务是将用户输入的剧本文本，拆解为适合 AI 图片/视频模型生成的细粒度分镜帧。
            
            # 任务目标
            你需要把剧本中的叙事内容，转化为一组连续、清晰、可直接视觉生成的分镜画面。
            目标是：**忠实拆解、视觉明确、节奏连贯、便于生成**，而不是自由改编或文学润色。
            
            # 输入适配原则
            用户输入的剧本结构可能并不统一，可能包含但不限于：
            - 集标题、章节标题、场景列表
            - 镜头编号、段落编号、自然段叙事
            - 动作描写、环境描写、对白、心理活动、旁白、音效
            - 已经存在的镜头景别信息，也可能完全没有镜头信息
            你不能假设输入一定遵循某一种固定格式。
            你必须直接根据文本语义理解剧情，并完成分镜拆解。
            
            # 已提取的实体上下文
            {entities_str}
            
            # 核心规则（必须严格遵守）
            1. **忠实拆解，不改写剧情**
               - 严格依据用户提供的文本拆解分镜。
               - 不要补充剧本中没有明确出现的新动作、新道具、新人物关系、新情节。
               - 不要为了“画面更丰富”而随意添加多余细节。
            
            2. **视觉原子化**
               - 每个分镜帧只保留一个主要视觉动作核心。
               - 如果一个句子或一个段落中包含多个连续动作，必须拆成多个分镜帧。
               - 例如：“走近大门 + 推门 + 开口说话” 应拆成至少 2-3 个分镜，而不是塞进同一帧。
               - 每帧应控制在 3-5 秒内能够清晰成立。
            
            3. **动作描述必须可被镜头直接看到**
               - `action_description` 只写镜头中可直接看到的内容。
               - 包括：人物动作、姿态变化、与动作直接相关的表情、道具状态变化、环境中的可见动态。
               - 不要把推测、分析、抽象概念写进动作描述。
               
            4. **禁止无依据脑补细节**
               - 不要添加原文未明确写出的细节，如：
                 - 衣摆翻飞
                 - 长发飘动
                 - 手指颤抖
                 - 眼神闪烁
                 - 身形灵巧
                 - 嘴角轻扬
               - 除非原文明确写出，或该细节是动作成立所必需。

            5. **对白与动作分离**
               - `dialogue` 只写台词内容，不要把动作混进去。
               - `speaker` 只写说话者。
               - 如果是内心独白、画外音、群杂议论，也要保留原文语义，不要伪装成角色正在张口说话。
               - 若没有明确说话者，可根据上下文判断；若仍不明确，可使用最合理的群体称呼，如“百姓”“捕快”。
            
            6. **角色可见性原则**
               - `character_ref_names` 只列出当前画面中实际可见的角色。
               - 仅被提及、但未出现在画面中的角色，不要列入。
               
            7. **实体强约束**
               - `scene_ref_name`、`character_ref_names`、`prop_ref_names` 必须严格使用已提取实体中的标准名称。
               - 若文本里出现别称、关系称呼、职称、代称，必须自动对齐到实体标准名。
               - 不允许输出未在实体表中的新名称，除非确实无法对齐且文本明确出现了新的独立实体。
            
            8. **同一人物称呼合并**
               - 同一人物在不同称呼下必须识别为同一个角色。
               - 例如：姓名、职称、关系称呼、代称，如果上下文明确指向同一人，必须统一映射到同一个角色实体。
               - 不要因为称呼不同就拆成多个角色。
            
            9. **镜头粒度保持一致**
               - 整个输出中的拆分粒度要前后一致。
               - 不能有的分镜非常粗，有的又极细。
               - 优先按“单一动作 + 单一视觉重点”拆分。
            
            10. **已有镜头信息可参考，但不受限**
               - 如果原文已经给出了“全景/中景/特写/远景”等镜头信息，可以优先参考。
               - 但如果原镜头内部包含多个独立动作，仍然必须继续细拆。
               - 不能机械地一个“原镜头编号”只输出一个分镜帧。
            
            11. **景别、机位、运镜要服务叙事**
               - `shot_size`、`camera_angle`、`camera_movement` 要根据画面内容合理选择。
               - 优先使用清晰、稳定、适合生成的镜头语言。
               - 避免无意义、过度炫技的运镜。
            
            12. **古风题材约束**
               - 所有视觉表达必须符合古风正典美学与古代叙事语境。
               - 禁止现代元素、现代执法表达、现代道具、现代建筑、现代台词氛围。
               - 如果文本中存在偏现代的概括性表达，要自动转译为符合古风语境的可视画面。
               - 例如“警戒线”应理解为“麻绳围挡、捕快把守、木桩圈界”等古代视觉表达，而不是现代警戒带。
            
            13. **氛围必须克制**
               - 本项目整体风格为：古风正典、沉雅克制、悬疑但不惊悚。
               - 不要把案件画面处理成血腥恐怖风。
               - 要突出线索、秩序、人物关系与情绪张力，而不是猎奇感。
            
            14. **覆盖完整剧情**
               - 必须覆盖用户文本中的所有关键剧情节点。
               - 不得遗漏关键动作、关键道具、关键人物出场、关键对视、关键线索。


                        
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
            logger.debug("分镜分析原始响应：%s...", content[:500])
            frames = self._parse_storyboard_json(content)
            if frames is not None:
                return frames
            logger.warning("分镜结构化解析失败，改用结构化响应模式重试...")
            retry_content = self.llm.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": "请开始生成分镜帧列表，确保覆盖剧本中的所有内容。请务必输出合法的JSON格式。"},
                ],
                response_format={"type": "json_object"},
            ).strip()
            logger.debug("分镜分析重试响应：%s...", retry_content[:500])
            frames = self._parse_storyboard_json(retry_content)
            if frames is not None:
                return frames
            raise RuntimeError("AI 模型输出的 JSON 格式不合规，自动重试后仍然失败。请重新点击生成按钮再试一次。")
        except RuntimeError:
            raise
        except Exception as exc:
            logger.error("分镜分析出错：%s", exc, exc_info=True)
            raise RuntimeError(f"分镜分析过程出错: {str(exc)}")

    def _parse_storyboard_json(self, content: str):
        """解析分镜 JSON，并兼容常见代码块包裹格式。"""
        content = _strip_markdown_json(content)
        try:
            result = json.loads(content.strip())
            frames = result.get("frames", [])
            if not frames:
                logger.warning("结构化解析成功但分镜帧数组为空")
                return None
            logger.info("分镜分析生成 %s 帧", len(frames))
            return frames
        except json.JSONDecodeError as exc:
            logger.error("解析分镜分析 JSON 失败：%s", exc)
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
                logger.warning("文本模型响应缺少中英文提示词字段")
                return fallback_result
            except json.JSONDecodeError as exc:
                logger.error("解析润色响应 JSON 失败：%s", exc)
                return fallback_result
        except Exception as exc:
            logger.error("润色提示词时出错：%s", exc, exc_info=True)
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
                logger.warning("视频润色结果缺少中英双语字段")
                return fallback
            except json.JSONDecodeError as exc:
                logger.error("解析视频润色 JSON 失败：%s", exc)
                return fallback
        except Exception:
            logger.exception("润色视频提示词失败")
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
                logger.warning("图生视频润色结果缺少中英双语字段")
                return fallback
            except json.JSONDecodeError as exc:
                logger.error("解析图生视频润色 JSON 失败：%s", exc)
                return fallback
        except Exception:
            logger.exception("润色图生视频提示词失败")
            return fallback
