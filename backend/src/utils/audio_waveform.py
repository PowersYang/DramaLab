"""音频波形分析工具。"""

from __future__ import annotations

import array
import subprocess
from math import ceil


class AudioWaveformAnalyzer:
    """基于 FFmpeg 的轻量 waveform 分析器。"""

    def build_peaks(
        self,
        ffmpeg_path: str,
        source_path: str,
        bucket_count: int = 48,
        timeout_seconds: int = 30,
    ) -> list[float]:
        """把输入媒体转换成 0~1 的峰值数组。"""
        safe_bucket_count = max(int(bucket_count or 0), 8)
        result = subprocess.run(
            [
                ffmpeg_path,
                "-v",
                "error",
                "-i",
                source_path,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "-",
            ],
            check=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
        return self._peaks_from_pcm_bytes(result.stdout, safe_bucket_count)

    def _peaks_from_pcm_bytes(self, pcm_bytes: bytes, bucket_count: int) -> list[float]:
        """按 bucket 统计 PCM 数据的峰值。"""
        if not pcm_bytes:
            return [0.0] * bucket_count

        samples = array.array("h")
        samples.frombytes(pcm_bytes[: len(pcm_bytes) - (len(pcm_bytes) % 2)])
        if not samples:
            return [0.0] * bucket_count

        total_samples = len(samples)
        samples_per_bucket = max(int(ceil(total_samples / bucket_count)), 1)
        max_sample_value = 32768.0
        peaks: list[float] = []

        for index in range(bucket_count):
            start = index * samples_per_bucket
            end = min(start + samples_per_bucket, total_samples)
            if start >= total_samples or start >= end:
                peaks.append(0.0)
                continue
            bucket_peak = max(abs(sample) for sample in samples[start:end]) / max_sample_value
            peaks.append(round(min(max(bucket_peak, 0.0), 1.0), 4))

        return peaks
