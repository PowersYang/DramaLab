"""
应用运行环境检查工具。
"""
import subprocess
import shutil
import platform
import os
import sys
from typing import Dict, List, Tuple
import logging

logger = logging.getLogger(__name__)


def get_ffmpeg_path() -> str:
    """
    查找 ffmpeg 可执行文件路径，优先使用随应用一起打包的版本。

    查找顺序：
    1. 打包产物内自带的 ffmpeg
    2. 系统 PATH 中的 ffmpeg
    3. Windows 常见安装目录
    """
    # 先处理 PyInstaller 这类打包场景
    if getattr(sys, 'frozen', False):
        # 当前运行在打包环境中
        bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))

        # 尝试几个常见的内置 ffmpeg 位置
        ffmpeg_name = 'ffmpeg.exe' if platform.system() == 'Windows' else 'ffmpeg'
        possible_paths = [
            os.path.join(bundle_dir, 'bin', ffmpeg_name),
            os.path.join(bundle_dir, 'ffmpeg', ffmpeg_name),
            os.path.join(bundle_dir, ffmpeg_name),
        ]

        for path in possible_paths:
            if os.path.exists(path) and os.access(path, os.X_OK):
                logger.info(f"使用内置视频处理程序路径：{path}")
                return path

    # 再回退到系统 PATH
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        logger.info(f"使用系统视频处理程序路径：{system_ffmpeg}")
        return system_ffmpeg

    # Windows 下安装后如果没重开终端，PATH 可能还没刷新
    # 这里额外补查一批常见安装目录
    if platform.system() == "Windows":
        common_windows_paths = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "Desktop", "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "Downloads", "ffmpeg", "bin", "ffmpeg.exe"),
            # Scoop 安装目录
            os.path.join(os.environ.get("USERPROFILE", ""), "scoop", "shims", "ffmpeg.exe"),
            # Chocolatey 安装目录
            os.path.join(os.environ.get("ChocolateyInstall", "C:\\ProgramData\\chocolatey"), "bin", "ffmpeg.exe"),
            # winget 或常见手动安装目录
            "C:\\ffmpeg\\bin\\ffmpeg.exe",
            "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe",
        ]
        for path in common_windows_paths:
            if path and os.path.isfile(path):
                logger.info(f"在常见安装路径找到视频处理程序：{path}")
                return path

        logger.warning(
            "未在系统路径或常见安装目录找到视频处理程序。"
            "如已安装，请确保其可执行文件目录已加入系统路径，并重启应用。"
        )

    return None


def check_ffmpeg() -> Tuple[bool, str]:
    """检查 ffmpeg 是否可用，并返回可读结果说明。"""
    ffmpeg_path = get_ffmpeg_path()
    if not ffmpeg_path:
        return False, "FFmpeg not found in bundle or system PATH"
    
    try:
        result = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0] if result.stdout else "Unknown version"
            return True, f"Found at {ffmpeg_path}: {version_line}"
        else:
            return False, f"FFmpeg found at {ffmpeg_path} but returned error code {result.returncode}"
    except subprocess.TimeoutExpired:
        return False, f"FFmpeg at {ffmpeg_path} timed out"
    except Exception as e:
        return False, f"FFmpeg found at {ffmpeg_path} but not working: {str(e)}"


def get_system_info() -> Dict[str, str]:
    """收集基础系统信息，便于排查问题。"""
    return {
        "platform": platform.system(),
        "platform_version": platform.version(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "machine": platform.machine(),
        "processor": platform.processor(),
    }


def run_system_checks() -> Dict[str, any]:
    """执行环境检查并返回汇总结果。"""
    ffmpeg_ok, ffmpeg_msg = check_ffmpeg()
    
    return {
        "system_info": get_system_info(),
        "dependencies": {
            "ffmpeg": {
                "available": ffmpeg_ok,
                "message": ffmpeg_msg,
                "path": get_ffmpeg_path()
            }
        },
        "status": "ok" if ffmpeg_ok else "warning"
    }


def get_ffmpeg_install_instructions() -> str:
    """
    按平台返回 ffmpeg 安装说明。

    对打包版应用来说，这主要用于兜底提示。
    """
    system = platform.system()
    
    if system == "Windows":
        return (
            "FFmpeg Installation (Windows):\n"
            "1. Download from: https://www.gyan.dev/ffmpeg/builds/\n"
            "2. Extract the downloaded file\n"
            "3. Add the 'bin' folder to your system PATH\n"
            "4. Restart the application\n\n"
            "Alternatively, download from: https://ffmpeg.org/download.html"
        )
    elif system == "Darwin":  # macOS
        return (
            "FFmpeg Installation (macOS):\n"
            "1. Install Homebrew if not already installed: https://brew.sh/\n"
            "2. Open Terminal and run: brew install ffmpeg\n"
            "3. Restart the application\n\n"
            "Alternatively, download from: https://ffmpeg.org/download.html"
        )
    elif system == "Linux":
        return (
            "FFmpeg Installation (Linux):\n"
            "Ubuntu/Debian: sudo apt-get update && sudo apt-get install ffmpeg\n"
            "Fedora: sudo dnf install ffmpeg\n"
            "Arch Linux: sudo pacman -S ffmpeg\n\n"
            "Or download from: https://ffmpeg.org/download.html"
        )
    else:
        return (
            "FFmpeg Installation:\n"
            "Please visit https://ffmpeg.org/download.html for installation instructions\n"
            "for your operating system."
        )
