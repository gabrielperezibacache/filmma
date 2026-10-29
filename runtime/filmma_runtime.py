#!/usr/bin/env python3
"""Filmma local video worker. Standard library control plane; no mock generation.

The UI's server owns its queue. This worker runs exactly one real generation and
streams JSONL events; all third-party stdout is captured as progress. Model
weights are never fetched by generate/doctor. See docs/LOCAL_MODELS.md.
"""
import argparse
import contextlib
import concurrent.futures
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parent))
import portable_lock
import h3_quantized
from weight_residency import residency_plan

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / 'runtime'
CATALOG = json.loads((RUNTIME / 'model-catalog.json').read_text())
CONFIG_PATH = RUNTIME / 'local-config.json'
MIN_DISK_HEADROOM = 20 * 1024**3
MODEL_NAMES = {'minimax-h3': 'MiniMax H3 · Metal', 'ltx-2b': 'LTX Video 2B · MLX'}
MEMORY_PROFILES = ('conservative', 'h3-long-ssd', 'h3-native-ssd', 'h3-hd-ssd')
SUPERVISED_PROFILES = ('h3-long-ssd', 'h3-native-ssd', 'h3-hd-ssd')
LONG_PROFILE_LIMITS = {
    'maxFrames': 345, 'fps': 24, 'maxPixels': 512 * 320, 'maxDimension': 512,
    'maxSteps': 20, 'minMemoryGB': 32, 'maxProcessFootprintBytes': 24 * 1024**3,
    'maxProcessRssBytes': 28 * 1024**3, 'maxSwapGrowthBytes': 2 * 1024**3,
    'minFreePercentBeforeStart': 25, 'diskReserveBytes': MIN_DISK_HEADROOM,
    'warningSamplesBeforeStop': 3, 'sampleIntervalSeconds': 1,
}
NATIVE_PROFILE_LIMITS = {**LONG_PROFILE_LIMITS, 'maxFrames': 345, 'maxPixels': 1280 * 736, 'maxDimension': 1280, 'maxVideoTokens': 35000}
HD_PROFILE_LIMITS = {**NATIVE_PROFILE_LIMITS, 'maxVideoTokens': 93840, 'maxInferenceSeconds': 12 * 60 * 60}
SUPERVISED_LIMITS = {'h3-long-ssd': LONG_PROFILE_LIMITS, 'h3-native-ssd': NATIVE_PROFILE_LIMITS, 'h3-hd-ssd': HD_PROFILE_LIMITS}
EMIT_LOCK = threading.Lock()


class RuntimeFailure(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


class ModelRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            old = urllib.parse.urlsplit(req.full_url)
            new = urllib.parse.urlsplit(newurl)
            if (old.scheme, old.netloc) != (new.scheme, new.netloc):
                # Hugging Face redirects to signed CDN URLs. The optional Hub
                # token is only for the Hub and must not follow across origins.
                redirected.remove_header('Authorization')
        return redirected


def emit(event_type, **data):
    with EMIT_LOCK:
        print(json.dumps({'type': event_type, **data}, ensure_ascii=False), flush=True)


def config():
    try:
        value = json.loads(CONFIG_PATH.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def model_dir(model, override=None):
    env = 'FILMMA_H3_MODEL_DIR' if model == 'minimax-h3' else 'FILMMA_LTX_MODEL_DIR'
    value = override or os.environ.get(env) or config().get('models', {}).get(model, {}).get('directory')
    return Path(value or Path(os.environ.get('FILMMA_MODEL_ROOT', str(RUNTIME / 'models'))) / model).expanduser().resolve()


def executable(model):
    if model == 'minimax-h3':
        return Path(os.environ.get('FILMMA_H3_BIN', str(RUNTIME / 'vendor' / 'h3' / 'h3'))).expanduser()
    return Path(os.environ.get('FILMMA_LTX_PYTHON', str(RUNTIME / '.venv' / 'bin' / 'python')))


def engine_working_directory(model):
    """H3 resolves its Metal source beside the engine, independently of caller cwd."""
    if model != 'minimax-h3':
        return ROOT
    directory = executable(model).expanduser().resolve().parent
    shader = directory / 'h3_shaders.metal'
    if not shader.is_file() or shader.stat().st_size == 0:
        raise RuntimeFailure('RUNTIME_ASSET_MISSING',
                             'Falta el archivo Metal del motor MiniMax. Reinstala el motor local; los pesos se conservan.',
                             path=str(shader))
    return directory


def run_read(args, timeout=8):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def hardware():
    apple = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    mem = run_read(['sysctl', '-n', 'hw.memsize']) if platform.system() == 'Darwin' else None
    chip = run_read(['sysctl', '-n', 'machdep.cpu.brand_string']) if apple else platform.processor()
    if apple and (not mem or not chip):
        summary = run_read(['system_profiler', 'SPHardwareDataType', '-json'], timeout=16)
        try:
            info = json.loads(summary)['SPHardwareDataType'][0]
            chip = chip or info.get('chip_type')
            if not mem:
                mem = str(int(float(info.get('physical_memory', '').split()[0]) * 1024**3))
        except (TypeError, ValueError, KeyError, IndexError):
            pass
    disk = shutil.disk_usage(ROOT)
    if not mem:
        try:
            if platform.system() == 'Windows':
                class MemoryStatus(ctypes.Structure):
                    _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in ('total', 'available', 'pageTotal', 'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]
                status = MemoryStatus(); status.length = ctypes.sizeof(status)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                    mem = str(status.total)
            else:
                mem = str(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES'))
        except (AttributeError, OSError, ValueError):
            pass
    gpus = []
    raw_gpus = run_read(['nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], timeout=4)
    if raw_gpus:
        for row in raw_gpus.splitlines():
            values = row.split(',')
            try:
                gpus.append({'vendor': 'NVIDIA', 'name': values[0].strip(), 'memoryGB': round(float(values[1]) / 1024, 1), 'driver': values[2].strip()})
            except (ValueError, IndexError):
                pass
    return {'platform': platform.system(), 'architecture': platform.machine(),
            'appleSilicon': apple, 'chip': chip or platform.machine(), 'gpus': gpus,
            'memoryGB': round(int(mem) / 1024**3, 1) if mem and mem.isdigit() else None,
            'diskFreeGB': round(disk.free / 1024**3, 1), 'pythonVersion': platform.python_version(),
            'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe')}


def selected_files(model, references=False):
    if model not in CATALOG['models']:
        raise RuntimeFailure('UNKNOWN_MODEL', 'Modelo local desconocido.', model=model)
    return [f for f in CATALOG['models'][model]['files'] if references or not f['optional']]


def inspect_files(model, directory=None, references=False):
    directory = model_dir(model, directory)
    files = selected_files(model, references)
    missing = []
    present = 0
    partial_bytes = 0
    for entry in files:
        target = directory / entry['path']
        try:
            size = target.stat().st_size
        except OSError:
            size = -1
        if size != entry['size']:
            missing.append(entry['path'])
            partial = Path(str(target) + '.part')
            if partial.is_file():
                partial_bytes += min(entry['size'], partial.stat().st_size)
        else:
            present += size
    return {'complete': not missing, 'missingCount': len(missing), 'missing': missing[:8],
            'presentBytes': present, 'partialBytes': partial_bytes, 'downloadedBytes': present + partial_bytes,
            'progress': round(100 * (present + partial_bytes) / sum(f['size'] for f in files), 2),
            'totalBytes': sum(f['size'] for f in files),
            'directory': str(directory)}


def download_plan(model, directory=None, references=False):
    directory = model_dir(model, directory)
    parent = directory
    while not parent.exists():
        parent = parent.parent
    volume = Path(*directory.parts[:3]) if len(directory.parts) >= 3 and directory.parts[1] == 'Volumes' else None
    volume_mounted = volume is None or os.path.ismount(volume)
    free = shutil.disk_usage(parent).free if volume_mounted else 0
    files = selected_files(model, references)
    needed = 0
    for entry in files:
        target = directory / entry['path']
        if target.exists() and target.stat().st_size == entry['size']:
            continue
        part = Path(str(target) + '.part')
        valid_partial = part.stat().st_size if part.exists() else 0
        needed += max(0, entry['size'] - valid_partial)
    catalog = CATALOG['models'][model]
    return {'model': model, 'directory': str(directory), 'repository': catalog['repository'],
            'revision': catalog['revision'], 'licenseUrl': catalog['licenseUrl'],
            'withReferences': references, 'totalBytes': sum(f['size'] for f in files),
            'downloadBytes': needed, 'freeBytes': free, 'reserveBytes': MIN_DISK_HEADROOM,
            'fits': volume_mounted and free >= needed + MIN_DISK_HEADROOM, 'volumeMounted': volume_mounted, 'fileCount': len(files),
            'diskSpaceNote': 'Conserva 20 GiB libres adicionales; el tamaño no equivale a RAM.'}


def operation_active(name):
    lock = RUNTIME / ('.' + name + '.lock')
    if not lock.is_file():
        return False
    with lock.open('a+') as handle:
        try:
            portable_lock.acquire(handle)
        except BlockingIOError:
            return True
        portable_lock.release(handle)
        return False


def read_validation(path, model):
    """Only accept media evidence from the currently pinned model and engine."""
    try:
        value = json.loads(path.read_text())
        entry = CATALOG['models'][model]
        variant = h3_quantized.active() if model == 'minimax-h3' else None
        model_revision = h3_quantized.catalog(variant)['revision'] if variant else entry['revision']
        runtime_revision = h3_quantized.REVISION if variant else entry['runtime']['revision']
        if not isinstance(value, dict) or value.get('modelRevision') != model_revision or value.get('runtimeRevision') != runtime_revision or value.get('modelVariant', 'bf16') != (variant or 'bf16'):
            return None
        if value.get('model') != model or value.get('status') != 'media-verified':
            return None
        parameters = value.get('parameters')
        if not isinstance(parameters, dict) or any(isinstance(parameters.get(key), bool) or not isinstance(parameters.get(key), int) or parameters[key] <= 0 for key in ('width', 'height', 'numFrames', 'fps', 'steps')):
            return None
        if value.get('mode') not in ('text-to-video', 'image-to-video', 'references') or parameters.get('memoryProfile', 'conservative') not in MEMORY_PROFILES:
            return None
        return {**value, 'outputAvailable': Path(value['outputPath']).is_file()}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def last_validation(model):
    """Retain the legacy latest-record view for existing clients."""
    return read_validation(RUNTIME / 'validation' / ('last-' + model + '.json'), model)


def validation_history(model, latest=None):
    """Expose compact, revision-filtered evidence for each exact configuration."""
    records = [latest] if latest else []
    for path in (RUNTIME / 'validation' / 'history').glob(model + '-*.json'):
        value = read_validation(path, model)
        if value:
            records.append(value)
    def recorded_at(value):
        stamp = value.get('recordedAt', 0)
        return stamp if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and math.isfinite(stamp) else 0
    records.sort(key=recorded_at, reverse=True)
    seen, compact = set(), []
    for value in records:
        parameters = value['parameters']
        key = (value.get('mode'),) + tuple(parameters.get(field) for field in ('memoryProfile', 'width', 'height', 'numFrames', 'fps', 'steps'))
        if key in seen:
            continue
        seen.add(key)
        compact.append({field: value.get(field) for field in ('status', 'model', 'mode', 'recordedAt', 'parameters', 'outputAvailable', 'modelRevision', 'runtimeRevision')})
    return compact


def save_validation(request, metadata, hw):
    destination = RUNTIME / 'validation' / ('last-' + request['model'] + '.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    value = {'status': 'media-verified', 'model': request['model'],
             'modelVariant': request.get('modelVariant', 'bf16'),
             'modelRevision': metadata['modelRevision'], 'runtimeRevision': metadata['runtimeRevision'],
             'outputPath': request['outputPath'], 'recordedAt': time.time(),
             'hardware': {'chip': hw['chip'], 'memoryGB': hw['memoryGB']},
             'parameters': {k: request[k] for k in ('width', 'height', 'numFrames', 'fps', 'steps', 'seed', 'memoryProfile')},
             'mode': 'references' if request['references'] else 'image-to-video' if request['inputImage'] else 'text-to-video',
             'metadata': metadata}
    # Keep each configuration's evidence before moving the latest pointer.
    # Archive the pre-history last record too, so a native pilot cannot erase
    # the already validated long-take evidence.
    history = destination.parent / 'history'
    history.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        previous = destination.read_text()
        digest = hashlib.sha256(previous.encode()).hexdigest()
        archived = history / (request['model'] + '-previous-' + digest + '.json')
        if not archived.exists():
            archived.write_text(previous)
    parameters = value['parameters']
    configuration = '-'.join(str(parameters[k]) for k in ('memoryProfile', 'width', 'height', 'numFrames', 'fps', 'steps', 'seed'))
    recorded = history / (request['model'] + '-' + configuration + '-' + uuid.uuid4().hex + '.json')
    recorded.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)


def doctor():
    hw = hardware()
    models = []
    for model in MODEL_NAMES:
        variant = h3_quantized.active() if model == 'minimax-h3' else None
        evidence = last_validation(model)
        core_files = h3_quantized.files(variant) if variant else inspect_files(model)
        reference_files = (h3_quantized.files(variant, True) if variant else inspect_files(model, references=True)) if model == 'minimax-h3' else None
        ref_ready = bool(reference_files and reference_files['complete'])
        reference_profile = model == 'minimax-h3' and (ref_ready or bool(config().get('models', {}).get(model, {}).get('withReferences')))
        files = reference_files if reference_profile else core_files
        files = {**files, 'withReferences': reference_profile}
        engine = h3_quantized.BINARY if variant else executable(model)
        engine_ready = engine.is_file() and os.access(engine, os.X_OK)
        engine_error = None
        if model == 'minimax-h3' and engine_ready:
            try:
                if variant:
                    if not (h3_quantized.ENGINE / 'h3_shaders.metal').is_file():
                        raise RuntimeFailure('RUNTIME_ASSET_MISSING', 'Falta el shader del motor GGUF.')
                else:
                    engine_working_directory(model)
            except RuntimeFailure as error:
                engine_ready, engine_error = False, error
        if model == 'ltx-2b' and engine_ready:
            engine_ready = run_read([str(engine), '-c', 'import mlx.core, ltx_mlx; print("ok")']) == 'ok'
        if not hw['appleSilicon']:
            status, message = 'unsupported_hardware', 'Este motor necesita macOS con Apple Silicon.'
        elif not engine_ready:
            status, message = 'runtime_missing', engine_error.message if engine_error else 'Instala el motor local; todavía no se descargan pesos.'
        elif not files['complete'] and operation_active('download-' + model):
            status, message = 'downloading', f"Descargando y verificando pesos · {files['progress']:.1f} %"
        elif not core_files['complete']:
            status, message = 'weights_missing', 'Motor preparado. Faltan pesos del modelo.'
        elif not hw['ffmpeg'] or not hw['ffprobe']:
            status, message = 'ffmpeg_missing', 'Instala FFmpeg y FFprobe para crear y validar el MP4.'
        else:
            status = 'ready'
            message = 'Generación local comprobada con un video válido.' if evidence else 'Motor y archivos presentes. La primera generación valida la inferencia.'
            if reference_profile and not ref_ready:
                message += ' La base está preparada; faltan los pesos de referencias.'
        available = bool(hw['appleSilicon'] and engine_ready and core_files['complete'] and hw['ffmpeg'] and hw['ffprobe'])
        models.append({'id': model, 'name': MODEL_NAMES[model] + (' · ' + variant.upper() if variant else ''), 'modelVariant': variant or 'bf16', 'modelRevision': h3_quantized.catalog(variant)['revision'] if variant else CATALOG['models'][model]['revision'], 'modelRepository': h3_quantized.catalog(variant)['repository'] if variant else CATALOG['models'][model]['repository'], 'installed': core_files['complete'] and engine_ready,
                       'available': available, 'status': status, 'message': message,
                       'engineInstalled': engine_ready, 'enginePath': str(engine), 'weights': files,
                       'capabilities': {'textToVideo': True, 'imageToVideo': True,
                                        'firstLastFrame': model == 'minimax-h3',
                                        'referenceImages': 9 if model == 'minimax-h3' else 0,
                                        'referencesInstalled': ref_ready,
                                        'referenceAudioVideo': model == 'minimax-h3',
                                        'nativeAudio': model == 'minimax-h3', 'negativePrompt': False},
                       'recommended': {'width': 512, 'height': 320, 'numFrames': 22 if model == 'minimax-h3' else 25,
                                       'fps': 24, 'steps': 20 if model == 'minimax-h3' else 4,
                                       'ssdStreaming': model == 'minimax-h3'},
                       'downloadPlan': h3_quantized.download_plan(variant) if variant else download_plan(model, references=reference_profile),
                       'lastValidation': evidence, 'validationHistory': validation_history(model, evidence),
                       'validation': 'model-inference-and-media-verified' if evidence else 'host-and-metal-primitives-tested; model-inference-unverified' if model == 'minimax-h3' else 'adapter-tested; model-inference-unverified'})
    return {'schemaVersion': 1, 'hardware': hw, 'models': models,
            'recommendedModel': 'ltx-2b', 'maxConcurrentGenerations': 1,
            'setup': {'command': './scripts/setup-local-model.sh --model minimax-h3',
                      'documentation': 'docs/LOCAL_MODELS.md'},
            'notice': 'MiniMax H3 tiene pesos abiertos. H3-Context-IR y la regeneración 2K oficial no forman parte de este motor local.'}


def int_field(request, name, default, low, high):
    value = request.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or int(value) != value or not low <= value <= high:
        raise RuntimeFailure('INVALID_REQUEST', f'{name} debe ser entero entre {low} y {high}.')
    return int(value)


def media_path(value, field):
    if not isinstance(value, str) or not value:
        raise RuntimeFailure('INVALID_REQUEST', f'{field} necesita una ruta local.')
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise RuntimeFailure('MEDIA_MISSING', f'No se encuentra el archivo de {field}.', path=str(path))
    return str(path)


def h3_visual_tokens(width, height, frames):
    # The caller supplies already aligned H3 frames (5 + 17*n).
    latent_time = 2 + 5 * ((frames - 5) // 17)
    return latent_time * (width // 32) * (height // 32)


def normalize_request(request):
    if not isinstance(request, dict):
        raise RuntimeFailure('INVALID_REQUEST', 'La solicitud debe ser un objeto JSON.')
    model = request.get('model', 'minimax-h3')
    selected_files(model)
    memory_profile = request.get('memoryProfile', 'conservative')
    if memory_profile not in MEMORY_PROFILES:
        raise RuntimeFailure('INVALID_MEMORY_PROFILE', 'El perfil de memoria no es válido.')
    prompt = request.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 32000:
        raise RuntimeFailure('INVALID_PROMPT', 'Escribe un prompt entre 1 y 32000 caracteres.')
    width = int_field(request, 'width', 512, 256, 1344)
    height = int_field(request, 'height', 320, 256, 1344)
    if width % 32 or height % 32 or width * height > 768 * 1344:
        raise RuntimeFailure('INVALID_DIMENSIONS', 'Las dimensiones deben ser múltiplos de 32 y no superar 1344 × 768 píxeles en superficie.')
    frames = int_field(request, 'numFrames', 22 if model == 'minimax-h3' else 25, 1, 362)
    actual_frames = max(22, 5 + 17 * math.ceil((frames - 5) / 17)) if model == 'minimax-h3' else 1 + 8 * math.ceil((frames - 1) / 8)
    fps = int_field(request, 'fps', 24, 1, 60)
    if fps != 24:
        raise RuntimeFailure('UNSUPPORTED_FPS', 'Estos motores calculan el movimiento a 24 fps; cambia la velocidad en el montaje.')
    if frames / fps > 15 or actual_frames / fps > 15:
        raise RuntimeFailure('DURATION_LIMIT', 'Cada clip generado admite como máximo 15 segundos, también después de ajustar los fotogramas del modelo. Divide la toma o reduce numFrames.')
    steps = int_field(request, 'steps', 20 if model == 'minimax-h3' else 4, 2 if model == 'minimax-h3' else 1, 100)
    if memory_profile in SUPERVISED_PROFILES:
        native = memory_profile == 'h3-native-ssd'
        hd = memory_profile == 'h3-hd-ssd'
        limits = SUPERVISED_LIMITS[memory_profile]
        if model != 'minimax-h3' or request.get('inputImage') or request.get('lastFrame') or request.get('references'):
            raise RuntimeFailure('HD_PROFILE_CONDITIONING' if hd else 'NATIVE_PROFILE_CONDITIONING' if native else 'LONG_PROFILE_CONDITIONING', 'El perfil supervisado admite MiniMax desde texto, sin imágenes ancla ni referencias visuales. Conserva esos recursos y utiliza el perfil breve para ellos.')
        if actual_frames > limits['maxFrames'] or max(width, height) > limits['maxDimension'] or width * height > limits['maxPixels'] or steps > limits['maxSteps'] or ((native or hd) and h3_visual_tokens(width, height, actual_frames) > limits['maxVideoTokens']) or (hd and (width, height) not in ((1280, 736), (736, 1280))):
            if hd:
                raise RuntimeFailure('HD_PROFILE_LIMIT', 'El perfil HD largo experimental admite únicamente 1280 × 736 o 736 × 1280, hasta 345 fotogramas (14,375 s), 93.840 tokens visuales y entre 2 y 20 pasos. Conserva la resolución y el reloj nativos; no recorta ni repite fotogramas.')
            if native:
                raise RuntimeFailure('NATIVE_PROFILE_LIMIT', 'El perfil de resolución nativa admite hasta 345 fotogramas y 35.000 tokens visuales, superficie máxima 1280 × 736, lado máximo 1280 y entre 2 y 20 pasos. Usa hasta 14,375 s en 768 × 448, 8 s en 1024 × 576 o 5,167 s en 1280 × 736; no se reduce automáticamente la duración ni la resolución.')
            raise RuntimeFailure('LONG_PROFILE_LIMIT', 'El perfil largo supervisado admite hasta 345 fotogramas (14,375 s), 512 × 320 píxeles de superficie, lado máximo 512 y entre 2 y 20 pasos.')
    output = request.get('outputPath')
    if not isinstance(output, str) or not output:
        raise RuntimeFailure('INVALID_OUTPUT', 'Falta outputPath para el MP4.')
    output = Path(output).expanduser().resolve()
    if output.suffix.lower() != '.mp4':
        raise RuntimeFailure('INVALID_OUTPUT', 'La salida debe tener extensión .mp4.')
    if output.exists():
        raise RuntimeFailure('OUTPUT_EXISTS', 'La salida ya existe; conserva la toma anterior y usa otra ruta.')
    refs = request.get('references') or []
    if not isinstance(refs, list) or len(refs) > 12:
        raise RuntimeFailure('INVALID_REFERENCES', 'Máximo 12 referencias ordenadas.')
    if refs and (request.get('inputImage') or request.get('lastFrame')):
        raise RuntimeFailure('INCOMPATIBLE_REFERENCES', 'H3 usa fotogramas ancla o referencias de identidad; son modos separados.')
    if model == 'ltx-2b' and (refs or request.get('lastFrame')):
        raise RuntimeFailure('UNSUPPORTED_CAPABILITY', 'LTX 2B acepta texto o una imagen inicial; usa H3 para referencias o último fotograma.')
    links = request.get('continuityLinks', {})
    if not isinstance(links, dict) or set(links) - {'projectId', 'sceneId', 'characterIds', 'referenceAssetIds', 'referenceCharacterIds'}:
        raise RuntimeFailure('INVALID_CONTINUITY', 'Los vínculos de continuidad no son válidos.')
    for key, value in links.items():
        values = [value] if key in ('projectId', 'sceneId') else value
        if not isinstance(values, list) or len(values) > 100 or any(not isinstance(v, str) or len(v) > 1000 for v in values):
            raise RuntimeFailure('INVALID_CONTINUITY', 'Los identificadores de continuidad no son válidos.')
    normalized_refs = []
    counts = {'image': 0, 'video': 0, 'silent-video': 0, 'audio': 0}
    for ref in refs:
        if not isinstance(ref, dict) or ref.get('type') not in counts:
            raise RuntimeFailure('INVALID_REFERENCES', 'Tipo de referencia no admitido.')
        counts[ref['type']] += 1
        normalized_refs.append({'type': ref['type'], 'path': media_path(ref.get('path'), 'referencia')})
    if counts['image'] > 9 or counts['video'] + counts['silent-video'] > 3 or counts['audio'] > 3:
        raise RuntimeFailure('INVALID_REFERENCES', 'H3 admite 9 imágenes, 3 videos y 3 audios como máximo.')
    if counts['audio'] and not (counts['image'] or counts['video'] or counts['silent-video']):
        raise RuntimeFailure('INVALID_REFERENCES', 'El audio de referencia debe acompañar una imagen o video.')
    warnings = []
    if memory_profile == 'h3-long-ssd':
        warnings.append('Perfil largo supervisado: una toma continua de hasta 14,375 s a 24 fps. Se detendrá ante presión de memoria; no garantiza calidad ni una duración exacta de 15 s.')
    if memory_profile == 'h3-native-ssd':
        warnings.append('Perfil experimental supervisado de resolución nativa: hasta 35.000 tokens visuales y 345 fotogramas a 24 fps, según resolución. Se detendrá ante presión de memoria. Sólo una prueba de la misma resolución, duración y pasos verifica esa configuración; el cálculo del presupuesto no garantiza memoria ni calidad.')
    if memory_profile == 'h3-hd-ssd':
        warnings.append('Perfil HD largo experimental: 1280 × 736 o 736 × 1280 y hasta 14,375 s continuos. Límite de inferencia de 12 horas con parada del motor; sin reintento automático. Una prueba corta no valida esta duración y el presupuesto no garantiza memoria ni calidad.')
    if request.get('negativePrompt'):
        warnings.append('El motor no tiene un canal negativo independiente. Las restricciones deben estar en el prompt principal; este campo se conserva como metadato.')
    if model == 'minimax-h3' and (request.get('inputImage') or request.get('lastFrame')):
        warnings.append('Las imágenes ancla se ajustan proporcionalmente al plano, con bandas negras si hace falta. No se recortan ni deforman; los originales se conservan.')
    if model == 'ltx-2b' and request.get('inputImage'):
        warnings.append('LTX conserva la proporción de la imagen inicial y rellena los bordes con fondo difuminado si el lienzo es distinto; el original se conserva.')
    if frames != actual_frames:
        warnings.append(f'El modelo requiere otra forma temporal: {frames} → {actual_frames} fotogramas; duración real {actual_frames / fps:.3f} s.')
    return {'model': model, 'prompt': prompt.strip(), 'negativePrompt': request.get('negativePrompt', ''),
            'width': width, 'height': height, 'requestedFrames': frames, 'numFrames': actual_frames, 'fps': fps,
            'steps': steps, 'memoryProfile': memory_profile,
            'seed': int_field(request, 'seed', 42, 0, 2**32 - 1), 'outputPath': str(output),
            'inputImage': media_path(request['inputImage'], 'imagen inicial') if request.get('inputImage') else None,
            'lastFrame': media_path(request['lastFrame'], 'imagen final') if request.get('lastFrame') else None,
            'references': normalized_refs, 'ssdStreaming': True,
            'modelDirectory': str(model_dir(model)), 'warnings': warnings,
            **({'continuityLinks': links} if links else {})}


def prepare_h3_view(directory):
    # Keep symlinks on the Mac's filesystem, so exFAT SSDs work too.
    source = Path(directory).resolve()
    key = hashlib.sha256(str(source).encode()).hexdigest()[:16]
    view = RUNTIME / 'model-views' / key
    (view / 'Ref2VA').mkdir(parents=True, exist_ok=True)
    links = {'FL2VA': source / 'FL2VA', 'Ref2VA/transformer': source / 'Ref2VA' / 'transformer'}
    for component in ('text_encoder', 'tokenizer', 'processor', 'video_vae', 'audio_vae'):
        links['Ref2VA/' + component] = source / 'FL2VA' / component
    for name, destination in links.items():
        target = view / name
        if target.is_symlink():
            if target.resolve() != destination.resolve():
                raise RuntimeFailure('MODEL_VIEW_CONFLICT', 'El enlace de pesos existente apunta a otra ubicación.', path=str(target))
        elif target.exists():
            raise RuntimeFailure('MODEL_VIEW_CONFLICT', 'Existe un archivo en la ruta reservada a enlaces de pesos.', path=str(target))
        else:
            target.symlink_to(destination, target_is_directory=True)
    return str(view)


def h3_command(request, output):
    args = [str(Path(request.get('engineExecutable', executable('minimax-h3'))).expanduser().resolve()), '-d', request.get('engineModelDirectory', request['modelDirectory']), '-p', request['prompt'],
            '--width', str(request['width']), '--height', str(request['height']),
            '--frames', str(request['numFrames']), '--steps', str(request['steps']),
            '--seed', str(request['seed']), '--layers', '50', '--reuse', '1', '--profile', '-o', str(output)]
    if request.get('ssdStreaming', True):
        args += ['--ssd-streaming']
    if request.get('inputImage'):
        args += ['--first-frame', request.get('engineInputImage', request['inputImage'])]
    if request.get('lastFrame'):
        args += ['--last-frame', request.get('engineLastFrame', request['lastFrame'])]
    for ref in request['references']:
        args += ['--ref-' + ref['type'], ref['path']]
    return args


def prepare_anchor(source, destination, width, height):
    """Lossless temporary PNG canvas; preserve source geometry and source file."""
    filtergraph = f'scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', source, '-map', '0:v:0',
                        '-vf', filtergraph, '-frames:v', '1', '-an', '-sn', '-pix_fmt', 'rgb24',
                        '-compression_level', '3', '-update', '1', '-y', str(destination)],
                       check=True, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeFailure('ANCHOR_PREPARATION_FAILED', 'No se pudo preparar la imagen ancla; el original se conserva.', detail=str(exc))
    return str(destination)


def report_engine_line(line):
    line = re.sub(r'^\[filmma-h3-gguf\]\s+[\d.]+s\s+', '', line)
    lower = line.lower()
    phase_match = re.match(r'^(.+?)\s+(\d+)\s*/\s*(\d+)\s*$', line)
    if phase_match:
        phase, completed, total = phase_match.groups()
        messages = {'tokenizer': 'Preparando el texto', 'text encoder': 'Interpretando el plano',
                    'video VAE load': 'Preparando los fotogramas', 'audio VAE': 'Construyendo el sonido',
                    'audio VAE encoder': 'Leyendo el sonido de referencia', 'video VAE encoder': 'Leyendo la referencia visual',
                    'Qwen vision': 'Interpretando las referencias', 'FFmpeg': 'Codificando la toma',
                    'T5 shard prepared': 'Preparando el texto en memoria', 'denoise': 'Generando movimiento', 'encode': 'Codificando la toma'}
        label = messages.get(phase, 'Procesando la toma')
        fraction = min(1.0, int(completed) / int(total)) if int(total) > 0 else 0.0
        progress = {'progress': round(15 + 70 * fraction, 1)} if phase == 'denoise' else {'progress': round(95 + 4 * fraction, 1)} if phase == 'encode' else {}
        emit('progress', stage='inference', message=f'{label} · {completed}/{total}',
             enginePhase=phase, completed=int(completed), total=int(total), **progress)
    elif 'loading t5' in lower or 't5 encode:' in lower:
        emit('progress', stage='text', message='Interpretando el texto y la continuidad del plano.')
    elif 'loading transformer' in lower:
        emit('progress', stage='loading', message='Cargando el modelo de movimiento en la GPU.')
    elif 'loading vae' in lower:
        emit('progress', stage='loading', message='Preparando el motor de imagen.')
    elif 'denoising:' in lower:
        emit('progress', stage='inference', message='Generando el movimiento y los detalles de la toma.')
    elif 'vae decode:' in lower:
        emit('progress', stage='decoding', message='Fotogramas generados; preparando el video.')
    else:
        emit('log', message=line[:1500])


def validate_media(output):
    try:
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)],
                                check=True, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        video = next(s for s in data['streams'] if s['codec_type'] == 'video')
        return {'width': video['width'], 'height': video['height'], 'duration': float(data['format'].get('duration', 0)),
                'codec': video.get('codec_name'), 'frames': int(video.get('nb_frames', 0)),
                'hasAudio': any(s.get('codec_type') == 'audio' for s in data['streams']), 'bytes': output.stat().st_size}
    except (OSError, ValueError, KeyError, StopIteration, subprocess.SubprocessError) as exc:
        raise RuntimeFailure('INVALID_RENDER', 'El motor no produjo un archivo de video válido.', detail=str(exc))


@contextlib.contextmanager
def exclusive_lock(name, blocking=False):
    with (RUNTIME / ('.' + name + '.lock')).open('a+') as handle:
        try:
            portable_lock.acquire(handle, blocking)
        except BlockingIOError:
            raise RuntimeFailure('RUNTIME_BUSY', 'Ya existe una operación local de este tipo en curso.')
        try:
            yield
        finally:
            portable_lock.release(handle)


def generate(request):
    with exclusive_lock('generation'):
        return _generate(request)


class ProcessMemoryUsage(ctypes.Structure):
    """Darwin rusage_info_v2, as declared in the macOS SDK sys/resource.h."""
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in (
        'userTime', 'systemTime', 'packageWakeups', 'interruptWakeups', 'pageins',
        'wiredBytes', 'residentBytes', 'footprintBytes', 'startTime', 'exitTime',
        'childUserTime', 'childSystemTime', 'childPackageWakeups', 'childInterruptWakeups',
        'childPageins', 'childElapsedTime', 'diskReadBytes', 'diskWrittenBytes')]


def process_memory(pid):
    try:
        library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        library.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        usage = ProcessMemoryUsage()
        if library.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
            return None
        return {key: getattr(usage, key) for key in ('residentBytes', 'footprintBytes', 'startTime', 'diskReadBytes', 'diskWrittenBytes')}
    except (OSError, AttributeError):
        return None


def system_memory(include_free=False):
    pressure = run_read(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], timeout=2)
    swap = run_read(['sysctl', '-n', 'vm.swapusage'], timeout=2)
    match = re.search(r'used\s*=\s*([\d.]+)([KMGT])', swap or '')
    if not pressure or not pressure.isdigit() or not match:
        raise RuntimeFailure('MEMORY_TELEMETRY_UNAVAILABLE', 'No se puede leer la presión de memoria del Mac. El perfil largo no se inicia o se detiene por seguridad.')
    result = {'pressureLevel': int(pressure), 'swapUsedBytes': int(float(match[1]) * 1024**('KMGT'.index(match[2]) + 1))}
    if include_free:
        report = run_read(['memory_pressure', '-Q'], timeout=4)
        free = re.search(r'System-wide memory free percentage:\s*(\d+)%', report or '')
        if not free:
            raise RuntimeFailure('MEMORY_TELEMETRY_UNAVAILABLE', 'No se puede comprobar la reserva de memoria. El perfil largo no se inicia.')
        result['freePercent'] = int(free[1])
    return result


def require_disk_reserve(paths):
    for value in paths:
        directory = Path(value).expanduser().resolve()
        volume = Path(*directory.parts[:3]) if len(directory.parts) >= 3 and directory.parts[1] == 'Volumes' else None
        if volume and not os.path.ismount(volume):
            raise RuntimeFailure('VOLUME_NOT_MOUNTED', 'El SSD del modelo no está conectado. La generación supervisada no puede continuar.')
        while not directory.exists():
            directory = directory.parent
        if shutil.disk_usage(directory).free < LONG_PROFILE_LIMITS['diskReserveBytes']:
            raise RuntimeFailure('INSUFFICIENT_DISK', 'El perfil supervisado necesita conservar al menos 20 GiB libres en el disco del modelo y de salida.')


def generation_memory_preflight(request, hw):
    if request['memoryProfile'] not in SUPERVISED_PROFILES:
        if (hw.get('memoryGB') or 36) <= 36 and (request['width'] * request['height'] > 864 * 480 or request['numFrames'] > 107):
            raise RuntimeFailure('MEMORY_BUDGET', 'En 36 GB el perfil breve admite hasta 864 × 480 y 107 fotogramas. Para una toma continua más larga, selecciona el perfil supervisado de MiniMax desde texto.')
        return None
    if (hw.get('memoryGB') or 0) < LONG_PROFILE_LIMITS['minMemoryGB']:
        raise RuntimeFailure('MEMORY_BUDGET', 'El perfil supervisado requiere al menos 32 GB de memoria unificada.')
    baseline = system_memory(include_free=True)
    if baseline['pressureLevel'] != 1 or baseline['freePercent'] < LONG_PROFILE_LIMITS['minFreePercentBeforeStart']:
        raise RuntimeFailure('MEMORY_PRESSURE', 'Cierra otras tareas que consuman memoria antes de iniciar una generación supervisada. Se requiere presión normal y al menos 25 % de memoria recuperable según macOS.', memory=baseline)
    if not process_memory(os.getpid()):
        raise RuntimeFailure('MEMORY_TELEMETRY_UNAVAILABLE', 'No se puede supervisar la memoria del proceso; la generación supervisada no se inicia.')
    require_disk_reserve([request['modelDirectory'], Path(request['outputPath']).parent])
    return baseline


def memory_stop_reason(sample, baseline, warning_samples):
    """Pure threshold decision; sampled counters are not a hard Metal allocation cap."""
    if sample['footprintBytes'] > LONG_PROFILE_LIMITS['maxProcessFootprintBytes']:
        return 'La memoria física atribuida al motor superó el límite de 24 GiB.'
    if sample['residentBytes'] > LONG_PROFILE_LIMITS['maxProcessRssBytes']:
        return 'La memoria residente del motor superó el límite de 28 GiB.'
    if sample['pressureLevel'] >= 4:
        return 'macOS notificó presión crítica de memoria.'
    if sample['pressureLevel'] != 1 and warning_samples >= LONG_PROFILE_LIMITS['warningSamplesBeforeStop']:
        return 'macOS mantuvo presión de memoria durante tres comprobaciones consecutivas.'
    if sample['swapUsedBytes'] - baseline['swapUsedBytes'] > LONG_PROFILE_LIMITS['maxSwapGrowthBytes']:
        return 'El uso de intercambio del sistema aumentó más de 2 GiB durante la toma.'
    return None


class LongGenerationMonitor:
    def __init__(self, child, request, baseline):
        self.child, self.request, self.baseline = child, request, baseline
        self.stopped = threading.Event()
        self.failure = None
        self.started = time.monotonic()
        self.stats = {'profile': request['memoryProfile'], 'limits': dict(SUPERVISED_LIMITS[request['memoryProfile']]), 'baseline': baseline,
                      'samples': 0, 'elapsedSeconds': 0, 'peakProcessFootprintBytes': 0, 'peakProcessRssBytes': 0,
                      'maxSwapGrowthBytes': 0, 'maxPressureLevel': baseline['pressureLevel'],
                      'processDiskReadBytes': 0, 'processDiskWrittenBytes': 0,
                      'measurementScope': 'macOS proc_pid_rusage del motor: physical footprint y RSS muestreados; presión e intercambio del sistema. No equivale a una medición completa de memoria GPU/unificada, puede omitir picos y no impone un límite de asignación Metal.'}
        self.thread = threading.Thread(target=self._run, name='filmma-supervised-memory-monitor', daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=12)
        return dict(self.stats)

    def _halt(self, code, message):
        if self.stopped.is_set() or self.child.poll() is not None:
            return
        self.failure = RuntimeFailure(code, message + ' La toma larga se detuvo; los originales se conservan. No se reintenta automáticamente.', memory=self.stats)
        emit('log', stage='timeout-stop' if code == 'GENERATION_TIMEOUT' else 'memory-stop', code=code, message=self.failure.message, memory=self.stats)
        try:
            os.killpg(self.child.pid, signal.SIGTERM)
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=5)
        except ProcessLookupError:
            pass

    def _run(self):
        warnings = 0
        identity = None
        try:
            while not self.stopped.is_set() and self.child.poll() is None:
                usage = process_memory(self.child.pid)
                if not usage:
                    if self.child.poll() is not None:
                        return
                    raise RuntimeFailure('MEMORY_TELEMETRY_UNAVAILABLE', 'Se perdió la medición de memoria del motor.')
                if identity is not None and identity != usage['startTime']:
                    raise RuntimeFailure('MEMORY_TELEMETRY_UNAVAILABLE', 'Cambió la identidad del proceso supervisado.')
                identity = usage['startTime']
                sample = {**usage, **system_memory()}
                warnings = warnings + 1 if sample['pressureLevel'] != 1 else 0
                self.stats['samples'] += 1
                self.stats['peakProcessFootprintBytes'] = max(self.stats['peakProcessFootprintBytes'], sample['footprintBytes'])
                self.stats['peakProcessRssBytes'] = max(self.stats['peakProcessRssBytes'], sample['residentBytes'])
                self.stats['maxSwapGrowthBytes'] = max(self.stats['maxSwapGrowthBytes'], sample['swapUsedBytes'] - self.baseline['swapUsedBytes'])
                self.stats['maxPressureLevel'] = max(self.stats['maxPressureLevel'], sample['pressureLevel'])
                self.stats['processDiskReadBytes'] = max(self.stats['processDiskReadBytes'], sample.get('diskReadBytes', 0))
                self.stats['processDiskWrittenBytes'] = max(self.stats['processDiskWrittenBytes'], sample.get('diskWrittenBytes', 0))
                self.stats['elapsedSeconds'] = round(time.monotonic() - self.started, 3)
                deadline = self.stats['limits'].get('maxInferenceSeconds')
                if deadline is not None and self.stats['elapsedSeconds'] >= deadline:
                    self._halt('GENERATION_TIMEOUT', 'La inferencia HD alcanzó su límite de 12 horas.')
                    return
                reason = memory_stop_reason(sample, self.baseline, warnings)
                if reason:
                    self._halt('MEMORY_PRESSURE', reason)
                    return
                if self.stats['samples'] == 1 or self.stats['samples'] % 15 == 0:
                    require_disk_reserve([self.request['modelDirectory'], Path(self.request['outputPath']).parent])
                    emit('log', stage='memory', message='Supervisión de la generación local.', memory={**self.stats, 'current': sample})
                self.stopped.wait(LONG_PROFILE_LIMITS['sampleIntervalSeconds'])
        except Exception as exc:
            self._halt(getattr(exc, 'code', 'MEMORY_TELEMETRY_UNAVAILABLE'), str(exc))


def _generate(request):
    request = normalize_request(request)
    hw = hardware()
    if not hw['appleSilicon']:
        raise RuntimeFailure('UNSUPPORTED_HARDWARE', 'La generación local requiere Apple Silicon.')
    variant = h3_quantized.active() if request['model'] == 'minimax-h3' else None
    if variant:
        if not h3_quantized.validation(variant):
            raise RuntimeFailure('QUANTIZED_UNVALIDATED', 'La variante cuantizada necesita una prueba visual revisada antes de generar.')
        request.update(modelVariant=variant, modelDirectory=str(h3_quantized.directory(variant)),
            engineExecutable=str(h3_quantized.BINARY), ssdStreaming=True,
            quantization={'transformer': 'Q4_K' if variant == 'gguf-q4' else 'Q8_0', 'textEncoder': 'Q4_K_M',
                'videoVae': 'FP16', 'repository': h3_quantized.catalog(variant)['repository'],
                'revision': h3_quantized.catalog(variant)['revision'], 'engineRevision': h3_quantized.REVISION},
            weightResidency={'effective': 'quantized-ssd', 'ssdStreaming': True,
                'note': 'Pesos GGUF por bloques; descompresión BF16 en GPU. No es residencia completa en RAM.'})
        request['conditioningManifest'] = [{'type': ref['type'], 'path': ref['path'], 'sha256': sha256_file(Path(ref['path']))} for ref in request['references']]
        for field in ('inputImage', 'lastFrame'):
            if request[field]:
                request['conditioningManifest'].append({'type': field, 'path': request[field], 'sha256': sha256_file(Path(request[field]))})
    elif request['model'] == 'minimax-h3':
        try:
            plan = residency_plan(hw, config().get('models', {}).get('minimax-h3', {}).get('weightResidency', 'auto'), request['memoryProfile'])
        except ValueError as error:
            raise RuntimeFailure('MEMORY_RESIDENCY', str(error))
        request['ssdStreaming'] = plan['ssdStreaming']
        request['weightResidency'] = plan
        if not request['ssdStreaming']:
            if request['numFrames'] > 22 or request['width'] * request['height'] > 512 * 512:
                raise RuntimeFailure('RESIDENCY_LIMIT', 'La prueba de RAM residente admite hasta 22 fotogramas y 512 × 512 píxeles de superficie. Usa SSD streaming para los demás perfiles.')
            baseline = system_memory(include_free=True)
            if baseline['pressureLevel'] >= 2 or hw['memoryGB'] * baseline['freePercent'] / 100 < 48:
                raise RuntimeFailure('MEMORY_BUDGET', 'Cierra aplicaciones o selecciona SSD: la prueba residente necesita una estimación conservadora de 48 GiB libres y presión normal.')
        emit('log', stage='memory', message='Residencia de pesos: ' + plan['effective'], residency=plan)
    engine = h3_quantized.BINARY if variant else executable(request['model'])
    if not engine.is_file():
        raise RuntimeFailure('RUNTIME_MISSING', 'Instala primero el motor local.', model=request['model'])
    engine_cwd = h3_quantized.ENGINE if variant else engine_working_directory(request['model'])
    files = h3_quantized.files(variant, bool(request['references'])) if variant else inspect_files(request['model'], references=bool(request['references']))
    if not files['complete']:
        raise RuntimeFailure('MODEL_NOT_INSTALLED', 'Faltan pesos del modelo; abre Modelos locales para preparar la descarga.', model=request['model'], missingCount=files['missingCount'])
    if not hw['ffmpeg'] or not hw['ffprobe']:
        raise RuntimeFailure('FFMPEG_MISSING', 'FFmpeg y FFprobe son necesarios para exportar y comprobar el video.')
    # The ordinary profile stays short. Long native H3 takes are an explicit,
    # narrow profile with live supervision, not a removal of the memory guard.
    memory_baseline = generation_memory_preflight(request, hw)
    monitor_request = {**request, 'memoryProfile': 'h3-long-ssd'} if variant and request['memoryProfile'] == 'conservative' else request
    if variant and memory_baseline is None:
        memory_baseline = generation_memory_preflight(monitor_request, hw)
    output = Path(request['outputPath'])
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.stem + '.partial-' + uuid.uuid4().hex[:8] + '.mp4')
    emit('progress', stage='preflight', progress=0, message='Validación completa; iniciando generación local.', request=request)
    for warning in request['warnings']:
        emit('warning', message=warning)
    started = time.time()
    child = None
    engine_metrics = {}
    engine_error = None
    previous = {}
    temp_request = None
    anchor_directory = None
    memory_monitor = None
    def cancel(signum, _frame):
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
        raise RuntimeFailure('CANCELLED', 'Generación cancelada; los originales se conservan.')
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, cancel)
        if request['model'] == 'minimax-h3':
            request['engineModelDirectory'] = prepare_h3_view(request['modelDirectory'])
            engine_request = dict(request)
            if request['inputImage'] or request['lastFrame']:
                emit('progress', stage='conditioning', message='Preparando imágenes ancla sin recortar ni deformar los originales.')
                anchor_directory = tempfile.TemporaryDirectory(prefix='.h3-anchors-', dir=str(output.parent))
                for field, target in (('inputImage', 'engineInputImage'), ('lastFrame', 'engineLastFrame')):
                    if request[field]:
                        engine_request[target] = prepare_anchor(request[field], Path(anchor_directory.name) / (field + '.png'), request['width'], request['height'])
                request['imagePreparation'] = {'fit': 'contain', 'padding': 'black', 'temporaryFormat': 'PNG RGB8',
                                               'width': request['width'], 'height': request['height'], 'originalsPreserved': True}
            command = h3_command(engine_request, partial)
        else:
            temp_request = output.parent / ('.ltx-request-' + uuid.uuid4().hex + '.json')
            temp_request.write_text(json.dumps({**request, 'outputPath': str(partial)}))
            command = [str(executable('ltx-2b')), str(RUNTIME / 'ltx_worker.py'), str(temp_request)]
        child_env = {**os.environ, 'PYTHONUNBUFFERED': '1'}
        if variant:
            child_env['H3_PROFILE'] = '1'
        if request['model'] == 'minimax-h3' and not request['ssdStreaming']:
            child_env['H3_ZERO_COPY_WEIGHTS'] = '0'
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, cwd=str(engine_cwd), start_new_session=True, env=child_env)
        if memory_baseline is not None:
            memory_monitor = LongGenerationMonitor(child, monitor_request, memory_baseline)
            memory_monitor.start()
        tail = []
        for line in child.stdout:
            clean = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line).strip()
            if not clean:
                continue
            tail = (tail + [clean])[-12:]
            try:
                parsed = json.loads(clean)
            except ValueError:
                parsed = None
            if isinstance(parsed, dict) and parsed.get('type') == 'error':
                engine_error = parsed
            elif isinstance(parsed, dict) and parsed.get('type') in ('progress', 'warning'):
                if parsed.get('stage') == 'metrics':
                    engine_metrics.update({k: v for k, v in parsed.items() if k not in ('type', 'stage', 'message')})
                emit(parsed.pop('type'), **parsed)
            else:
                report_engine_line(clean)
        rc = child.wait()
        if memory_monitor:
            engine_metrics['memoryWatchdog'] = memory_monitor.close()
            if memory_monitor.failure:
                raise memory_monitor.failure
        if rc != 0:
            if engine_error:
                raise RuntimeFailure(engine_error.get('code', 'ENGINE_FAILED'), engine_error.get('message', 'Error en motor local.'))
            diagnostic = '\n'.join(tail).lower()
            if any(term in diagnostic for term in ('out of memory', 'insufficient memory', 'resource exhausted', 'allocation would exceed')):
                raise RuntimeFailure('INSUFFICIENT_MEMORY', 'El motor agotó la memoria disponible. Reduce resolución/fotogramas y cierra otras tareas de GPU antes de reintentar.', exitCode=rc, log=tail)
            raise RuntimeFailure('ENGINE_FAILED', 'El motor local terminó con error.', exitCode=rc, log=tail)
        metadata = validate_media(partial)
        if metadata['width'] != request['width'] or metadata['height'] != request['height']:
            raise RuntimeFailure('RENDER_MISMATCH', 'La resolución del render no coincide con la solicitud.', actual=metadata)
        if metadata['duration'] <= 0 or metadata['duration'] > 15.001 or (metadata['frames'] and metadata['frames'] != request['numFrames']):
            raise RuntimeFailure('RENDER_MISMATCH', 'Duración o número de fotogramas inesperados.', actual=metadata)
        os.replace(partial, output)
        metadata.update({'model': request['model'], 'memoryProfile': request['memoryProfile'], 'seed': request['seed'], 'elapsedSeconds': round(time.time() - started, 2),
                         'local': True, 'modelVariant': variant or 'bf16',
                         'modelRevision': h3_quantized.catalog(variant)['revision'] if variant else CATALOG['models'][request['model']]['revision'],
                         'runtimeRevision': h3_quantized.REVISION if variant else CATALOG['models'][request['model']]['runtime']['revision'],
                         'warnings': request['warnings'], 'engineMetrics': engine_metrics, 'weightResidency': request.get('weightResidency')})
        output.with_suffix('.filmma.json').write_text(json.dumps({'request': request, 'metadata': metadata}, ensure_ascii=False, indent=2))
        try:
            save_validation(request, metadata, hw)
        except OSError as exc:
            emit('warning', message='El video está validado, pero no se pudo guardar el historial del diagnóstico.', detail=str(exc))
        emit('result', outputPath=str(output), metadata=metadata)
    finally:
        if memory_monitor:
            memory_monitor.close()
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        if child and child.stdout:
            child.stdout.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if partial.exists():
            partial.unlink()
        if temp_request and temp_request.exists():
            temp_request.unlink()
        if anchor_directory:
            anchor_directory.cleanup()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def configure_memory(mode):
    residency_plan(hardware(), mode)
    with exclusive_lock('generation'), exclusive_lock('configuration', blocking=True):
        value = config()
        value.setdefault('models', {}).setdefault('minimax-h3', {})['weightResidency'] = mode
        temp = CONFIG_PATH.with_suffix('.tmp')
        temp.write_text(json.dumps(value, indent=2) + '\n')
        temp.replace(CONFIG_PATH)
    return {'ok': True, 'mode': mode, 'note': 'Los perfiles largos y HD mantienen SSD streaming y sus límites. RAM explícita sólo admite el perfil breve.'}


def configure(model, directory, references=None):
    directory = model_dir(model, directory)
    with exclusive_lock('configuration', blocking=True):
        value = config()
        entry = value.setdefault('models', {}).setdefault(model, {})
        entry['directory'] = str(directory)
        if references is not None:
            entry['withReferences'] = bool(references)
        temp = CONFIG_PATH.with_suffix('.tmp')
        temp.write_text(json.dumps(value, indent=2) + '\n')
        temp.replace(CONFIG_PATH)
    return str(directory)


def download(model, directory=None, references=False, accepted=False):
    with exclusive_lock('download-' + model):
        return _download(model, directory, references, accepted)


def verify_model(model, references=False):
    """Explicit, cancellable read-only integrity check; never fetches weights."""
    with exclusive_lock('download-' + model):
        directory = model_dir(model)
        entries = selected_files(model, references)
        problems = []
        total = sum(entry['size'] for entry in entries)
        complete = 0
        for entry in entries:
            target = directory / entry['path']
            problem = None
            if not target.is_file():
                problem = 'missing'
            elif target.stat().st_size != entry['size']:
                problem = 'size'
            elif entry.get('sha256') and sha256_file(target) != entry['sha256']:
                problem = 'sha256'
            if problem:
                problems.append({'path': entry['path'], 'reason': problem})
            complete += entry['size']
            emit('progress', stage='verifying', message='Verificando ' + entry['path'], progress=round(complete / total * 100, 2))
        report = {'model': model, 'directory': str(directory), 'complete': not problems, 'files': len(entries), 'sha256Files': sum(bool(e.get('sha256')) for e in entries), 'problems': problems, 'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        if problems:
            raise RuntimeFailure('MODEL_INTEGRITY_FAILED', 'Hay archivos ausentes o dañados. Los originales se conservan; revisa el diagnóstico antes de reanudar.', report=report)
        emit('result', **report)


def _download(model, directory=None, references=False, accepted=False):
    plan = download_plan(model, directory, references)
    if not accepted:
        raise RuntimeFailure('LICENSE_REVIEW_REQUIRED', 'Revisa la licencia del modelo y usa --accept-license para descargar.', licenseUrl=plan['licenseUrl'], plan=plan)
    if not plan['volumeMounted']:
        raise RuntimeFailure('VOLUME_NOT_MOUNTED', 'Conecta el SSD externo antes de iniciar o reanudar la descarga.', plan=plan)
    if not plan['fits']:
        raise RuntimeFailure('INSUFFICIENT_DISK', 'No hay espacio suficiente. Selecciona un SSD externo o libera espacio antes de descargar.', plan=plan)
    directory = Path(plan['directory'])
    directory.mkdir(parents=True, exist_ok=True)
    configure(model, str(directory), references=references)
    catalog = CATALOG['models'][model]
    files = selected_files(model, references)
    total = sum(f['size'] for f in files)
    downloaded = {}
    progress_lock = threading.Lock()
    stop_transfers = threading.Event()
    def fetch_file(entry):
        target = directory / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = entry.get('sha256')
        if target.is_file() and target.stat().st_size == entry['size']:
            # Check cached weights before trusting them as complete.
            emit('progress', stage='verifying', message='Verificando la integridad de los pesos.', file=entry['path'])
            if not expected or sha256_file(target) == expected:
                with progress_lock:
                    downloaded[entry['path']] = entry['size']
                return
            raise RuntimeFailure('CHECKSUM_MISMATCH', 'Un archivo local tiene un hash incorrecto; muévelo antes de reintentar.', path=str(target))
        partial = Path(str(target) + '.part')
        url = 'https://huggingface.co/' + catalog['repository'] + '/resolve/' + catalog['revision'] + '/' + entry['path']
        for attempt in range(3):
            try:
                offset = partial.stat().st_size if partial.exists() else 0
                if offset > entry['size']:
                    raise RuntimeFailure('INVALID_PARTIAL', 'La descarga parcial excede el tamaño esperado.', path=str(partial))
                if offset < entry['size']:
                    headers = {'User-Agent': 'Filmma-local-model-manager/1.0'}
                    if offset:
                        headers['Range'] = 'bytes=' + str(offset) + '-'
                    token = os.environ.get('HF_TOKEN')
                    if token:
                        headers['Authorization'] = 'Bearer ' + token
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.build_opener(ModelRedirectHandler()).open(req, timeout=90) as response:
                        if offset and response.status != 206:
                            offset = 0
                        with partial.open('ab' if offset else 'wb') as stream:
                            last_emit = 0
                            while True:
                                if stop_transfers.is_set():
                                    raise RuntimeFailure('DOWNLOAD_CANCELLED', 'Transferencia pausada después de un error en otro archivo.')
                                block = response.read(4 * 1024 * 1024)
                                if not block:
                                    break
                                stream.write(block)
                                offset += len(block)
                                now = time.monotonic()
                                if now - last_emit > 1:
                                    if shutil.disk_usage(directory).free < MIN_DISK_HEADROOM:
                                        raise RuntimeFailure('DISK_RESERVE_REACHED', 'Descarga pausada para conservar 20 GiB libres. Reanuda después de liberar espacio.')
                                    with progress_lock:
                                        downloaded[entry['path']] = offset
                                        complete_bytes = sum(downloaded.values())
                                        emit('progress', stage='download', model=model, message=f'Descargando {MODEL_NAMES[model]} · {complete_bytes / 1e9:.2f} / {total / 1e9:.2f} GB', file=entry['path'],
                                             downloadedBytes=complete_bytes, totalBytes=total,
                                             progress=round(complete_bytes / total * 100, 2))
                                    last_emit = now
                if partial.stat().st_size != entry['size']:
                    raise OSError('La transferencia terminó antes de completar el archivo.')
                emit('progress', stage='verifying', message='Verificando la integridad de los pesos.', file=entry['path'])
                if expected and sha256_file(partial) != expected:
                    raise RuntimeFailure('CHECKSUM_MISMATCH', 'El hash descargado no coincide; no se instala el archivo.', path=str(partial))
                # Never replace an existing, unexpected file silently.
                if target.exists():
                    previous = Path(str(target) + '.previous-' + uuid.uuid4().hex[:8])
                    target.rename(previous)
                partial.replace(target)
                break
            except (urllib.error.URLError, OSError) as exc:
                if attempt == 2:
                    raise RuntimeFailure('DOWNLOAD_FAILED', 'Descarga interrumpida; vuelve a ejecutar para reanudar.', detail=str(exc), path=str(partial))
                time.sleep(attempt + 1)
        with progress_lock:
            downloaded[entry['path']] = entry['size']
    # Three bounded transfers improve throughput while preserving disk headroom.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        pending = [pool.submit(fetch_file, entry) for entry in files]
        try:
            for future in concurrent.futures.as_completed(pending):
                future.result()
        except BaseException:
            stop_transfers.set()
            for future in pending:
                future.cancel()
            raise
    if model == 'minimax-h3':
        # Shared components have identical upstream hashes. The view lives on
        # the internal filesystem because exFAT does not support symlinks.
        prepare_h3_view(directory)
    configure(model, str(directory))
    emit('result', model=model, directory=str(directory), installed=True, bytes=total)


def apply_h3_runtime_patches(checkout):
    """Apply reviewed compatibility patches only to their exact known sources."""
    manifest = json.loads((RUNTIME / 'patches' / 'h3.json').read_text())
    pending = []
    for patch in manifest['patches']:
        target = Path(checkout) / patch['path']
        source = target.read_bytes()
        digest = hashlib.sha256(source).hexdigest()
        if digest == patch['afterSha256']:
            continue
        if digest != patch['beforeSha256']:
            raise RuntimeFailure('RUNTIME_PATCH_CONFLICT', 'El motor contiene cambios no reconocidos; se conserva sin modificar para revisarlos.', patch=patch['id'], path=str(target))
        before, after = patch['before'].encode(), patch['after'].encode()
        replacement = source.replace(before, after)
        if source.count(before) != 1 or hashlib.sha256(replacement).hexdigest() != patch['afterSha256']:
            raise RuntimeFailure('RUNTIME_PATCH_INVALID', 'El parche local no coincide con el código esperado.', patch=patch['id'])
        pending.append((target, replacement))
    # Validate every entry before changing anything; never overwrite unknown work.
    for target, replacement in pending:
        target.write_bytes(replacement)
    return [patch['id'] for patch in manifest['patches']]


def install_runtime(model):
    if not hardware()['appleSilicon']:
        raise RuntimeFailure('UNSUPPORTED_HARDWARE', 'El motor requiere un Mac Apple Silicon.')
    meta = CATALOG['models'][model]['runtime']
    checkout = RUNTIME / 'vendor' / ('h3' if model == 'minimax-h3' else 'ltx-mlx')
    def checked(args, cwd=None):
        emit('progress', stage='install', message='Preparando el motor local y sus dependencias.')
        process = subprocess.Popen([str(a) for a in args], cwd=cwd, stdout=sys.stderr, stderr=sys.stderr, start_new_session=True)
        def stop_install(signum, _frame):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            raise RuntimeFailure('CANCELLED', 'Instalación cancelada.')
        previous = {sig: signal.signal(sig, stop_install) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            rc = process.wait()
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        if rc:
            raise RuntimeFailure('INSTALL_FAILED', 'Falló la instalación del motor.', exitCode=rc)
    if not checkout.exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        checked(['git', 'clone', '--no-checkout', '--filter=blob:none', meta['repository'], checkout])
        checked(['git', 'checkout', meta['revision']], cwd=checkout)
    head = run_read(['git', '-C', str(checkout), 'rev-parse', 'HEAD'])
    if head != meta['revision']:
        raise RuntimeFailure('RUNTIME_VERSION_MISMATCH', 'La copia existente usa otra versión; se conserva sin modificar.', actual=head, expected=meta['revision'])
    if model == 'minimax-h3':
        apply_h3_runtime_patches(checkout)
        checked(['make', '-j6'], cwd=checkout)
    else:
        uv = shutil.which('uv')
        if not uv:
            raise RuntimeFailure('UV_MISSING', 'Instala uv para preparar Python 3.12 aislado: https://docs.astral.sh/uv/getting-started/installation/')
        venv = RUNTIME / '.venv'
        if not (venv / 'bin' / 'python').exists():
            checked([uv, 'venv', '--python', '3.12', venv])
        checked([uv, 'pip', 'install', '--python', venv / 'bin' / 'python', '-r', RUNTIME / 'requirements-mlx.txt'])
        checked([uv, 'pip', 'install', '--python', venv / 'bin' / 'python', '--no-deps', '-e', checkout])
    emit('result', model=model, enginePath=str(executable(model)), installed=True, weightsDownloaded=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('doctor'); p.add_argument('--json', action='store_true')
    p = sub.add_parser('generate'); p.add_argument('--request', required=True, help='JSON file, inline JSON, or - for stdin')
    p = sub.add_parser('configure-memory'); p.add_argument('--mode', choices=['auto', 'ssd', 'ram'], required=True); p.add_argument('--json', action='store_true')
    p = sub.add_parser('quantized-status'); p.add_argument('--json', action='store_true')
    p = sub.add_parser('configure-quantized'); p.add_argument('--variant', choices=['bf16', 'gguf-q4', 'gguf-q8'], required=True)
    p = sub.add_parser('prepare-quantized'); p.add_argument('--variant', choices=['gguf-q4', 'gguf-q8'], required=True); p.add_argument('--model-dir', required=True); p.add_argument('--accept-license', action='store_true')
    p = sub.add_parser('record-quantized-trial'); p.add_argument('--variant', choices=['gguf-q4', 'gguf-q8'], required=True); p.add_argument('--result', required=True)
    p = sub.add_parser('review-quantized-trial'); p.add_argument('--variant', choices=['gguf-q4', 'gguf-q8'], required=True); p.add_argument('--trial-id', required=True); p.add_argument('--accept', action='store_true')
    for command in ('download-plan', 'download', 'install-runtime', 'configure', 'verify'):
        p = sub.add_parser(command)
        p.add_argument('--model', choices=list(MODEL_NAMES), default='minimax-h3')
        p.add_argument('--model-dir')
        p.add_argument('--with-references', action='store_true')
        p.add_argument('--json', action='store_true')
        if command == 'download':
            p.add_argument('--accept-license', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'doctor':
            print(json.dumps(doctor(), ensure_ascii=False, indent=None if args.json else 2))
        elif args.command == 'quantized-status':
            print(json.dumps(h3_quantized.status(), ensure_ascii=False))
        elif args.command == 'configure-quantized':
            emit('result', **h3_quantized.activate(args.variant))
        elif args.command == 'prepare-quantized':
            emit('result', **h3_quantized.prepare(args.variant, args.model_dir, args.accept_license, emit))
        elif args.command == 'record-quantized-trial':
            emit('result', **h3_quantized.record_trial(args.variant, args.result))
        elif args.command == 'review-quantized-trial':
            emit('result', **h3_quantized.review_trial(args.variant, args.trial_id, args.accept))
        elif args.command == 'configure-memory':
            print(json.dumps(configure_memory(args.mode), ensure_ascii=False))
        elif args.command == 'generate':
            value = sys.stdin.read() if args.request == '-' else args.request if args.request.lstrip().startswith('{') else Path(args.request).read_text()
            generate(json.loads(value))
        elif args.command == 'download-plan':
            print(json.dumps(download_plan(args.model, args.model_dir, args.with_references), ensure_ascii=False))
        elif args.command == 'download':
            download(args.model, args.model_dir, args.with_references, args.accept_license)
        elif args.command == 'install-runtime':
            install_runtime(args.model)
        elif args.command == 'verify':
            verify_model(args.model, args.with_references)
        elif args.command == 'configure':
            if not args.model_dir:
                raise RuntimeFailure('INVALID_PATH', 'Indica --model-dir.')
            emit('result', model=args.model, directory=configure(args.model, args.model_dir, references=True if args.with_references else None))
        return 0
    except RuntimeFailure as exc:
        emit('error', code=exc.code, message=exc.message, **exc.details)
        return 2
    except (OSError, ValueError, KeyError) as exc:
        emit('error', code='INVALID_REQUEST' if args.command == 'generate' else 'RUNTIME_ERROR', message=str(exc))
        return 2
    except subprocess.CalledProcessError as exc:
        emit('error', code='RUNTIME_BUILD_FAILED', message='No se pudo compilar el adaptador local.', detail=str(exc.stderr)[-2000:])
        return 2


if __name__ == '__main__':
    sys.modules.setdefault('filmma_runtime', sys.modules[__name__])
    sys.exit(main())
