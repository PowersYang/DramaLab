import unittest

from src.utils.audio_waveform import AudioWaveformAnalyzer


class AudioWaveformAnalyzerTest(unittest.TestCase):
    def test_peaks_from_pcm_bytes_normalizes_signal(self):
        analyzer = AudioWaveformAnalyzer()
        pcm = (
            (0).to_bytes(2, byteorder="little", signed=True)
            + (8192).to_bytes(2, byteorder="little", signed=True)
            + (-16384).to_bytes(2, byteorder="little", signed=True)
            + (32767).to_bytes(2, byteorder="little", signed=True)
        )

        peaks = analyzer._peaks_from_pcm_bytes(pcm, bucket_count=4)

        self.assertEqual(len(peaks), 4)
        self.assertEqual(peaks[0], 0.0)
        self.assertAlmostEqual(peaks[1], 0.25, places=2)
        self.assertAlmostEqual(peaks[2], 0.5, places=2)
        self.assertAlmostEqual(peaks[3], 1.0, places=3)

    def test_peaks_from_empty_pcm_returns_zeros(self):
        analyzer = AudioWaveformAnalyzer()
        peaks = analyzer._peaks_from_pcm_bytes(b"", bucket_count=12)
        self.assertEqual(peaks, [0.0] * 12)
