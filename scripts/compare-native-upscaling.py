"""Compare local finishing techniques on the real, immutable 720p pilot.

All video variants share one neural inference per frame and the same encoder,
clock, fit and audio. TTA is evaluated separately on three stills, never passed
off as a complete video. Measurements describe changes, not recovered detail.
"""
import contextlib
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import signal
import sys
import subprocess
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
options = argparse.ArgumentParser()
options.add_argument('--temporal', action='store_true')
temporal_experiment = options.parse_args().temporal
OUT = ROOT / ('output/qa/temporal-720-comparison' if temporal_experiment else 'output/qa/upscale-720-comparison')
sys.path.insert(0, str(ROOT / 'runtime'))
SOURCE = ROOT / 'output/qa/native-resolution/pilot-720/minimax-native-1280x736.mp4'
EXPECTED = '498e0a6eeff78f063cd3e55b8a26877912411ec0a9258a7fadb0db8a077c8ebd'
spec = importlib.util.spec_from_file_location('filmma_upscale', ROOT / 'runtime/filmma_upscale.py')
up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(up)
VARIANTS = {
    'lanczos': ('Lanczos', None, 0),
    'lanczos-sharp': ('Lanczos + enfoque suave', None, 0),
    'ai-texture-35': ('IA textura 35%', up.conservative_detail, .35),
    'ai-restore-65': ('IA restauracion 65%', up.restore_detail, .65),
    'ai-restore-85': ('IA restauracion 85%', up.restore_detail, .85),
}
stabilizer = None
if temporal_experiment:
    from filmma_temporal import TemporalResidual
    stabilizer = TemporalResidual()

    def temporal_finish(original, enhanced, size, strength):
        restored, metrics = up.restore_detail(original, enhanced, size, strength)
        stable = stabilizer.process(original, restored)
        restored.close()
        return stable, metrics

    VARIANTS = {'ai-restore-65': ('IA restauracion 65%', up.restore_detail, .65),
                'ai-temporal-65': ('IA restauracion estable 65%', temporal_finish, .65)}


def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, **kwargs)


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', path]).stdout)


def audio_hash(path):
    return run(['ffmpeg', '-v', 'error', '-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-']).stdout.decode().strip()


def save_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assert up.sha256(SOURCE) == EXPECTED
    assert up.doctor()['ready']
    # Exclusive creation makes this real experiment deliberate and non-repeating.
    state_path = OUT / 'comparison.json'
    with state_path.open('x') as f:
        json.dump({'status': 'starting', 'pid': os.getpid()}, f)
    state = {'status': 'running', 'pid': os.getpid(), 'source': str(SOURCE),
             'sourceSha256': EXPECTED, 'startedAt': time.time(), 'completedFrames': 0,
             'scope': '22 real frames; motion-aware residual comparison' if temporal_experiment else '22 real frames; TTA still comparison on frames 0, 11, 21 only',
             'methods': list(VARIANTS), 'metrics': {}, 'tta': []}
    started = time.monotonic()
    with up.exclusive_lock('generation'):
        frames_dir = OUT / 'source-frames'
        frames_dir.mkdir()
        run(['ffmpeg', '-v', 'error', '-threads', '2', '-i', SOURCE, '-map', '0:v:0',
             '-vf', 'scale=1280:736:out_range=pc', '-fps_mode', 'passthrough', frames_dir / '%03d.png'])
        frames = sorted(frames_dir.glob('*.png'))
        assert len(frames) == 22
        encoders, logs = {}, []
        previous_residual = {}
        for key in VARIANTS:
            (OUT / key).mkdir()
            log = (OUT / key / 'encode.log').open('wb')
            logs.append(log)
            encoders[key] = up.spawn(['ffmpeg', '-v', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                '-s:v', '3840x2160', '-framerate', '24', '-i', 'pipe:0', '-an', '-vf', up.OUTPUT_COLOR_FILTER,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-threads', '1', '-pix_fmt', 'yuv420p',
                '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                '-movflags', '+faststart', OUT / key / 'silent.mp4'], stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=log)
            state['metrics'][key] = {'sourceCycleMae': [], 'residualChangeMae': [], 'edgeEnergy': []}
        try:
            for index, path in enumerate(frames):
                original = Image.open(path).convert('RGB')
                neural_path = OUT / 'neural-current.png'
                inference_start = time.monotonic()
                up.run_capture([up.INSTALL / 'realesrgan-ncnn-vulkan', '-i', path, '-o', neural_path,
                    '-m', up.INSTALL / 'models', '-n', up.MANIFEST['model'], '-s', '4', '-t', '128',
                    '-g', '0', '-j', '1:1:1', '-f', 'png'], timeout=600)
                enhanced = Image.open(neural_path).convert('RGB')
                assert enhanced.size == (5120, 2944)
                content_size = (3756, 2160)
                base = original.resize(content_size, Image.Resampling.LANCZOS)
                source_array = np.asarray(original, dtype=np.float32)
                for key, (label, processor, strength) in VARIANTS.items():
                    finished = (processor(original, enhanced, content_size, strength)[0] if processor
                                else base.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=3))
                                if key == 'lanczos-sharp' else base.copy())
                    small = np.asarray(finished.resize(original.size, Image.Resampling.LANCZOS), dtype=np.float32)
                    residual = (small - source_array).mean(axis=2)
                    metric = state['metrics'][key]
                    metric['sourceCycleMae'].append(float(np.abs(small - source_array).mean()))
                    if key in previous_residual:
                        metric['residualChangeMae'].append(float(np.abs(residual - previous_residual[key]).mean()))
                    previous_residual[key] = residual
                    gray = np.asarray(finished.resize((1252, 720)), dtype=np.float32).mean(axis=2)
                    metric['edgeEnergy'].append(float(np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean()))
                    canvas = Image.new('RGB', (3840, 2160))
                    canvas.paste(finished, (42, 0))
                    encoders[key].stdin.write(canvas.tobytes())
                    if index in (0, 11, 21):
                        canvas.save(OUT / key / f'frame-{index:03d}.png', compress_level=2)
                    finished.close()
                    canvas.close()
                if index in (0, 11, 21) and not temporal_experiment:
                    tta_path = OUT / f'tta-neural-{index:03d}.png'
                    tta_start = time.monotonic()
                    up.run_capture([up.INSTALL / 'realesrgan-ncnn-vulkan', '-i', path, '-o', tta_path,
                        '-m', up.INSTALL / 'models', '-n', up.MANIFEST['model'], '-s', '4', '-t', '128',
                        '-g', '0', '-j', '1:1:1', '-x', '-f', 'png'], timeout=600)
                    with Image.open(tta_path) as tta:
                        finished, _ = up.restore_detail(original, tta.convert('RGB'), content_size, .65)
                    canvas = Image.new('RGB', (3840, 2160))
                    canvas.paste(finished, (42, 0))
                    canvas.save(OUT / f'tta-restore-65-frame-{index:03d}.png', compress_level=2)
                    state['tta'].append({'frame': index, 'wallSeconds': round(time.monotonic() - tta_start, 3)})
                    finished.close()
                    canvas.close()
                    # The full neural still is useful evidence for repeatable review.
                enhanced.close()
                original.close()
                base.close()
                neural_path.unlink()
                state.update(completedFrames=index + 1, elapsedSeconds=round(time.monotonic() - started, 3))
                save_json(state_path, state)
                print(json.dumps({'frame': index + 1, 'frames': 22, 'elapsedSeconds': state['elapsedSeconds'],
                                  'inferenceAndComparisonSeconds': round(time.monotonic() - inference_start, 3)}), flush=True)
            for encoder in encoders.values():
                encoder.stdin.close()
                encoder.wait(timeout=180)
                assert encoder.returncode == 0
                up.CHILDREN.discard(encoder)
            source_audio = audio_hash(SOURCE)
            for key in VARIANTS:
                target = OUT / key / 'Filmma-720-a-4K.mp4'
                run(['ffmpeg', '-v', 'error', '-n', '-i', OUT / key / 'silent.mp4', '-i', SOURCE,
                     '-map', '0:v:0', '-map', '1:a?', '-c', 'copy', '-movflags', '+faststart', target])
                media = probe(target)
                video = next(x for x in media['streams'] if x['codec_type'] == 'video')
                assert (video['width'], video['height'], int(video['nb_read_frames'])) == (3840, 2160, 22)
                assert video['avg_frame_rate'] == '24/1' and abs(float(video['duration']) - 22/24) < .00001
                assert audio_hash(target) == source_audio
                run(['ffmpeg', '-v', 'error', '-xerror', '-hwaccel', 'none', '-threads', '2', '-i', target, '-f', 'null', '-'])
                save_json(OUT / key / 'verification.json', {'video': video, 'sha256': up.sha256(target),
                    'originalAudioPacketsPreserved': True, 'fullDecodePassed': True, 'sourceSha256': EXPECTED})
            for key, values in state['metrics'].items():
                state['metrics'][key] = {name: {'mean': round(float(np.mean(v)), 6), 'max': round(float(np.max(v)), 6)} for name, v in values.items()}
            assert up.sha256(SOURCE) == EXPECTED
            if stabilizer:
                state['temporalMetrics'] = stabilizer.metrics()
            state.update(status='verified', elapsedSeconds=round(time.monotonic() - started, 3),
                sourcePreserved=True, peakWorkerRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                peakChildRssBytes=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
                memoryLimit='Separate process RSS maxima, not simultaneous total GPU or unified memory.',
                qualityLimit='No high-resolution ground truth. Edge energy is not quality. Residual change is unregistered and includes motion; 0.92s of one object cannot certify faces or long-video continuity.')
            save_json(state_path, state)
        finally:
            up.stop_children()
            for log in logs:
                log.close()


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, up.cancelled)
    signal.signal(signal.SIGINT, up.cancelled)
    try:
        main()
    except BaseException as error:
        record = OUT / 'comparison.json'
        if record.exists():
            state = json.loads(record.read_text())
            state.update(status='failed', error=repr(error), originalsPreserved=up.sha256(SOURCE) == EXPECTED)
            save_json(record, state)
        raise
    finally:
        up.stop_children()
