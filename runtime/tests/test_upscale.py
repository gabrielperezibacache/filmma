import fcntl
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image, ImageFilter
import numpy as np

spec = importlib.util.spec_from_file_location('filmma_upscale', Path(__file__).resolve().parents[1] / 'filmma_upscale.py')
upscale = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upscale)


class UpscaleContractTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is required for the color contract')
    def test_rgb_encoding_preserves_pixels_and_bt709_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            raw, video = Path(directory) / 'frame.rgb', Path(directory) / 'frame.mp4'
            raw.write_bytes(bytes([128, 64, 32]) * 64 * 64)
            upscale.run_capture(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                                 '-s:v', '64x64', '-framerate', '24', '-i', raw, '-frames:v', '1', '-an',
                                 '-vf', upscale.OUTPUT_COLOR_FILTER, '-c:v', 'libx264', '-threads', '2', '-crf', '16',
                                 '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', video])
            data = json.loads(upscale.run_capture(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', video]))
            stream = data['streams'][0]
            self.assertEqual([stream[key] for key in ('color_space', 'color_transfer', 'color_primaries', 'color_range')], ['bt709', 'bt709', 'bt709', 'tv'])
            decoded = upscale.run_capture(['ffmpeg', '-v', 'error', '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
            self.assertEqual(len(decoded), 64 * 64 * 3)
            values = np.frombuffer(decoded, dtype=np.uint8).reshape((-1, 3)).astype(np.int16)
            self.assertLessEqual(int(np.abs(values - [128, 64, 32]).max()), 3)

    def test_4k_dimensions_preserve_landscape_portrait_square_and_nonstandard_aspect(self):
        self.assertEqual(upscale.target_dimensions(512, 288), (3840, 2160))
        self.assertEqual(upscale.target_dimensions(288, 512), (2160, 3840))
        self.assertEqual(upscale.target_dimensions(1024, 1024), (2880, 2880))
        self.assertEqual(upscale.target_dimensions(864, 480), (3840, 2132))

    def test_residual_preserves_a_constant_ai_palette_shift(self):
        original = Image.new('RGB', (32, 18), (90, 100, 110))
        ai = Image.new('RGB', (128, 72), (130, 140, 150))
        result, metrics = upscale.conservative_detail(original, ai, (128, 72), 1)
        self.assertTrue(np.all(np.asarray(result) == (90, 100, 110)))
        self.assertEqual(metrics['maxRgbDifference'], 0)

    def test_high_frequency_changes_are_bounded_even_with_extreme_ai_pixels(self):
        original = Image.new('RGB', (32, 18), (110, 110, 110))
        values = np.zeros((72, 128, 3), dtype=np.uint8)
        values[:, ::2] = 255
        result, metrics = upscale.conservative_detail(original, Image.fromarray(values), (128, 72), .35)
        self.assertLessEqual(metrics['maxRgbDifference'], 9)
        self.assertGreater(metrics['maxRgbDifference'], 0)
        self.assertEqual(result.size, (128, 72))

    def test_zero_strength_is_exact_lanczos_and_frame_order_has_no_effect(self):
        original = Image.fromarray(np.arange(32 * 18 * 3, dtype=np.uint8).reshape((18, 32, 3)))
        ai = Image.new('RGB', (128, 72), (255, 0, 0))
        first, _ = upscale.conservative_detail(original, ai, (128, 72), 0)
        second, _ = upscale.conservative_detail(original, ai, (128, 72), 0)
        expected = original.resize((128, 72), Image.Resampling.LANCZOS)
        self.assertEqual(first.tobytes(), expected.tobytes())
        self.assertEqual(second.tobytes(), first.tobytes())

    def test_restoration_preserves_constant_source_palette_despite_ai_color_shift(self):
        original = Image.new('RGB', (32, 18), (90, 100, 110))
        ai = Image.new('RGB', (128, 72), (130, 140, 150))
        for strength in (.35, .75, 1):
            with self.subTest(strength=strength):
                result, metrics = upscale.restore_detail(original, ai, (128, 72), strength)
                self.assertTrue(np.all(np.asarray(result) == (90, 100, 110)))
                self.assertEqual(metrics['maxRgbDifference'], 0)

    def test_zero_restoration_strength_is_exact_lanczos_without_frame_state(self):
        original = Image.fromarray(np.arange(32 * 18 * 3, dtype=np.uint8).reshape((18, 32, 3)))
        ai = Image.new('RGB', (128, 72), (255, 0, 0))
        expected = original.resize((128, 72), Image.Resampling.LANCZOS)
        first, metrics = upscale.restore_detail(original, ai, (128, 72), 0)
        upscale.restore_detail(Image.new('RGB', (32, 18), (0, 255, 0)), ai, (128, 72), .75)
        second, _ = upscale.restore_detail(original, ai, (128, 72), 0)
        self.assertEqual(first.tobytes(), expected.tobytes())
        self.assertEqual(second.tobytes(), first.tobytes())
        self.assertEqual(metrics['maxRgbDifference'], 0)

    def test_restoration_retains_a_synthetic_neural_edge_more_than_conservative_profile(self):
        # A controlled blurred edge isolates the intended behavior. This is not
        # a score for natural footage, identity or recovery of real detail.
        values = np.full((32, 64, 3), 70, dtype=np.uint8)
        values[:, 32:] = 190
        original = Image.fromarray(values).filter(ImageFilter.GaussianBlur(2))
        ai = Image.fromarray(values).resize((512, 256), Image.Resampling.NEAREST)
        conservative, _ = upscale.conservative_detail(original, ai, (512, 256), .35)
        restored, _ = upscale.restore_detail(original, ai, (512, 256), .75)
        conservative_values = np.asarray(conservative).astype(np.int16)
        restored_values = np.asarray(restored).astype(np.int16)
        conservative_edge = int(conservative_values[128, 257, 0] - conservative_values[128, 254, 0])
        restored_edge = int(restored_values[128, 257, 0] - restored_values[128, 254, 0])
        self.assertGreater(restored_edge, conservative_edge + 20)
        self.assertEqual(restored.size, (512, 256))

    def test_invalid_processing_profile_is_rejected_before_diagnostics_or_gpu(self):
        for profile in ('unknown', '', None, 1, {}):
            with self.subTest(profile=profile), patch.object(upscale, 'doctor') as doctor, patch.object(upscale, 'run_capture') as capture, patch.object(upscale, 'spawn') as spawn:
                with self.assertRaises(upscale.UpscaleError) as context:
                    upscale._upscale({'processingProfile': profile})
                self.assertEqual(context.exception.code, 'INVALID_PROCESSING_PROFILE')
                doctor.assert_not_called()
                capture.assert_not_called()
                spawn.assert_not_called()

    def test_shared_generation_lock_excludes_a_second_worker(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(upscale, 'RUNTIME', Path(directory)):
            with (Path(directory) / '.generation.lock').open('a+') as existing_generation:
                fcntl.flock(existing_generation, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(upscale.UpscaleError) as context:
                    with upscale.exclusive_lock('generation'):
                        self.fail('The generation lock was bypassed')
                self.assertEqual(context.exception.code, 'RUNTIME_BUSY')
                self.assertTrue(upscale.gpu_busy())
            self.assertFalse(upscale.gpu_busy())

    def test_cancellation_stops_spawned_processes(self):
        child = upscale.spawn([sys.executable, '-c', 'import time; time.sleep(60)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        upscale.stop_children()
        self.assertIsNotNone(child.poll())
        self.assertFalse(upscale.CHILDREN)

    def test_resistant_children_share_one_cancellation_deadline(self):
        children = [upscale.spawn([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("ready",flush=True); time.sleep(60)'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) for _ in range(2)]
        for child in children:
            self.assertEqual(child.stdout.readline().strip(), b'ready')
        started = time.monotonic()
        upscale.stop_children()
        self.assertLess(time.monotonic() - started, 1.8)
        self.assertTrue(all(child.poll() is not None for child in children))
        for child in children:
            child.stdout.close()
        self.assertFalse(upscale.CHILDREN)

    def test_existing_output_and_original_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(upscale, 'doctor', return_value={'ready': True}):
            source, output = Path(directory) / 'original.mp4', Path(directory) / 'existing.mp4'
            source.write_bytes(b'original footage')
            output.write_bytes(b'previous derivative')
            with self.assertRaises(upscale.UpscaleError) as context:
                upscale._upscale({'source': str(source), 'destination': str(output)})
            self.assertEqual(context.exception.code, 'OUTPUT_EXISTS')
            self.assertEqual(source.read_bytes(), b'original footage')
            self.assertEqual(output.read_bytes(), b'previous derivative')

    def source_metadata(self, **overrides):
        return json.dumps({'streams': [{'codec_type': 'video', 'width': 864, 'height': 480,
                                       'avg_frame_rate': '30000/1001', 'duration': '0.1001',
                                       'sample_aspect_ratio': '1:1', **overrides}], 'format': {}}).encode()

    def test_rational_cfr_is_preserved_and_vfr_rejected(self):
        timestamps = json.dumps({'frames': [{'best_effort_timestamp_time': str(value)} for value in [0, .033367, .066733]]}).encode()
        with patch.object(upscale, 'run_capture', side_effect=[self.source_metadata(), timestamps]):
            result = upscale.inspect_video('source.mp4', 'ffprobe')
        self.assertEqual(str(result['fps']), '30000/1001')
        self.assertEqual(result['frames'], 3)
        bad_timestamps = json.dumps({'frames': [{'best_effort_timestamp_time': str(value)} for value in [0, .033367, .1001]]}).encode()
        with patch.object(upscale, 'run_capture', side_effect=[self.source_metadata(), bad_timestamps]):
            with self.assertRaises(upscale.UpscaleError) as context:
                upscale.inspect_video('source.mp4', 'ffprobe')
        self.assertEqual(context.exception.code, 'VFR_UNSUPPORTED')

    def test_hdr_long_clip_and_oversize_are_rejected_before_frame_decoding(self):
        for fields, error in [({'color_transfer': 'smpte2084'}, 'HDR_UNSUPPORTED'),
                              ({'duration': '15.1'}, 'DURATION_LIMIT'),
                              ({'width': 3840, 'height': 2160}, 'INPUT_TOO_LARGE')]:
            with patch.object(upscale, 'run_capture', return_value=self.source_metadata(**fields)) as capture:
                with self.assertRaises(upscale.UpscaleError) as context:
                    upscale.inspect_video('source.mp4', 'ffprobe')
                self.assertEqual(context.exception.code, error)
                self.assertEqual(capture.call_count, 1)


if __name__ == '__main__':
    unittest.main()
