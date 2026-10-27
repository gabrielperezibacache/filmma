import importlib.util
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from filmma_temporal import TemporalResidual, cv2_module


class TemporalQualityTests(unittest.TestCase):
    def test_single_frame_and_scene_cuts_preserve_current_picture_exactly(self):
        stable = TemporalResidual()
        source = Image.new('RGB', (64, 64), (35, 55, 75))
        restored = Image.new('RGB', (256, 256), (39, 60, 78))
        self.assertEqual(stable.process(source, restored).tobytes(), restored.tobytes())
        cut = Image.new('RGB', (64, 64), (210, 190, 170))
        new_picture = Image.new('RGB', (256, 256), (215, 191, 168))
        self.assertEqual(stable.process(cut, new_picture).tobytes(), new_picture.tobytes())
        self.assertEqual(stable.metrics()['resets'], 1)

    def test_alternating_neural_texture_is_reduced_without_blending_source_frames(self):
        stable = TemporalResidual()
        source = Image.new('RGB', (64, 64), (100, 110, 120))
        base = np.asarray(source.resize((256, 256))).astype(np.int16)
        values, raw = [], []
        for frame in range(8):
            offset = 4 if frame % 2 == 0 else -4
            restored = Image.fromarray((base + offset).astype(np.uint8))
            result = np.asarray(stable.process(source, restored)).astype(np.int16)
            values.append(result[32:-32, 32:-32].mean())
            raw.append((base + offset)[32:-32, 32:-32].mean())
            self.assertLessEqual(int(np.abs(result - (base + offset)).max()), 6)
        self.assertLess(np.abs(np.diff(values)).mean(), np.abs(np.diff(raw)).mean() * .7)
        self.assertEqual(stable.metrics()['stabilizedFrames'], 7)

    def test_new_colored_object_rejects_previous_texture_in_its_interior(self):
        stable = TemporalResidual()
        first = np.full((96, 96, 3), 100, dtype=np.uint8)
        stable.process(Image.fromarray(first), Image.fromarray(np.full((384, 384, 3), 105, dtype=np.uint8)))
        second = first.copy(); second[30:66, 30:66] = [190, 65, 55]
        source = Image.fromarray(second)
        restored = source.resize((384, 384), Image.Resampling.LANCZOS)
        result = np.asarray(stable.process(source, restored))
        np.testing.assert_array_equal(result[150:230, 150:230], np.asarray(restored)[150:230, 150:230])

    def test_moving_source_texture_is_aligned_instead_of_dragging_the_picture(self):
        cv = cv2_module(); rng = np.random.default_rng(18)
        first = rng.integers(40, 160, (96, 128, 3), dtype=np.uint8)
        first = cv.GaussianBlur(first, (5, 5), 1)
        first[30:65, 45:80] = [190, 180, 165]
        second = cv.warpAffine(first, np.float32([[1, 0, 3], [0, 1, 0]]), (128, 96), borderMode=cv.BORDER_REFLECT)
        stable = TemporalResidual()
        source_a = Image.fromarray(first); source_b = Image.fromarray(second)
        size = (512, 384)
        restored_a = np.asarray(source_a.resize(size, Image.Resampling.LANCZOS)).astype(np.int16)
        restored_a[150:220, 195:265] += 5
        stable.process(source_a, Image.fromarray(np.clip(restored_a, 0, 255).astype(np.uint8)))
        restored_b = source_b.resize(size, Image.Resampling.LANCZOS)
        result = np.asarray(stable.process(source_b, restored_b)).astype(np.int16)
        correction = result - np.asarray(restored_b).astype(np.int16)
        self.assertGreater(stable.metrics()['meanConfidence'], .3)
        self.assertLessEqual(int(np.abs(correction).max()), 6)
        # The whole source image is never warped or averaged: where there was
        # no residual, source samples remain bit-exact after object motion.
        np.testing.assert_array_equal(result[40:80, 320:400], np.asarray(restored_b)[40:80, 320:400])

    def test_resize_resets_history_and_state_does_not_grow_with_duration(self):
        stable = TemporalResidual()
        for frame in range(40):
            stable.process(Image.new('RGB', (64, 64), (90, 100, 110)), Image.new('RGB', (256, 256), (92, 101, 110)))
        self.assertEqual(stable.previous_residual.nbytes, 256 * 256 * 3 * 2)
        self.assertEqual(stable.metrics()['stateFrames'], 1)
        new_picture = Image.new('RGB', (320, 180), (20, 30, 40))
        self.assertEqual(stable.process(Image.new('RGB', (80, 45), (20, 30, 40)), new_picture).tobytes(), new_picture.tobytes())
        self.assertEqual(stable.metrics()['resets'], 1)


if __name__ == '__main__':
    unittest.main()
