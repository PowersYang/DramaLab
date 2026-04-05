import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from src.application.services.project_timeline_service import ProjectTimelineService
from src.schemas.models import ProjectTimeline, TimelineAsset, TimelineClip, TimelineTrack
from src.utils.datetime import utc_now


class ProjectTimelineServiceWaveformTest(unittest.TestCase):
    def test_hydrate_asset_waveforms_populates_audio_metadata(self):
        service = ProjectTimelineService()
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = Path(temp_dir) / "dialogue.wav"
            audio_path.write_bytes(b"fake-audio")

            assets = [
                TimelineAsset(
                    id="asset_audio_1",
                    kind="audio",
                    source_url=str(audio_path),
                    label="对白",
                    source_duration=3.2,
                    role="dialogue",
                )
            ]

            with patch("src.application.services.project_timeline_service.get_ffmpeg_path", return_value="ffmpeg"):
                with patch.object(service.waveform_analyzer, "build_peaks", return_value=[0.1, 0.4, 0.7]) as build_mock:
                    hydrated_assets = service._hydrate_asset_waveforms(assets)

            self.assertEqual(len(hydrated_assets), 1)
            self.assertEqual(hydrated_assets[0].metadata["waveform_peaks"], [0.1, 0.4, 0.7])
            self.assertEqual(hydrated_assets[0].metadata["waveform_bucket_count"], 3)
            build_mock.assert_called_once_with("ffmpeg", str(audio_path))

    def test_hydrate_asset_waveforms_keeps_existing_peaks(self):
        service = ProjectTimelineService()
        assets = [
            TimelineAsset(
                id="asset_audio_1",
                kind="audio",
                source_url="oss://dialogue.wav",
                label="对白",
                source_duration=3.2,
                role="dialogue",
                metadata={"waveform_peaks": [0.2, 0.5], "waveform_bucket_count": 2},
            )
        ]

        with patch("src.application.services.project_timeline_service.get_ffmpeg_path", return_value="ffmpeg"):
            with patch.object(service.waveform_analyzer, "build_peaks") as build_mock:
                hydrated_assets = service._hydrate_asset_waveforms(assets)

        self.assertEqual(hydrated_assets[0].metadata["waveform_peaks"], [0.2, 0.5])
        self.assertEqual(hydrated_assets[0].metadata["waveform_bucket_count"], 2)
        build_mock.assert_not_called()

    def test_get_timeline_caches_waveform_snapshot_without_bumping_version(self):
        service = ProjectTimelineService()
        now = utc_now()
        timeline = ProjectTimeline(
            project_id="project_waveform_cache_1",
            version=4,
            tracks=[TimelineTrack(id="track_dialogue_main", track_type="dialogue", label="对白", order=1, gain=1.0)],
            assets=[
                TimelineAsset(
                    id="asset_audio_1",
                    kind="audio",
                    source_url="oss://dialogue.wav",
                    label="对白",
                    source_duration=3.2,
                    role="dialogue",
                )
            ],
            clips=[],
            updated_at=now,
        )

        with patch.object(service.project_service, "get_project", return_value=SimpleNamespace(timeline=timeline)):
            with patch.object(service, "_build_asset_waveform_peaks", return_value=[0.1, 0.4, 0.7]):
                with patch.object(service.project_repository, "cache_timeline_snapshot") as cache_mock:
                    normalized = service.get_timeline("project_waveform_cache_1")

        self.assertEqual(normalized.version, 4)
        self.assertEqual(normalized.updated_at, now)
        self.assertEqual(normalized.assets[0].metadata["waveform_peaks"], [0.1, 0.4, 0.7])
        cache_mock.assert_called_once()

    def test_normalize_timeline_populates_mix_diagnostics(self):
        service = ProjectTimelineService()
        now = utc_now()
        timeline = ProjectTimeline(
            project_id="project_mix_diag_1",
            version=2,
            tracks=[
                TimelineTrack(id="track_video_main", track_type="video", label="视频", order=0, gain=1.0, solo=False),
                TimelineTrack(id="track_dialogue_main", track_type="dialogue", label="对白", order=1, gain=1.0, solo=True),
                TimelineTrack(id="track_sfx_main", track_type="sfx", label="音效", order=2, gain=0.8, solo=False),
                TimelineTrack(id="track_bgm_main", track_type="bgm", label="背景音乐", order=3, gain=0.5, solo=False),
            ],
            assets=[
                TimelineAsset(id="asset_video_1", kind="video", source_url="oss://video.mp4", label="镜头 1", source_duration=5.0, role="main"),
                TimelineAsset(id="asset_dialogue_1", kind="audio", source_url="oss://dialogue.mp3", label="对白 1", source_duration=5.0, role="dialogue"),
                TimelineAsset(id="asset_bgm_1", kind="audio", source_url="oss://bgm.mp3", label="BGM 1", source_duration=12.0, role="bgm"),
            ],
            clips=[
                TimelineClip(id="clip_video_1", asset_id="asset_video_1", track_id="track_video_main", clip_order=0, timeline_start=0, timeline_end=5, source_start=0, source_end=5, metadata={"original_audio_enabled": True}),
                TimelineClip(id="clip_dialogue_1", asset_id="asset_dialogue_1", track_id="track_dialogue_main", clip_order=0, timeline_start=0, timeline_end=5, source_start=0, source_end=5),
                TimelineClip(id="clip_bgm_1", asset_id="asset_bgm_1", track_id="track_bgm_main", clip_order=0, timeline_start=0, timeline_end=12, source_start=0, source_end=12),
            ],
            updated_at=now,
        )

        with patch.object(service, "_hydrate_asset_waveforms", return_value=timeline.assets):
            normalized = service._normalize_timeline(timeline, bump_version=False)

        self.assertIsNotNone(normalized.diagnostics)
        self.assertEqual(normalized.diagnostics.video_clip_count, 1)
        self.assertEqual(normalized.diagnostics.audio_clip_count, 2)
        self.assertEqual(normalized.diagnostics.enabled_track_count, 4)
        self.assertEqual(normalized.diagnostics.solo_track_count, 1)
        self.assertTrue(normalized.diagnostics.has_dialogue)
        self.assertTrue(normalized.diagnostics.has_bgm)
        self.assertTrue(normalized.diagnostics.has_video_original_audio)
        self.assertTrue(normalized.diagnostics.has_ducking_path)
        self.assertEqual(normalized.diagnostics.export_readiness, "mix_ready")
        self.assertTrue(normalized.diagnostics.flags["multitrack_audio"])
        self.assertTrue(normalized.diagnostics.flags["monitoring_overrides"])
        self.assertTrue(normalized.diagnostics.flags["video_original_audio"])
        self.assertIn("对白优先与 BGM ducking 链路已就绪。", normalized.diagnostics.summary_notes)
        self.assertIn("视频原声片段级混音已启用。", normalized.diagnostics.summary_notes)
