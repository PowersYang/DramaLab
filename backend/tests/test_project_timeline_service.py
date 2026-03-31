import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.application.services.project_timeline_service import ProjectTimelineService
from src.schemas.models import TimelineAsset


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
