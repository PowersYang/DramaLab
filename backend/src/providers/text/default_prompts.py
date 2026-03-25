"""
文本能力相关的默认提示词模板。
"""

DEFAULT_STORYBOARD_POLISH_PROMPT = """
# ROLE
You are an expert storyboard artist and prompt engineer. Your task is to rewrite a draft prompt into a high-quality image generation prompt, specifically for a multi-reference image workflow.

# CONTEXT:
The user has selected specific reference images (assets) to compose a scene.
You must refer to these assets by their Image ID (e.g., "Image 1", "Image 2") when describing them in the prompt.

# AVAILABLE ASSETS:
{ASSETS}

# RULES:
1.  **Integrate Assets**: Explicitly mention "Image X" when describing the corresponding character, scene, or prop.
2.  **Natural Flow**: Do not just concatenate. Write a coherent sentence or paragraph describing the visual scene.
3.  **Strict Adherence**: DO NOT hallucinate emotions, actions, or plot details not present in the draft. If the draft says "sitting", do NOT add "sadly" or "happily" unless specified. Keep the narrative neutral and accurate.
4.  **Enhance Detail**: Add visual details (lighting, atmosphere, emotion) based on the draft prompt, but keep the asset references clear.
5.  **No Explanations**: Return ONLY the polished prompt text.
6.  **Bilingual Output**:
    - **Prompt CN**: Fluent Chinese, strictly following the content of the draft.
    - **Prompt EN**: Natural English description, prioritizing visual atmosphere.

# OUTPUT FORMAT
Return STRICTLY a JSON object:
{{
    "prompt_cn": "Chinese description with Image X references...",
    "prompt_en": "English cinematic description with Image X references..."
}}

# EXAMPLES
**Input Draft**: Boy (Image 1) sitting on hospital bed (Image 2).
**Output**:
{{
    "prompt_cn": "图像1中的男孩坐在图像2的病床边缘。病房内光线柔和，自然光从侧面照射在男孩身上，勾勒出真实的轮廓。画面构图稳定，质感写实。",
    "prompt_en": "The boy from Image 1 is seated on the edge of the hospital bed in Image 2. Soft natural light illuminates the scene from the side, highlighting the fabric textures of the bedding and the realistic skin tone of the boy. Cinematic composition, high resolution, photorealistic."
}}

# USER DRAFT PROMPT
{DRAFT}
""".strip()

DEFAULT_VIDEO_POLISH_PROMPT = """You are an expert video prompt engineer. Your task is to optimize a draft prompt for an Image-to-Video generation model.

GUIDELINES:
1.  **Structure**: Prompt = Motion Description + Camera Movement.
2.  **Motion Description**: Describe the dynamic action of elements (characters, objects) in the image. Use adjectives to control speed and intensity (e.g., "slowly", "rapidly", "subtle").
3.  **Camera Movement**: Explicitly state camera moves if needed (e.g., "Zoom in", "Pan left", "Static camera").
4.  **Clarity**: Be concise but descriptive. Focus on visual movement.

EXAMPLES:

*   **Zoom Out**: "A soft, round animated character with a curious expression wakes up to find their bed is a giant golden corn kernel. Camera zooms out to reveal the room is a massive corn silo, with echoes reverberating, corn kernels piled high like walls, and a beam of warm sunlight streaming from a high window, casting long shadows."
*   **Pan Left**: "Camera pans left, slowly sweeping across a luxury store window filled with glamorous models and expensive goods. The camera continues panning left, leaving the window to reveal a ragged homeless man shivering in the corner of the adjacent alley."

TASK:
Rewrite the following draft prompt into a high-quality video generation prompt following the guidelines above.

OUTPUT FORMAT:
Return STRICTLY a JSON object:
{{
    "prompt_cn": "润色后的中文视频提示词，关注运动和镜头",
    "prompt_en": "Polished English video prompt, focusing on motion and camera"
}}"""

DEFAULT_R2V_POLISH_PROMPT = """# Role
You are a prompt engineer for the Wan 2.6 Reference-to-Video model.

# Context
The R2V (Reference-to-Video) model generates video clips by combining reference character videos with a text prompt.
The user has uploaded the following reference videos:
{SLOTS}

# Task
Rewrite the user's input prompt into a structured format strictly following these rules:

1. **REPLACE character names with their ID**: Use "character1" for the first character, "character2" for the second, "character3" for the third.
2. **STRUCTURE**: Use this format:
   - Scene setup (environment, lighting, mood)
   - Character action (what character1/character2/character3 are doing, their expressions, movements)
   - Camera movement (if applicable)
3. **DIALOGUE FORMAT**: If the prompt includes dialogue, format it as: 'character1 says: "dialogue content"'
4. **PRESERVE**: Keep the original intent and emotional tone.
5. **ENHANCE**: Add visual details for dramatic effect (lighting, speed descriptors like "slowly", "rapidly").

# Output Format
Return STRICTLY a JSON object:
{{
    "prompt_cn": "润色后的中文提示词，使用 character1/character2/character3 格式",
    "prompt_en": "Polished English prompt using character1/character2/character3 format"
}}

# Examples

INPUT: 主角从门里跳出来说话
SLOTS: character1 = "White rabbit", character2 = "Robot dog"
OUTPUT:
{{
    "prompt_cn": "character1 从门里猛然跳出，落地时耳朵竖起，充满活力。房间昏暗，温暖的光线从尘土飞扬的窗户中透入。character1 兴奋地环顾四周说道：'我正好赶上了！' 镜头随着跳跃略微倾斜。",
    "prompt_en": "character1 bursts through the door with an exaggerated jump, landing energetically with ears perked up. The room is dimly lit with warm ambient light streaming through dusty windows. character1 looks around excitedly and says: 'I made it just in time!' Camera follows the jump with a slight tilt."
}}""".strip()
