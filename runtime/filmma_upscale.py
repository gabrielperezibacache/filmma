#!/usr/bin/env python3
"""Bounded local Real-ESRGAN video worker for Filmma.

The parent server validates/remuxes the original audio. This worker produces a
silent, CFR H.264 derivative; it never writes the source. Exactly one decoded
frame and one native 4x PNG are on disk at a time. The shared generation lock
excludes MiniMax/LTX inference for the entire operation.
"""
import argparse
import contextlib
import fcntl
import hashlib
import importlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from fractions import Fraction

RUNTIME = Path(__file__).resolve().parent
MANIFEST = json.loads((RUNTIME / 'upscale-model.json').read_text())
INSTALL = RUNTIME / 'vendor' / 'upscaler'
MAX_INPUT_PIXELS = 1920 * 1080
MAX_OUTPUT_PIXELS = 3840 * 2160
MAX_DURATION = 15.001
RESERVE_BYTES = 2 * 1024**3
OUTPUT_COLOR_FILTER = 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
CHILDREN = set()


def temporal_status():
    try:
        from filmma_temporal import cv2_module
        version = cv2_module().__version__
        return {'ready': True, 'version': version, 'message': 'Estabilización local del detalle preparada.'}
    except (ImportError, OSError) as error:
        return {'ready': False, 'message': 'Prepara el acabado estable para añadir su componente local (38 MB).', 'detail': str(error)}


def setup_temporal():
    if temporal_status()['ready']:
        return
    dependency = json.loads((RUNTIME / 'temporal-dependency.json').read_text())
    if platform.machine() not in dependency['architectures']:
        raise UpscaleError('UNSUPPORTED_PLATFORM', 'El acabado estable preparado requiere Apple Silicon.')
    if shutil.disk_usage(INSTALL).free < RESERVE_BYTES:
        raise UpscaleError('INSUFFICIENT_DISK', 'Se necesitan 2 GiB libres para preparar el acabado estable.')
    wheel = INSTALL / dependency['filename']
    if not wheel.is_file() or sha256(wheel) != dependency['sha256']:
        partial = wheel.with_suffix('.part')
        emit('progress', progress=10, message='Preparando el componente local para conservar detalle entre fotogramas.')
        try:
            with urllib.request.urlopen(dependency['url'], timeout=45) as response, partial.open('wb') as output:
                size = 0
                while True:
                    chunk = response.read(1024**2)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > dependency['bytes']:
                        raise UpscaleError('INTEGRITY_ERROR', 'El componente tiene un tamaño inesperado.')
                    output.write(chunk)
            if partial.stat().st_size != dependency['bytes'] or sha256(partial) != dependency['sha256']:
                raise UpscaleError('INTEGRITY_ERROR', 'La huella del componente no coincide con la versión fijada.')
            os.replace(partial, wheel)
        finally:
            partial.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='temporal-install-', dir=INSTALL) as temporary:
        staged = Path(temporary) / 'python'
        run_capture([sys.executable, '-m', 'pip', 'install', '--no-deps', '--no-compile', '--disable-pip-version-check', '--target', staged, wheel], timeout=180)
        destination = INSTALL / 'python'
        if destination.exists():
            # Preserve a previous installation for diagnostics, never delete it.
            os.rename(destination, INSTALL / ('python-previous-' + str(time.time_ns())))
        os.replace(staged, destination)
    importlib.invalidate_caches()
    if not temporal_status()['ready']:
        raise UpscaleError('TEMPORAL_NOT_READY', 'El componente estable no se pudo activar. El reescalado anterior sigue disponible.')


class UpscaleError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


def emit(event, **data):
    print(json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


@contextlib.contextmanager
def exclusive_lock(name):
    with (RUNTIME / ('.' + name + '.lock')).open('a+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise UpscaleError('RUNTIME_BUSY', 'La GPU local está ocupada. Espera a que termine la generación o el reescalado actual.')
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def gpu_busy():
    try:
        with exclusive_lock('generation'):
            return False
    except UpscaleError:
        return True


def doctor():
    supported = platform.system() == 'Darwin' and platform.machine() in MANIFEST['architectures']
    missing, errors = [], []
    for entry in MANIFEST['files']:
        path = INSTALL / entry['path']
        if not path.is_file():
            missing.append(entry['path'])
        elif path.stat().st_size != entry['bytes'] or sha256(path) != entry['sha256']:
            errors.append('Integridad no válida: ' + entry['path'])
        elif entry.get('executable') and not os.access(path, os.X_OK):
            errors.append('Motor sin permiso de ejecución.')
    installed = not missing and not errors
    for dependency in ('PIL', 'numpy'):
        if importlib.util.find_spec(dependency) is None:
            errors.append('Falta la dependencia Python ' + dependency + '.')
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        errors.append('Faltan FFmpeg o FFprobe en el entorno local.')
    ready = supported and installed and not errors
    status = 'ready' if ready else ('unsupported' if not supported else 'error' if errors else 'missing')
    message = ('IA local lista: Real-ESRGAN fotográfico, un fotograma cada vez.' if ready else
               'Este motor requiere macOS en Apple Silicon o Intel.' if not supported else
               '; '.join(errors) if errors else 'Prepara el motor local de mejora de detalle (52 MB).')
    temporal = temporal_status()
    return {'ok': True, 'available': ready, 'ready': ready, 'installed': installed,
            'supported': supported, 'status': status, 'message': message,
            'platform': platform.system(), 'architecture': platform.machine(),
            'model': MANIFEST['model'], 'version': MANIFEST['version'],
            'engine': MANIFEST['engine'], 'engineVersion': MANIFEST['engineVersion'],
            'modelSha256': MANIFEST['files'][1]['sha256'],
            'tile': MANIFEST['tile'], 'gpuBusy': gpu_busy(), 'missing': missing,
            'errors': errors, 'downloadBytes': 0 if installed else MANIFEST['archive']['bytes'],
            'profile': {'tile': MANIFEST['tile'], 'strength': MANIFEST['defaultStrength']},
            'nativeScale': 4, 'temporalMode': MANIFEST['temporalMode'], 'temporalAvailable': ready and temporal['ready'], 'temporal': temporal}


def setup(temporal=False):
    with exclusive_lock('upscaler-setup'):
        state = doctor()
        if not state['supported']:
            raise UpscaleError('UNSUPPORTED_PLATFORM', state['message'])
        INSTALL.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUNTIME / 'upscale-LICENSES.txt', INSTALL / 'LICENSES.txt')
        if state['installed']:
            if temporal:
                setup_temporal()
            return doctor()
        if shutil.disk_usage(INSTALL).free < RESERVE_BYTES:
            raise UpscaleError('INSUFFICIENT_DISK', 'Se necesitan 2 GiB libres para preparar el motor local.')
        archive = INSTALL / 'realesrgan-20220424-macos.zip'
        expected = MANIFEST['archive']
        if not archive.is_file() or archive.stat().st_size != expected['bytes'] or sha256(archive) != expected['sha256']:
            partial = archive.with_suffix('.zip.part')
            request = urllib.request.Request(expected['url'], headers={'User-Agent': 'Filmma/1.0'})
            emit('progress', progress=2, message='Descargando el motor y los pesos oficiales de mejora de detalle.')
            try:
                with urllib.request.urlopen(request, timeout=45) as response, partial.open('wb') as output:
                    size = 0
                    while True:
                        block = response.read(1024**2)
                        if not block:
                            break
                        output.write(block)
                        size += len(block)
                        if size > expected['bytes']:
                            raise UpscaleError('INTEGRITY_ERROR', 'La descarga tiene un tamaño inesperado.')
                        emit('progress', progress=min(85, round(size / expected['bytes'] * 85)), message='Preparando la IA local de detalle.')
                if partial.stat().st_size != expected['bytes'] or sha256(partial) != expected['sha256']:
                    raise UpscaleError('INTEGRITY_ERROR', 'La descarga no coincide con la versión verificada del motor.')
                os.replace(partial, archive)
            finally:
                partial.unlink(missing_ok=True)
        emit('progress', progress=90, message='Verificando los pesos y el motor para Apple Silicon.')
        # Extract only named, pinned files; never unpack arbitrary archive paths.
        with zipfile.ZipFile(archive) as package:
            for entry in MANIFEST['files']:
                target = INSTALL / entry['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                data = package.read(entry['path'])
                if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise UpscaleError('INTEGRITY_ERROR', 'Un componente no coincide con su huella verificada.', path=entry['path'])
                temporary = target.with_suffix(target.suffix + '.tmp')
                temporary.write_bytes(data)
                temporary.chmod(0o755 if entry.get('executable') else 0o644)
                os.replace(temporary, target)
        if temporal:
            setup_temporal()
        return doctor()


def spawn(args, **kwargs):
    child = subprocess.Popen([str(arg) for arg in args], start_new_session=True, **kwargs)
    CHILDREN.add(child)
    return child


def stop_children():
    for child in list(CHILDREN):
        if child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGTERM)
    # Node's cancellation escalates after 2.5 s. Use one global grace period,
    # not one timeout per child, so no independent NCNN process outlives us.
    deadline = time.monotonic() + 1
    while any(child.poll() is None for child in CHILDREN) and time.monotonic() < deadline:
        time.sleep(0.02)
    for child in list(CHILDREN):
        if child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGKILL)
    reap_deadline = time.monotonic() + .5
    for child in list(CHILDREN):
        with contextlib.suppress(subprocess.TimeoutExpired):
            child.wait(timeout=max(.01, reap_deadline - time.monotonic()))
        if child.poll() is not None:
            CHILDREN.discard(child)


def cancelled(_signal, _frame):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    raise UpscaleError('CANCELLED', 'Mejora de detalle cancelada; se conserva el original.')


def run_capture(args, timeout=45):
    child = spawn(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        raise UpscaleError('PROCESS_TIMEOUT', 'Una etapa de la mejora de detalle superó su tiempo máximo.')
    finally:
        if child.poll() is not None:
            CHILDREN.discard(child)
    if child.returncode:
        raise UpscaleError('PROCESS_FAILED', 'No se pudo completar una etapa de la mejora de detalle.', log=stderr.decode(errors='replace')[-3500:])
    return stdout


def target_dimensions(width, height, long_edge=3840):
    scale = min(long_edge / max(width, height), math.sqrt(MAX_OUTPUT_PIXELS / (width * height)))
    return max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)


def inspect_video(source, ffprobe):
    metadata = json.loads(run_capture([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', source]))
    videos = [stream for stream in metadata.get('streams', []) if stream.get('codec_type') == 'video' and not stream.get('disposition', {}).get('attached_pic')]
    if len(videos) != 1:
        raise UpscaleError('INVALID_SOURCE', 'Selecciona un archivo con una única pista de video.')
    video = videos[0]
    advertised_duration = float(video.get('duration') or metadata.get('format', {}).get('duration') or 0)
    if advertised_duration > MAX_DURATION:
        raise UpscaleError('DURATION_LIMIT', 'La mejora por toma admite un máximo de 15 segundos.')
    if video.get('color_transfer') in ('smpte2084', 'arib-std-b67') or video.get('color_primaries') in ('bt2020',):
        raise UpscaleError('HDR_UNSUPPORTED', 'Esta mejora conserva video SDR. Convierte el HDR explícitamente antes de usarla.')
    if video.get('sample_aspect_ratio', '1:1') not in ('1:1', 'N/A', '0:1'):
        raise UpscaleError('ANAMORPHIC_UNSUPPORTED', 'Normaliza explícitamente los píxeles anamórficos antes de mejorar este video.')
    if abs(float(video.get('start_time', 0))) > 0.001:
        raise UpscaleError('START_TIME_UNSUPPORTED', 'El video debe comenzar en el instante cero.')
    width, height = int(video['width']), int(video['height'])
    rotation = next((float(side.get('rotation', 0)) for side in video.get('side_data_list', []) if 'rotation' in side), float(video.get('tags', {}).get('rotate', 0)))
    if abs(rotation % 90) > 0.001:
        raise UpscaleError('ROTATION_UNSUPPORTED', 'Normaliza la rotación del video antes de mejorarlo.')
    if round(rotation / 90) % 2:
        width, height = height, width
    if width < 2 or height < 2 or width * height > MAX_INPUT_PIXELS or max(width, height) > 1920:
        raise UpscaleError('INPUT_TOO_LARGE', 'El perfil de 36 GB admite fuentes de hasta 1920 × 1080 o su equivalente vertical, sin reducirlas de forma oculta.')
    if width % 2 or height % 2:
        raise UpscaleError('INVALID_DIMENSIONS', 'La fuente debe tener dimensiones pares.')
    try:
        fps = Fraction(video.get('avg_frame_rate', '0/1'))
    except (ValueError, ZeroDivisionError):
        raise UpscaleError('INVALID_FRAMERATE', 'No se pudo determinar la frecuencia de fotogramas.')
    if not 0 < fps <= 60:
        raise UpscaleError('INVALID_FRAMERATE', 'El perfil admite hasta 60 fotogramas por segundo.')
    data = json.loads(run_capture([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', source]))
    timestamps = [float(frame['best_effort_timestamp_time']) for frame in data.get('frames', []) if 'best_effort_timestamp_time' in frame]
    if not timestamps or len(timestamps) > 900:
        raise UpscaleError('INVALID_FRAMES', 'La mejora admite hasta 900 fotogramas por toma.')
    period = float(1 / fps)
    tolerance = max(0.0002, period * 0.005)
    if any(abs((current - previous) - period) > tolerance for previous, current in zip(timestamps, timestamps[1:])):
        raise UpscaleError('VFR_UNSUPPORTED', 'El video tiene fotogramas de duración variable. Normaliza la frecuencia antes de mejorarlo.')
    duration = len(timestamps) / float(fps)
    if duration > MAX_DURATION:
        raise UpscaleError('DURATION_LIMIT', 'La mejora por toma admite un máximo de 15 segundos.')
    return {'width': width, 'height': height, 'frames': len(timestamps), 'fps': fps, 'duration': duration}


def conservative_detail(original, enhanced, size, strength):
    """Retain original geometry/color and add bounded AI high-frequency detail.

    No neighboring frames, face reconstruction or generative prompt are used.
    Processing in row blocks avoids multiple full-resolution float buffers.
    This reduces drift but cannot guarantee identity or absence of flicker.
    """
    from PIL import Image, ImageFilter
    import numpy as np
    base = original.resize(size, Image.Resampling.LANCZOS)
    ai = enhanced.resize(size, Image.Resampling.LANCZOS)
    radius = max(0.5, 2 * max(size) / 3840)
    base_blur = base.filter(ImageFilter.GaussianBlur(radius))
    ai_blur = ai.filter(ImageFilter.GaussianBlur(radius))
    output = Image.new('RGB', size)
    max_difference, total_difference, samples = 0, 0, 0
    for top in range(0, size[1], 128):
        box = (0, top, size[0], min(top + 128, size[1]))
        b = np.asarray(base.crop(box), dtype=np.int16)
        a = np.asarray(ai.crop(box), dtype=np.int16)
        low = np.asarray(ai_blur.crop(box), dtype=np.int16) - np.asarray(base_blur.crop(box), dtype=np.int16)
        residual = np.clip(a - b - low, -24, 24)
        detail = np.rint(residual.astype(np.float32) * strength).astype(np.int16)
        result = np.clip(b + detail, 0, 255).astype(np.uint8)
        difference = np.abs(result.astype(np.int16) - b)
        max_difference = max(max_difference, int(difference.max()))
        total_difference += int(difference.sum())
        samples += difference.size
        output.paste(Image.fromarray(result), box[:2])
    base.close()
    ai.close()
    base_blur.close()
    ai_blur.close()
    return output, {'maxRgbDifference': max_difference, 'meanRgbDifference': total_difference / samples}


def restore_detail(original, enhanced, size, strength):
    """Blend the neural reconstruction while preserving broad source color.

    Unlike the conservative profile, this retains the model's edge changes
    instead of only a bounded, very high-frequency residual. Its details are
    inferred, not recovered ground truth. Independent frames can still flicker.
    Full-frame buffers remain RGB8; float calculations use bounded row blocks.
    """
    from PIL import Image, ImageFilter
    import numpy as np
    base = original.resize(size, Image.Resampling.LANCZOS)
    ai = enhanced.resize(size, Image.Resampling.LANCZOS)
    # The reviewed 3642px sample used radius 32. Scale it with output geometry.
    radius = max(0.5, 32 * max(size) / 3642)
    base_blur = base.filter(ImageFilter.GaussianBlur(radius))
    ai_blur = ai.filter(ImageFilter.GaussianBlur(radius))
    output = Image.new('RGB', size)
    max_difference, total_difference, samples = 0, 0, 0
    for top in range(0, size[1], 128):
        box = (0, top, size[0], min(top + 128, size[1]))
        b = np.asarray(base.crop(box), dtype=np.float32)
        a = np.asarray(ai.crop(box), dtype=np.float32)
        low = np.asarray(ai_blur.crop(box), dtype=np.float32) - np.asarray(base_blur.crop(box), dtype=np.float32)
        corrected = a - low
        result = np.rint(np.clip(b * (1 - strength) + corrected * strength, 0, 255)).astype(np.uint8)
        difference = np.abs(result.astype(np.int16) - b.astype(np.int16))
        max_difference = max(max_difference, int(difference.max()))
        total_difference += int(difference.sum())
        samples += difference.size
        output.paste(Image.fromarray(result), box[:2])
    base.close()
    ai.close()
    base_blur.close()
    ai_blur.close()
    return output, {'maxRgbDifference': max_difference, 'meanRgbDifference': total_difference / samples}


def read_exact(stream, length):
    parts, remaining = [], length
    while remaining:
        part = stream.read(remaining)
        if not part:
            break
        parts.append(part)
        remaining -= len(part)
    result = b''.join(parts)
    if result and len(result) != length:
        raise UpscaleError('TRUNCATED_FRAME', 'El decodificador produjo un fotograma incompleto.')
    return result


def upscale(request):
    with exclusive_lock('generation'):
        return _upscale(request)


def _upscale(request):
    processing_profile = request.get('processingProfile', 'conservative')
    if processing_profile not in ('conservative', 'restore', 'temporal'):
        raise UpscaleError('INVALID_PROCESSING_PROFILE', 'Elige un perfil de mejora válido: conservador o restauración.')
    detail_processor = restore_detail if processing_profile in ('restore', 'temporal') else conservative_detail
    state = doctor()
    if not state['ready']:
        raise UpscaleError('UPSCALER_NOT_READY', state['message'])
    stabilizer = None
    if processing_profile == 'temporal':
        if not state.get('temporalAvailable'):
            raise UpscaleError('TEMPORAL_NOT_READY', 'Prepara primero el acabado estable; las versiones anteriores siguen disponibles.')
        from filmma_temporal import TemporalResidual
        stabilizer = TemporalResidual()
    from PIL import Image
    source = Path(request['source']).expanduser().resolve(strict=True)
    destination = Path(request['destination']).expanduser().resolve()
    if source == destination or destination.exists():
        raise UpscaleError('OUTPUT_EXISTS', 'La mejora necesita un archivo de salida nuevo para conservar el original.')
    strength = float(request.get('strength', MANIFEST['defaultStrength']))
    if not math.isfinite(strength) or not 0 <= strength <= 1:
        raise UpscaleError('INVALID_STRENGTH', 'La intensidad debe estar entre 0 y 1.')
    long_edge = int(request.get('targetLongEdge', 3840))
    if long_edge < 32 or long_edge > 3840:
        raise UpscaleError('INVALID_DIMENSIONS', 'La salida admite hasta 3840 píxeles en su lado mayor.')
    ffmpeg = str(request.get('ffmpeg') or shutil.which('ffmpeg'))
    ffprobe = str(request.get('ffprobe') or shutil.which('ffprobe'))
    original_stat = source.stat()
    original_hash = sha256(source)
    media = inspect_video(source, ffprobe)
    width, height, frames, fps = media['width'], media['height'], media['frames'], media['fps']
    target_width, target_height = target_dimensions(width, height, long_edge)
    if request.get('targetWidth', target_width) != target_width or request.get('targetHeight', target_height) != target_height:
        raise UpscaleError('INVALID_DIMENSIONS', 'Las dimensiones solicitadas no conservan el encuadre dentro del perfil 4K.')
    for name in ('width', 'height', 'frames'):
        if request.get(name, media[name]) != media[name]:
            raise UpscaleError('SOURCE_CHANGED', 'Las características del original cambiaron antes de iniciar la mejora.')
    if 'fpsNumerator' in request and Fraction(int(request['fpsNumerator']), int(request['fpsDenominator'])) != fps:
        raise UpscaleError('SOURCE_CHANGED', 'La frecuencia del original cambió antes de iniciar la mejora.')
    work_parent = Path(request.get('workDirectory', str(destination.parent))).expanduser().resolve()
    work_parent.mkdir(parents=True, exist_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(work_parent).free < RESERVE_BYTES or shutil.disk_usage(destination.parent).free < RESERVE_BYTES:
        raise UpscaleError('INSUFFICIENT_DISK', 'Se necesitan al menos 2 GiB libres para crear la versión mejorada.')
    started = time.monotonic()
    peak_difference, mean_difference = 0, 0.0
    frame_count = 0
    try:
        with tempfile.TemporaryDirectory(prefix='filmma-detail-', dir=work_parent) as work, \
                tempfile.TemporaryDirectory(prefix='.filmma-detail-output-', dir=destination.parent) as outwork:
            directory = Path(work)
            staged_output = Path(outwork) / 'silent.mp4'
            input_png, output_png = directory / 'input.png', directory / 'upscaled.png'
            with (directory / 'decode.log').open('wb') as decode_log, (directory / 'encode.log').open('wb') as encode_log:
                decoder = spawn([ffmpeg, '-hide_banner', '-loglevel', 'error', '-threads', '2', '-i', source,
                                 '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', f'scale={width}:{height}:out_range=pc,setsar=1',
                                 '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
                                stdout=subprocess.PIPE, stderr=decode_log)
                encoder = spawn([ffmpeg, '-hide_banner', '-loglevel', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                                 '-s:v', f'{target_width}x{target_height}', '-framerate', f'{fps.numerator}/{fps.denominator}',
                                 '-i', 'pipe:0', '-an', '-vf', OUTPUT_COLOR_FILTER,
                                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '16',
                                 '-threads', '2', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                                 '-colorspace', 'bt709', '-movflags', '+faststart', staged_output],
                                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=encode_log)
                emit('progress', progress=1, message='Mejorando detalle con IA local; se conservan encuadre y duración.', frames=frames, width=target_width, height=target_height)
                while True:
                    raw = read_exact(decoder.stdout, width * height * 3)
                    if not raw:
                        break
                    if frame_count >= frames:
                        raise UpscaleError('FRAME_COUNT_CHANGED', 'La decodificación produjo más fotogramas que el original inspeccionado.')
                    original = Image.frombytes('RGB', (width, height), raw)
                    original.save(input_png, format='PNG', compress_level=1)
                    run_capture([INSTALL / 'realesrgan-ncnn-vulkan', '-i', input_png, '-o', output_png,
                                 '-m', INSTALL / 'models', '-n', MANIFEST['model'], '-s', '4', '-t', str(MANIFEST['tile']),
                                 '-g', '0', '-j', MANIFEST['threads'], '-f', 'png'], timeout=600)
                    with Image.open(output_png) as enhanced:
                        if enhanced.size != (width * 4, height * 4):
                            raise UpscaleError('INVALID_AI_OUTPUT', 'El motor no produjo el reescalado nativo 4× esperado.')
                        enhanced_rgb = enhanced.convert('RGB')
                        finished, drift = detail_processor(original, enhanced_rgb, (target_width, target_height), strength)
                        enhanced_rgb.close()
                    if stabilizer:
                        stable = stabilizer.process(original, finished)
                        finished.close()
                        finished = stable
                    encoder.stdin.write(finished.tobytes())
                    finished.close()
                    original.close()
                    input_png.unlink()
                    output_png.unlink()
                    frame_count += 1
                    peak_difference = max(peak_difference, drift['maxRgbDifference'])
                    mean_difference += drift['meanRgbDifference']
                    elapsed = time.monotonic() - started
                    emit('progress', progress=min(96, round(frame_count / frames * 96)), frame=frame_count, frames=frames,
                         elapsedSeconds=round(elapsed, 3), estimatedRemainingSeconds=round(elapsed / frame_count * (frames - frame_count)),
                         message=f'Mejora de detalle · fotograma {frame_count} de {frames}')
                decoder.stdout.close()
                decoder.wait(timeout=30)
                CHILDREN.discard(decoder)
                if decoder.returncode or frame_count != frames:
                    raise UpscaleError('DECODE_FAILED', 'No se pudieron conservar todos los fotogramas del original.', expected=frames, actual=frame_count)
                encoder.stdin.close()
                encoder.wait(timeout=120)
                CHILDREN.discard(encoder)
                if encoder.returncode:
                    raise UpscaleError('ENCODE_FAILED', 'No se pudo guardar la versión 4K.', log=(directory / 'encode.log').read_text(errors='replace')[-3500:])
            current_stat = source.stat()
            if original_stat.st_size != current_stat.st_size or original_stat.st_mtime_ns != current_stat.st_mtime_ns or sha256(source) != original_hash:
                raise UpscaleError('SOURCE_CHANGED', 'El original cambió durante la mejora. La versión derivada no se guardará.')
            result_media = inspect_output(staged_output, ffprobe)
            if result_media['width'] != target_width or result_media['height'] != target_height or result_media['frames'] != frames or result_media['fps'] != fps:
                raise UpscaleError('INVALID_OUTPUT', 'La salida no conservó las dimensiones, frecuencia o fotogramas esperados.')
            wall = time.monotonic() - started
            rss_factor = 1 if platform.system() == 'Darwin' else 1024
            result = {'ok': True, 'destination': str(destination), 'width': target_width, 'height': target_height,
                      'frames': frames, 'fps': float(fps), 'fpsNumerator': fps.numerator, 'fpsDenominator': fps.denominator,
                      'duration': media['duration'], 'sourceSha256': original_hash, 'hasAudio': False,
                      'model': MANIFEST['model'], 'version': MANIFEST['version'], 'modelSha256': state['modelSha256'],
                      'engine': MANIFEST['engine'], 'engineVersion': MANIFEST['engineVersion'],
                      'tile': MANIFEST['tile'], 'nativeScale': 4, 'strength': strength,
                      'processingProfile': processing_profile,
                      'temporalMode': 'motion-compensated-residual-v1' if stabilizer else 'frame-independent-color-preserving-v1' if processing_profile == 'restore' else MANIFEST['temporalMode'],
                      'resampleAfterAi': [target_width, target_height] != [width * 4, height * 4],
                      'metrics': {'wallSeconds': round(wall, 3), 'secondsPerFrame': round(wall / frames, 3),
                                  'peakChildRssBytes': resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * rss_factor,
                                  'peakWorkerRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * rss_factor,
                                  'maxRgbDifferenceBeforeEncoding': peak_difference,
                                  'meanRgbDifferenceBeforeEncoding': round(mean_difference / frames, 5),
                                  'memoryNote': 'RSS maxima are measured separately for the worker and largest child; they are not simultaneous total unified/GPU memory.',
                                  **({'temporal': stabilizer.metrics()} if stabilizer else {}),
                                  'qualityNote': ('RGB differences are measured before temporal filtering. Only neural residuals are motion-compensated with confidence gates and bounded updates; current source samples and frame clock are retained. Neural detail is inferred; stability metrics do not certify identity or absence of trails.' if stabilizer else
                                                  'RGB differences compare color-preserving neural restoration with Lanczos before encoding. Neural details are inferred; these differences do not prove quality, identity, temporal stability or recovered real detail.'
                                                  if processing_profile == 'restore' else
                                                  'RGB differences compare conservative AI output with Lanczos before encoding; they do not prove identity, temporal stability or recovered real detail.')}}
            # Same-volume atomic publish; fails rather than overwriting any file
            # that appeared after the initial existence check.
            os.link(staged_output, destination)
            return result
    finally:
        stop_children()


def inspect_output(path, ffprobe):
    data = json.loads(run_capture([ffprobe, '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_streams', '-of', 'json', path]))
    video = data['streams'][0]
    return {'width': int(video['width']), 'height': int(video['height']),
            'frames': int(video['nb_read_frames']), 'fps': Fraction(video['avg_frame_rate'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'setup', 'upscale'])
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--request')
    parser.add_argument('--temporal', action='store_true', help='Prepare the optional motion-aware finishing component.')
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    try:
        if args.command == 'doctor':
            print(json.dumps(doctor(), ensure_ascii=False), flush=True)
        elif args.command == 'setup':
            emit('result', **setup(temporal=args.temporal))
        else:
            if not args.request:
                raise UpscaleError('INVALID_REQUEST', 'Falta el archivo de solicitud.')
            request = json.loads(Path(args.request).read_text())
            emit('result', **upscale(request))
    except UpscaleError as exc:
        emit('error', ok=False, code=exc.code, message=exc.message, **exc.details)
        return 130 if exc.code == 'CANCELLED' else 1
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, BrokenPipeError) as exc:
        emit('error', ok=False, code='UPSCALE_FAILED', message='No se pudo completar la mejora local.', detail=str(exc))
        return 1
    finally:
        stop_children()
    return 0


if __name__ == '__main__':
    sys.exit(main())
