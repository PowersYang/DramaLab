<!-- Banner Placeholder -->
<div align="center">
  <img src="docs/images/LumenX Studio Banner.jpeg" alt="LumenX Studio Banner" width="100%" />
</div>

<div align="center">

# LumenX Studio

### AI-Native Motion Comic Creation Platform
**Render Noise into Narrative**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12%2B-blue)](https://www.python.org/)
[![Node](https://img.shields.io/badge/node-18%2B-green)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/alibaba/lumenx?style=social)](https://github.com/alibaba/lumenx)

[English](README_EN.md) | [中文](README.md) | [User Manual](USER_MANUAL.md) | [Contributing](CONTRIBUTING.md)

</div>

---

LumenX Studio is an **all-in-one AI motion comic production platform**. It automatically transforms novel text into dynamic videos, streamlining the entire workflow from script analysis and character customization to storyboard composition and video synthesis.

LumenX Studio naturally integrates the full-link SOP of **Asset Extraction -> Style Definition -> Asset Generation -> Storyboard Construction -> Storyboard Generation -> Video Generation**. It incorporates industry know-how on top of comprehensive features, allowing creators to quickly produce high-quality AI short films with greatly improved efficiency.

The platform natively integrates Alibaba's Qwen & Wanx series model capabilities, dedicated to providing an intelligent, convenient, and flexible flexible creation experience, enabling creators to complete motion comic production in one stop without frequent switching between web pages or apps.

---

## 🧭 Glossary

- **Series**: A top-level container for a group of episode projects. It usually manages shared characters, scenes, props, and series-level model/prompt settings.
- **Project**: A single project, usually corresponding to one episode or one standalone creation task. It contains text, characters, scenes, props, storyboards, video tasks, and export results.
- **Asset**: A reusable visual asset such as a character, scene, or prop. Each asset usually has a description, a selected image, candidate variants, and a lock state.
- **Storyboard**: A structured shot plan created by breaking script text into frame-by-frame visual units. Each frame can reference characters, scenes, props, prompts, dialogue, and candidate images/videos.

In short: a `Series` contains multiple `Project`s, and each `Project` manages its own `Asset`s and `Storyboard`s before moving into video generation and final export.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 📝 **Deep Script Analysis** | LLM-based extraction of characters, scenes, and props to generate professional shooting scripts |
| 🎨 **Art Direction Control** | Custom visual style support (LoRA/Style Transfer) ensuring consistent art direction |
| 🎬 **Visual Storyboard** | Drag-and-drop storyboard editor for WYSIWYG composition of characters and backgrounds |
| 🎥 **Multimodal Generation** | Integration with Wanx and other models for Text-to-Image and Image-to-Video generation |
| 🎵 **Smart AV Synthesis** | Automated character dubbing (TTS), sound effects (SFX), and final video synthesis |

---

## 📸 Demo

<div align="center">
  Step 1: Script - Script Editing and Entity Extraction
  
  The script editor is located on the left side of the screen. After editing the script, click the "Extract Entities" button above to automatically extract characters, scenes, and props mentioned in the script using Qwen-Plus. You can edit and adjust these entities on the right side.
  <img src="docs/images/Script_example.jpg" alt="LumenX Studio Script" width="100%" />

  Step 2: Art Direction - Style Definition

  You can use Qwen-Plus to analyze the appropriate style for the current script, or use preset styles. Each style consists of a set of positive/negative prompts used to visually constrain all subsequent generation stages, establishing a unified global visual standard.
  <img src="docs/images/ArtDirection_example.jpg" alt="LumenX Studio ArtDirection" width="100%" />

  Step 3: Assets - Asset Generation

  In this stage, you can edit the text descriptions for characters, scenes, props, and other assets extracted in Step 1, then generate corresponding images based on these descriptions. For characters, to maintain consistency across different scenes, the system first generates a full-body image without background, then uses it as a reference to generate turnarounds and portrait close-ups as core character assets. Subsequent costume or form changes can be derived through secondary image editing based on these full-body photos or turnarounds.
  Additionally, Wanx 2.6 series supports reference-to-video, so you can also generate reference videos for each character, scene, and prop here.

  <img src="docs/images/Assets_example.jpg" alt="LumenX Studio Assets" width="100%" />

  Step 4: StoryBoard - Storyboard Creation

  In this stage, you can extract storyboard scripts based on the screenplay, forming a structured storyboard that supports secondary editing, adding, and deleting shots. For each scene, you can select participating characters, scenes, and props as reference images for generating storyboard images.
  This stage incorporates AI prompt polishing capabilities, allowing you to directly use Qwen-Plus to polish existing prompts, with embedded image editing prompt guidelines as best practices.

  <img src="docs/images/StoryBoard_example.jpg" alt="LumenX Studio StoryBoard" width="100%" />

  Step 5: Motion - Storyboard Video Generation

  This stage can be divided into two generation models: one is the i2v mode driven by the first frame, and the other is the r2v mode driven by character actions. In i2v mode, you can select the storyboard images generated in Step 4 and generate storyboard videos for them one by one. This generation process also incorporates AI prompt polishing capabilities, allowing you to directly use Qwen-Plus to polish existing prompts, with embedded image-to-video prompt guidelines as best practices. In r2v mode, you can select reference videos of characters, scenes, and props for reference-to-video generation.
  This stage also supports a multi-batch size generation lottery mechanism, allowing you to select the final storyboard video for each shot in Step 6.

  <img src="docs/images/Motion_example.jpg" alt="LumenX Studio Motion" width="100%" />

  Step 6: Assembly - Storyboard Video Stitching

  In this stage, you can review the storyboard videos for each shot, select the one you think is best as the final shot, and after all shots are selected, click the "Merge&Proceed" button to stitch them into a complete video with one click.

  <img src="docs/images/Assembly_example.jpg" alt="LumenX Studio Assembly" width="100%" />
</div>

---

## 🏗️ Architecture

LumenX Studio utilizes a modern separated frontend/backend architecture for scalability and performance.

<div align="center">
  <!-- Architecture Diagram -->
  <img src="docs/images/architecture.svg" alt="System Architecture" width="80%" />
</div>

**Tech Stack:**
- **Frontend**: Next.js 14 + React 18 + TypeScript + Tailwind CSS
- **Backend**: FastAPI + Python 3.12+
- **AI Core**: Alibaba Cloud Qwen (Logic) + Wanx (Visuals)
- **Render**: Three.js (Canvas) + FFmpeg (Video Processing)

---

## 🚀 Quick Start

### 1. Prerequisites

- **Python**: 3.12+
- **Node.js**: 18+
- **FFmpeg**: Required (for video processing)

### 2. Clone Repository

```bash
git clone https://github.com/alibaba/lumenx.git
cd lumenx
```

### 3. Configure API Keys

Copy the configuration template and fill in your API Key (Alibaba Cloud Model Studio / Bailian service required):

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and fill in DASHSCOPE_API_KEY
```

### 4. Start Backend

```bash
# Install dependencies
cd backend
pip install -r requirements.txt

# Create output directories
mkdir -p output/uploads

# Start service (http://localhost:17177)
./start_backend.sh
```

### 5. Start Frontend

```bash
cd frontend

# Install dependencies & start service (http://localhost:3000)
npm install && npm run dev
```

---

## 📖 Documentation

- **[User Manual](USER_MANUAL.md)**: **Must-read** for first-time users.
- **[API Documentation](http://localhost:17177/docs)**: Backend Swagger UI.

---

## ⚙️ Advanced Configuration

<details>
<summary>Click to expand configuration details</summary>

### OSS Object Storage (Recommended)
For security and performance, it is recommended to configure Alibaba Cloud OSS for storing generated media:

1. Create a **Private** Bucket
2. Configure in `.env` or App Settings:
   ```env
   ALIBABA_CLOUD_ACCESS_KEY_ID=...
   ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
   # Configure Bucket Name and Endpoint within the app
   ```

### Config File Locations
- **Development**: `backend/.env`
- **Packaged App**: `~/.lumen-x/config.json` in user home directory

</details>

---

## 📁 Directory Structure

```
lumenx/
├── backend/           # Python backend workspace
│   ├── src/          # Core backend code
│   ├── tests/        # Python tests
│   ├── scripts/      # Backend utility scripts
│   └── output/       # (Auto-generated) backend outputs
├── frontend/          # Next.js Frontend
├── docs/              # Documentation and images
```

---

## 🤝 Contributing

We welcome community contributions! Please read our [Contributing Guide](CONTRIBUTING.md) for code standards and submission process.

- **Bug Reports**: Submit via [GitHub Issues](https://github.com/alibaba/lumenx/issues)
- **Feature Requests**: Discuss in [Discussions](https://github.com/alibaba/lumenx/discussions)

## 👤 Author

**StarLotus (星莲)** - *Lead Developer & Maintainer*

For any feedback or questions, please reach out via [GitHub Issues](https://github.com/alibaba/lumenx/issues) or [Discussions](https://github.com/alibaba/lumenx/discussions).
- **Email**: [zhangjunhe.zjh@alibaba-inc.com](mailto:zhangjunhe.zjh@alibaba-inc.com)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  Made with ❤️ by Alibaba Group
</div>
