"""Bounded, motion-aware filtering of restoration residuals, never whole frames.

Farneback flow and forward/backward consistency use low-resolution source
frames. Only the neural residual is warped; the current source, framing and
clock are untouched. Occlusion/photometric gates and a strict RGB update bound
limit trails. This does not guarantee character identity or repair generation.
"""
from pathlib import Path
import sys

OPENCV_VERSION = '4.11.0'


def cv2_module():
    directory = Path(__file__).resolve().parent / 'vendor/upscaler/python'
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))
    import cv2
    if cv2.__version__ != OPENCV_VERSION:
        raise ImportError('Se requiere OpenCV 4.11.0 para el acabado estable.')
    cv2.setNumThreads(2)
    return cv2


class TemporalResidual:
    """Two-frame state with O(frame pixels) memory; no frame-count growth."""
    def __init__(self):
        self.cv = cv2_module()
        self.previous_gray = None
        self.previous_source = None
        self.previous_residual = None
        self.stats = {'frames': 0, 'stabilizedFrames': 0, 'resets': 0,
                      'confidenceSum': 0., 'maxTemporalChangeRgb': 0}

    def process(self, original, restored):
        import numpy as np
        from PIL import Image
        cv = self.cv
        size = restored.size
        scale = min(1., 960 / max(original.size))
        flow_size = (max(16, round(original.width * scale)), max(16, round(original.height * scale)))
        source = np.asarray(original.resize(flow_size, Image.Resampling.BILINEAR))
        gray = cv.cvtColor(source, cv.COLOR_RGB2GRAY)
        self.stats['frames'] += 1
        current = np.asarray(restored)
        base = original.resize(size, Image.Resampling.LANCZOS)
        output = np.empty_like(current)
        next_residual = np.empty(current.shape, dtype=np.int16)
        confidence = None
        map_x = map_y = None
        if self.previous_gray is not None and self.previous_gray.shape == gray.shape and self.previous_residual.shape == current.shape:
            # Never carry texture across a large scene/lighting discontinuity.
            difference = np.abs(source.astype(np.int16) - self.previous_source.astype(np.int16)).mean()
            if difference < 32:
                backward = cv.calcOpticalFlowFarneback(gray, self.previous_gray, None, .5, 3, 19, 4, 5, 1.1, 0)
                forward = cv.calcOpticalFlowFarneback(self.previous_gray, gray, None, .5, 3, 19, 4, 5, 1.1, 0)
                grid_y, grid_x = np.mgrid[:gray.shape[0], :gray.shape[1]].astype(np.float32)
                old_x, old_y = grid_x + backward[:, :, 0], grid_y + backward[:, :, 1]
                forward_at_old = cv.remap(forward, old_x, old_y, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT)
                consistency = np.linalg.norm(backward + forward_at_old, axis=2)
                old_source = cv.remap(self.previous_source, old_x, old_y, cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT)
                photometric = np.abs(source.astype(np.float32) - old_source.astype(np.float32)).mean(axis=2)
                inside = (old_x >= 2) & (old_y >= 2) & (old_x < gray.shape[1] - 3) & (old_y < gray.shape[0] - 3)
                confidence = np.exp(-photometric ** 2 / 36) * np.clip(1 - consistency / 1.0, 0, 1) * inside
                confidence[photometric > 10] = 0
                if float(confidence.mean()) < .25:
                    confidence = None
                else:
                    # Keep maps as float32 and residuals as int16, independent
                    # of movie duration. Process the RGB output in row strips.
                    displacement = cv.resize(backward, size, interpolation=cv.INTER_LINEAR)
                    map_x = displacement[:, :, 0] * (size[0] / flow_size[0]) + np.arange(size[0], dtype=np.float32)[None, :]
                    map_y = displacement[:, :, 1] * (size[1] / flow_size[1]) + np.arange(size[1], dtype=np.float32)[:, None]
                    confidence = cv.resize(confidence.astype(np.float32), size, interpolation=cv.INTER_LINEAR)
                    self.stats['stabilizedFrames'] += 1
                    self.stats['confidenceSum'] += float(confidence.mean())
            if confidence is None:
                self.stats['resets'] += 1
        elif self.previous_gray is not None:
            self.stats['resets'] += 1
        for top in range(0, size[1], 128):
            bottom = min(top + 128, size[1])
            b = np.asarray(base.crop((0, top, size[0], bottom)), dtype=np.int16)
            now = current[top:bottom].astype(np.int16)
            residual = now - b
            if confidence is not None:
                previous = cv.remap(self.previous_residual, map_x[top:bottom], map_y[top:bottom], cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT)
                correction = np.rint(np.clip(previous - residual, -12, 12) * (.45 * confidence[top:bottom, :, None])).astype(np.int16)
                self.stats['maxTemporalChangeRgb'] = max(self.stats['maxTemporalChangeRgb'], int(np.abs(correction).max()))
                now = np.clip(now + correction, 0, 255)
                residual = now - b
            output[top:bottom] = now
            next_residual[top:bottom] = residual
        base.close()
        self.previous_gray = gray.copy()
        self.previous_source = source.copy()
        self.previous_residual = next_residual
        return Image.fromarray(output)

    def metrics(self):
        return {**{key: value for key, value in self.stats.items() if key != 'confidenceSum'},
                'meanConfidence': round(self.stats['confidenceSum'] / max(1, self.stats['stabilizedFrames']), 6),
                'maxPreviousWeight': .45, 'maximumRgbUpdate': 6,
                'stateFrames': 1, 'flowMaxDimension': 960,
                'method': 'Farneback bidirectional consistency; photometric/occlusion gating; residual only',
                'limit': 'Not a face/identity detector. A lower residual variation is not proof of perceptual quality or absence of trails.'}
