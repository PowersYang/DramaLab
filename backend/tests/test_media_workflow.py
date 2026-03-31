import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from src.application.workflows.media_workflow import MediaWorkflow
from src.schemas.models import ProjectTimeline, Script, TimelineAsset, TimelineClip, TimelineTrack
from src.utils.datetime import utc_now


class MediaWorkflowTimelineMixTest(unittest.TestCase):
    def test_resolve_timeline_audio_clips_keeps_absolute_positions(self):
        now = utc_now()
        workflow = MediaWorkflow()
        project = Script(
            id="project_audio_mix_1",
            title="Audio Mix",
            original_text="text",
            characters=[],
            scenes=[],
            props=[],
            frames=[],
            video_tasks=[],
            timeline=ProjectTimeline(
                project_id="project_audio_mix_1",
                version=3,
                tracks=[
                    TimelineTrack(id="track_video_main", track_type="video", label="视频", order=0, gain=1.0),
                    TimelineTrack(id="track_dialogue_main", track_type="dialogue", label="对白", order=1, gain=0.8),
                    TimelineTrack(id="track_bgm_main", track_type="bgm", label="BGM", order=2, gain=0.5),
                ],
                assets=[
                    TimelineAsset(id="asset_video_1", kind="video", source_url="oss://video.mp4", label="镜头 1", source_duration=5),
                    TimelineAsset(id="asset_dialogue_1", kind="audio", source_url="oss://dialogue.mp3", label="对白 1", source_duration=6),
                    TimelineAsset(id="asset_bgm_1", kind="audio", source_url="oss://bgm.mp3", label="BGM 1", source_duration=30),
                ],
                clips=[
                    TimelineClip(
                        id="clip_video_1",
                        asset_id="asset_video_1",
                        track_id="track_video_main",
                        clip_order=0,
                        timeline_start=0,
                        timeline_end=5,
                        source_start=0,
                        source_end=5,
                    ),
                    TimelineClip(
                        id="clip_dialogue_1",
                        asset_id="asset_dialogue_1",
                        track_id="track_dialogue_main",
                        clip_order=0,
                        timeline_start=1.25,
                        timeline_end=4.75,
                        source_start=0.5,
                        source_end=4.0,
                        volume=0.7,
                    ),
                    TimelineClip(
                        id="clip_bgm_1",
                        asset_id="asset_bgm_1",
                        track_id="track_bgm_main",
                        clip_order=0,
                        timeline_start=0.0,
                        timeline_end=8.0,
                        source_start=2.0,
                        source_end=10.0,
                        volume=0.4,
                    ),
                ],
                updated_at=now,
            ),
            created_at=now,
            updated_at=now,
        )

        specs = workflow._resolve_timeline_audio_clips(project)
        self.assertEqual(len(specs), 2)
        self.assertEqual(specs[0]["track_type"], "bgm")
        self.assertEqual(specs[0]["timeline_start"], 0.0)
        self.assertEqual(specs[0]["duration"], 8.0)
        self.assertEqual(specs[0]["volume"], 0.2)
        self.assertEqual(specs[1]["track_type"], "dialogue")
        self.assertEqual(specs[1]["timeline_start"], 1.25)
        self.assertEqual(specs[1]["source_start"], 0.5)
        self.assertEqual(specs[1]["source_end"], 4.0)
        self.assertEqual(specs[1]["volume"], 0.56)

    def test_resolve_timeline_audio_clips_respects_solo_tracks(self):
        now = utc_now()
        workflow = MediaWorkflow()
        project = Script(
            id="project_audio_solo_1",
            title="Audio Solo",
            original_text="text",
            characters=[],
            scenes=[],
            props=[],
            frames=[],
            video_tasks=[],
            timeline=ProjectTimeline(
                project_id="project_audio_solo_1",
                version=1,
                tracks=[
                    TimelineTrack(id="track_video_main", track_type="video", label="视频", order=0, gain=1.0, solo=False),
                    TimelineTrack(id="track_dialogue_main", track_type="dialogue", label="对白", order=1, gain=1.0, solo=True),
                    TimelineTrack(id="track_bgm_main", track_type="bgm", label="BGM", order=2, gain=0.5, solo=False),
                ],
                assets=[
                    TimelineAsset(id="asset_dialogue_1", kind="audio", source_url="oss://dialogue.mp3", label="对白", source_duration=5),
                    TimelineAsset(id="asset_bgm_1", kind="audio", source_url="oss://bgm.mp3", label="BGM", source_duration=10),
                ],
                clips=[
                    TimelineClip(
                        id="clip_dialogue_1",
                        asset_id="asset_dialogue_1",
                        track_id="track_dialogue_main",
                        clip_order=0,
                        timeline_start=0,
                        timeline_end=3,
                        source_start=0,
                        source_end=3,
                        volume=1.0,
                    ),
                    TimelineClip(
                        id="clip_bgm_1",
                        asset_id="asset_bgm_1",
                        track_id="track_bgm_main",
                        clip_order=0,
                        timeline_start=0,
                        timeline_end=6,
                        source_start=0,
                        source_end=6,
                        volume=1.0,
                    ),
                ],
                updated_at=now,
            ),
            created_at=now,
            updated_at=now,
        )

        specs = workflow._resolve_timeline_audio_clips(project)
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0]["track_type"], "dialogue")
        self.assertEqual(workflow._get_video_track_gain(project), 0.0)

    def test_mix_timeline_audio_builds_filter_complex_command(self):
        workflow = MediaWorkflow()
        with tempfile.TemporaryDirectory() as temp_dir:
            merged_video_path = str(Path(temp_dir) / "merged.mp4")
            mixed_output_path = str(Path(temp_dir) / "mixed.mp4")
            audio_1 = str(Path(temp_dir) / "dialogue.mp3")
            audio_2 = str(Path(temp_dir) / "bgm.mp3")
            Path(merged_video_path).write_bytes(b"video")
            Path(audio_1).write_bytes(b"a1")
            Path(audio_2).write_bytes(b"a2")

            source_to_local = {
                "oss://dialogue.mp3": audio_1,
                "oss://bgm.mp3": audio_2,
            }
            audio_specs = [
                {
                    "clip_id": "clip_dialogue_1",
                    "track_type": "dialogue",
                    "source_url": "oss://dialogue.mp3",
                    "timeline_start": 1.5,
                    "source_start": 0.2,
                    "source_end": 3.2,
                    "duration": 3.0,
                    "volume": 0.65,
                    "fade_in_duration": 0.4,
                    "fade_out_duration": 0.6,
                },
                {
                    "clip_id": "clip_bgm_1",
                    "track_type": "bgm",
                    "source_url": "oss://bgm.mp3",
                    "timeline_start": 0.0,
                    "source_start": 2.0,
                    "source_end": 8.0,
                    "duration": 6.0,
                    "volume": 0.4,
                    "fade_in_duration": 0.0,
                    "fade_out_duration": 0.0,
                },
            ]

            with patch.object(workflow, "_materialize_media_input", side_effect=lambda source, temp_dir, filename_hint: source_to_local.get(source)):
                with patch(
                    "src.application.workflows.media_workflow.subprocess.run",
                    side_effect=[
                        SimpleNamespace(stdout="", stderr="Stream #0:1: Audio: aac", returncode=0),
                        SimpleNamespace(stdout="", stderr="", returncode=0),
                    ],
                ) as run_mock:
                    result = workflow._mix_timeline_audio(
                        ffmpeg_path="ffmpeg",
                        merged_video_path=merged_video_path,
                        mixed_output_path=mixed_output_path,
                        audio_overlay_specs=audio_specs,
                        video_track_gain=0.75,
                        temp_dir=temp_dir,
                    )

            self.assertEqual(result, mixed_output_path)
            cmd = run_mock.call_args_list[-1].args[0]
            self.assertEqual(cmd[0], "ffmpeg")
            self.assertIn("-filter_complex", cmd)
            filter_complex = cmd[cmd.index("-filter_complex") + 1]
            self.assertIn("[0:a]asetpts=PTS-STARTPTS,volume=0.750[basea]", filter_complex)
            self.assertIn("atrim=start=0.200:duration=3.000", filter_complex)
            self.assertIn("adelay=1500|1500", filter_complex)
            self.assertIn("volume=0.650", filter_complex)
            self.assertIn("afade=t=in:st=0:d=0.400", filter_complex)
            self.assertIn("afade=t=out:st=2.400:d=0.600", filter_complex)
            self.assertIn("sidechaincompress=threshold=0.08:ratio=10:attack=5:release=250:makeup=1[bgmduck]", filter_complex)
            self.assertIn("amix=inputs=3:normalize=0:dropout_transition=0[aout]", filter_complex)
            self.assertEqual(cmd[-1], mixed_output_path)

    def test_mix_timeline_audio_without_dialogue_does_not_apply_ducking(self):
        workflow = MediaWorkflow()
        with tempfile.TemporaryDirectory() as temp_dir:
            merged_video_path = str(Path(temp_dir) / "merged.mp4")
            mixed_output_path = str(Path(temp_dir) / "mixed.mp4")
            audio_1 = str(Path(temp_dir) / "bgm.mp3")
            Path(merged_video_path).write_bytes(b"video")
            Path(audio_1).write_bytes(b"a1")

            with patch.object(workflow, "_materialize_media_input", return_value=audio_1):
                with patch(
                    "src.application.workflows.media_workflow.subprocess.run",
                    side_effect=[
                        SimpleNamespace(stdout="", stderr="Stream #0:1: Audio: aac", returncode=0),
                        SimpleNamespace(stdout="", stderr="", returncode=0),
                    ],
                ) as run_mock:
                    workflow._mix_timeline_audio(
                        ffmpeg_path="ffmpeg",
                        merged_video_path=merged_video_path,
                        mixed_output_path=mixed_output_path,
                        audio_overlay_specs=[
                            {
                                "clip_id": "clip_bgm_1",
                                "track_type": "bgm",
                                "source_url": "oss://bgm.mp3",
                                "timeline_start": 0.0,
                                "source_start": 1.0,
                                "source_end": 5.0,
                                "duration": 4.0,
                                "volume": 0.5,
                                "fade_in_duration": 0.0,
                                "fade_out_duration": 0.0,
                            }
                        ],
                        video_track_gain=1.0,
                        temp_dir=temp_dir,
                    )

            filter_complex = run_mock.call_args_list[-1].args[0][run_mock.call_args_list[-1].args[0].index("-filter_complex") + 1]
            self.assertNotIn("sidechaincompress=", filter_complex)

    def test_mix_timeline_audio_skips_base_audio_when_video_has_no_audio_stream(self):
        workflow = MediaWorkflow()
        with tempfile.TemporaryDirectory() as temp_dir:
            merged_video_path = str(Path(temp_dir) / "merged.mp4")
            mixed_output_path = str(Path(temp_dir) / "mixed.mp4")
            audio_1 = str(Path(temp_dir) / "dialogue.mp3")
            Path(merged_video_path).write_bytes(b"video")
            Path(audio_1).write_bytes(b"a1")

            with patch.object(workflow, "_materialize_media_input", return_value=audio_1):
                with patch(
                    "src.application.workflows.media_workflow.subprocess.run",
                    side_effect=[
                        SimpleNamespace(stdout="", stderr="Stream #0:0: Video: h264", returncode=0),
                        SimpleNamespace(stdout="", stderr="", returncode=0),
                    ],
                ) as run_mock:
                    workflow._mix_timeline_audio(
                        ffmpeg_path="ffmpeg",
                        merged_video_path=merged_video_path,
                        mixed_output_path=mixed_output_path,
                        audio_overlay_specs=[
                            {
                                "clip_id": "clip_dialogue_1",
                                "track_type": "dialogue",
                                "source_url": "oss://dialogue.mp3",
                                "timeline_start": 0.5,
                                "source_start": 0.0,
                                "source_end": 2.0,
                                "duration": 2.0,
                                "volume": 1.0,
                            }
                        ],
                        video_track_gain=1.0,
                        temp_dir=temp_dir,
                    )

            filter_complex = run_mock.call_args_list[-1].args[0][run_mock.call_args_list[-1].args[0].index("-filter_complex") + 1]
            self.assertNotIn("[0:a]asetpts=PTS-STARTPTS[basea]", filter_complex)
            self.assertIn("amix=inputs=1:normalize=0:dropout_transition=0[aout]", filter_complex)
