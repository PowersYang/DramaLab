"""
从视频中提取音频的工具封装。
底层依赖 ffmpeg 完成实际处理。
"""
import os
import subprocess
import logging
from typing import Optional
from .system_check import get_ffmpeg_path

logger = logging.getLogger(__name__)


class AudioExtractor:
    """使用 ffmpeg 从视频中提取音频。"""
    
    @staticmethod
    def check_ffmpeg() -> bool:
        """检查当前环境里是否能正常调用 ffmpeg。"""
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            return False
        try:
            subprocess.run(
                [ffmpeg_path, '-version'],
                capture_output=True,
                check=True
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False
    
    @staticmethod
    def extract_audio(
        video_path: str,
        output_path: Optional[str] = None,
        audio_format: str = 'mp3',
        audio_bitrate: str = '192k'
    ) -> str:
        """
        从单个视频文件中提取音频。

        如果未传 `output_path`，默认输出到视频同目录。
        """
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError(
                "ffmpeg not found. Please install ffmpeg:\n"
                "  macOS: brew install ffmpeg\n"
                "  Ubuntu: sudo apt-get install ffmpeg\n"
                "  Windows: Download from https://ffmpeg.org/"
            )
        
        # 未指定输出路径时，默认和原视频放在同一目录
        if output_path is None:
            video_dir = os.path.dirname(video_path)
            video_name = os.path.splitext(os.path.basename(video_path))[0]
            output_path = os.path.join(video_dir, f"{video_name}.{audio_format}")
        
        logger.info(f"Extracting audio from: {video_path}")
        logger.info(f"Output: {output_path}")
        logger.info(f"Format: {audio_format}, Bitrate: {audio_bitrate}")
        
        # 组装 ffmpeg 命令
        cmd = [
            ffmpeg_path,
            '-i', video_path,           # 输入视频
            '-vn',                       # 不保留视频流
            '-acodec', 'libmp3lame' if audio_format == 'mp3' else 'copy',  # 音频编码器
            '-ab', audio_bitrate,        # 音频码率
            '-y',                        # 允许覆盖已有文件
            output_path
        ]
        
        # 执行 ffmpeg
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            logger.info(f"✅ Audio extracted successfully: {output_path}")
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"视频处理程序错误：{e.stderr}")
            raise RuntimeError(f"Failed to extract audio: {e.stderr}")
    
    @staticmethod
    def batch_extract(
        video_paths: list,
        audio_format: str = 'mp3',
        audio_bitrate: str = '192k'
    ) -> list:
        """批量提取多个视频的音频。"""
        results = []
        
        for i, video_path in enumerate(video_paths, 1):
            logger.info(f"\n[{i}/{len(video_paths)}] 正在处理：{os.path.basename(video_path)}")
            
            try:
                audio_path = AudioExtractor.extract_audio(
                    video_path=video_path,
                    audio_format=audio_format,
                    audio_bitrate=audio_bitrate
                )
                results.append({
                    'video': video_path,
                    'audio': audio_path,
                    'status': 'success'
                })
            except Exception as e:
                logger.error(f"处理失败：{e}")
                results.append({
                    'video': video_path,
                    'audio': None,
                    'status': 'failed',
                    'error': str(e)
                })
        
        return results
