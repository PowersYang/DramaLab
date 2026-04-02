import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from src.application.services.project_timeline_service import ProjectTimelineService
from src.schemas.models import ProjectTimeline, TimelineAsset, TimelineTrack
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
