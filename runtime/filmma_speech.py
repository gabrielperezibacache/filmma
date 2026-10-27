#!/usr/bin/env python3
"""Isolated, bounded Kokoro speech worker. No cloud calls during synthesis."""
import argparse
import contextlib
import ctypes
import fcntl
import hashlib
import importlib.metadata
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
import time
import urllib.request
import wave

RUNTIME = Path(__file__).resolve().parent
SPEECH_ROOT = RUNTIME / 'speech'
MANIFEST = json.loads((SPEECH_ROOT / 'model.json').read_text())
MODELS = SPEECH_ROOT / 'models'
PYTHON = SPEECH_ROOT / '.venv' / 'bin' / 'python'
CHILD = None
MAX_TEXT = 600
MAX_DURATION = 15.0
DEPENDENCIES = {'kokoro-onnx': '0.6.1', 'onnxruntime': '1.23.2', 'numpy': '2.2.6',
                'phonemizer': '3.4.0', 'espeakng-loader': '0.2.4'}


class SpeechError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details


def emit(event, **data):
    print(json.dumps({'event': event, **data}, ensure_ascii=False), file=sys.stderr, flush=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


@contextlib.contextmanager
def exclusive_lock():
    SPEECH_ROOT.mkdir(parents=True, exist_ok=True)
    with (SPEECH_ROOT / '.worker.lock').open('a+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SpeechError('SPEECH_BUSY', 'Ya hay una preparación o voz en curso. Espera a que termine.')
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def stop(signum, _frame):
    if CHILD is not None and CHILD.poll() is None:
        CHILD.terminate()
        try:
            CHILD.wait(timeout=2)
        except subprocess.TimeoutExpired:
            CHILD.kill()
            CHILD.wait()
    raise SpeechError('CANCELLED', 'Preparación o síntesis cancelada; los originales siguen intactos.')


def run_child(command, timeout=1800):
    global CHILD
    env = dict(os.environ, UV_CACHE_DIR=str(SPEECH_ROOT / 'cache'), PIP_DISABLE_PIP_VERSION_CHECK='1')
    CHILD = subprocess.Popen(command, stdout=sys.stderr, stderr=sys.stderr, env=env)
    try:
        code = CHILD.wait(timeout=timeout)
        if code:
            raise SpeechError('DEPENDENCY_INSTALL_FAILED', 'No se pudo preparar el entorno de voces.', exitCode=code)
    except subprocess.TimeoutExpired:
        CHILD.kill()
        CHILD.wait()
        raise SpeechError('SETUP_TIMEOUT', 'La preparación de voces superó su tiempo máximo. Puedes reanudarla.')
    finally:
        CHILD = None


def probe_environment():
    errors = []
    for package, expected in DEPENDENCIES.items():
        try:
            if importlib.metadata.version(package) != expected:
                errors.append('Versión distinta de la comprobada: ' + package)
        except importlib.metadata.PackageNotFoundError:
            errors.append('Falta ' + package)
    if not errors:
        try:
            import espeakng_loader
            import onnxruntime
            ctypes.cdll.LoadLibrary(espeakng_loader.get_library_path())
            if 'CPUExecutionProvider' not in onnxruntime.get_available_providers():
                errors.append('Falta el proveedor CPU de ONNX.')
        except Exception as error:
            errors.append('No se puede cargar el motor: ' + str(error))
    return errors


def doctor():
    errors, missing = [], []
    supported = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    if PYTHON.is_file():
        try:
            result = subprocess.run([str(PYTHON), str(Path(__file__).resolve()), '_probe', '--json'],
                                    capture_output=True, text=True, timeout=20)
            errors.extend(json.loads(result.stdout)['errors'])
        except Exception:
            errors.append('El entorno aislado necesita reparación.')
    else:
        missing.append('Entorno Python de voces')
    for entry in MANIFEST['files']:
        target = MODELS / entry['name']
        if not target.is_file():
            missing.append(entry['name'])
        elif target.stat().st_size != entry['bytes'] or sha256(target) != entry['sha256']:
            errors.append('Verificación SHA256 fallida: ' + entry['name'])
    ready = supported and not errors and not missing
    return {'ok': True, 'ready': ready, 'available': ready, 'supported': supported,
            'installed': not missing, 'status': 'ready' if ready else 'unsupported' if not supported else 'error' if errors else 'missing',
            'engine': MANIFEST['engine'], 'engineVersion': MANIFEST['engineVersion'], 'model': MANIFEST['model'],
            'provider': MANIFEST['provider'], 'threads': MANIFEST['threads'], 'voices': MANIFEST['voices'],
            'downloadBytes': 0 if ready else sum(entry['bytes'] for entry in MANIFEST['files']
                if not (MODELS / entry['name']).is_file()),
            'modelBytes': sum(entry['bytes'] for entry in MANIFEST['files']),
            'maxTextCharacters': MAX_TEXT, 'maxDurationSeconds': MAX_DURATION,
            'message': ('Voces locales listas: Kokoro, CPU y tres voces en español.' if ready else
                        'Este perfil requiere un Mac con Apple Silicon.' if not supported else
                        '; '.join(errors) if errors else 'Prepara las voces locales (354 MB de modelos).'),
            'missing': missing, 'errors': errors,
            'limitations': ['Las voces son predefinidas; no clonan una grabación.',
                            'Revisa la pronunciación de nombres, el acento y la interpretación antes de exportar.']}


def download(entry, completed_bytes=0, total_bytes=None):
    """Resume an incomplete official artifact; publish only after exact size/hash."""
    target = MODELS / entry['name']
    partial = target.with_name(target.name + '.part')
    if target.is_file():
        if target.stat().st_size == entry['bytes'] and sha256(target) == entry['sha256']:
            return
        raise SpeechError('MODEL_INTEGRITY', 'Un modelo instalado no supera SHA256. Se conserva para revisión.', file=str(target))
    offset = partial.stat().st_size if partial.is_file() else 0
    if offset > entry['bytes']:
        raise SpeechError('PARTIAL_INTEGRITY', 'El archivo parcial supera el tamaño esperado. Se conserva para revisión.', file=str(partial))
    if offset < entry['bytes']:
        headers = {'User-Agent': 'Filmma-Speech/1.0'}
        if offset:
            headers['Range'] = 'bytes=%s-' % offset
        request = urllib.request.Request(entry['url'], headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            if offset and response.status == 206:
                expected = 'bytes %s-' % offset
                if not response.headers.get('Content-Range', '').startswith(expected):
                    raise SpeechError('INVALID_RANGE', 'El servidor no devolvió el segmento solicitado.')
            elif offset and response.status == 200:
                # The server ignored Range. Keep the old partial until the full retry verifies.
                raise SpeechError('RESUME_UNSUPPORTED', 'El servidor no permite reanudar ahora. Se conserva el archivo parcial.')
            elif response.status != 200:
                raise SpeechError('DOWNLOAD_STATUS', 'La descarga devolvió un estado inesperado.', status=response.status)
            last = 0.0
            with partial.open('ab' if partial.exists() else 'xb') as handle:
                while True:
                    block = response.read(1024**2)
                    if not block:
                        break
                    if offset + len(block) > entry['bytes']:
                        raise SpeechError('DOWNLOAD_SIZE', 'La descarga supera el tamaño fijado. Se detuvo sin publicar el modelo.')
                    handle.write(block)
                    offset += len(block)
                    now = time.monotonic()
                    if now - last > 1:
                        emit('progress', progress=round(10 + 80 * (completed_bytes + offset) / (total_bytes or entry['bytes']), 1),
                             message='Descargando ' + entry['name'], bytes=offset, totalBytes=entry['bytes'])
                        last = now
    if partial.stat().st_size != entry['bytes'] or sha256(partial) != entry['sha256']:
        raise SpeechError('MODEL_INTEGRITY', 'La descarga no supera la verificación SHA256; se conserva el parcial.', file=str(partial))
    os.link(partial, target)
    partial.unlink()


def setup():
    with exclusive_lock():
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise SpeechError('UNSUPPORTED_PLATFORM', 'Este perfil de voces requiere un Mac con Apple Silicon.')
        MODELS.mkdir(parents=True, exist_ok=True)
        needed = sum(max(0, entry['bytes'] - ((MODELS / entry['name']).stat().st_size
                     if (MODELS / entry['name']).is_file() else
                     (MODELS / (entry['name'] + '.part')).stat().st_size
                     if (MODELS / (entry['name'] + '.part')).is_file() else 0)) for entry in MANIFEST['files'])
        if shutil.disk_usage(SPEECH_ROOT).free < needed + 2 * 1024**3:
            raise SpeechError('INSUFFICIENT_DISK', 'Se necesitan los modelos pendientes y una reserva de 2 GiB.')
        uv = shutil.which('uv') or str(Path.home() / '.local' / 'bin' / 'uv')
        if not Path(uv).is_file():
            raise SpeechError('UV_MISSING', 'Falta el instalador local uv que utiliza Filmma.')
        if not PYTHON.is_file():
            candidates = [RUNTIME / '.venv' / 'bin' / 'python', Path(sys.executable)]
            python = next((str(candidate) for candidate in candidates if candidate.is_file()), None)
            emit('progress', progress=1, message='Preparando un entorno de voces separado del motor de video.')
            run_child([uv, 'venv', '--python', python or '3.12', str(SPEECH_ROOT / '.venv')])
        emit('progress', progress=4, message='Comprobando dependencias fijadas y sus huellas.')
        run_child([uv, 'pip', 'install', '--python', str(PYTHON), '--require-hashes',
                   '--only-binary', ':all:', '-r', str(SPEECH_ROOT / 'requirements.lock')])
        completed_bytes = 0
        total_bytes = sum(entry['bytes'] for entry in MANIFEST['files'])
        for entry in MANIFEST['files']:
            download(entry, completed_bytes, total_bytes)
            completed_bytes += entry['bytes']
        state = doctor()
        if not state['ready']:
            raise SpeechError('SPEECH_NOT_READY', state['message'])
        emit('progress', progress=100, message='Voces locales verificadas y listas.')
        return state


def validate_request(request):
    if not isinstance(request, dict):
        raise SpeechError('INVALID_REQUEST', 'La solicitud de voz debe ser un objeto JSON.')
    text = request.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT or '\x00' in text:
        raise SpeechError('INVALID_TEXT', 'Cada diálogo admite entre 1 y 600 caracteres sin caracteres nulos.')
    text = text.strip()
    language = request.get('language', 'es')
    voice = request.get('voiceId', request.get('voice', 'ef_dora'))
    if not any(item['id'] == voice and item['language'] == language for item in MANIFEST['voices']):
        raise SpeechError('INVALID_VOICE', 'La voz no pertenece al idioma seleccionado.')
    speed = request.get('speed', 1.0)
    maximum = request.get('maxDurationSeconds', MAX_DURATION)
    if isinstance(speed, bool) or not isinstance(speed, (float, int)) or not math.isfinite(speed) or not 0.5 <= speed <= 2.0:
        raise SpeechError('INVALID_SPEED', 'La velocidad de voz debe estar entre 0,5 y 2.')
    if isinstance(maximum, bool) or not isinstance(maximum, (float, int)) or not math.isfinite(maximum) or not 0 < maximum <= MAX_DURATION:
        raise SpeechError('INVALID_DURATION', 'Cada diálogo admite un máximo de 15 segundos.')
    path = request.get('outputPath')
    if not isinstance(path, str) or not path or '\x00' in path:
        raise SpeechError('INVALID_OUTPUT', 'Falta una ruta WAV nueva.')
    candidate = Path(path).expanduser()
    if not candidate.is_absolute() or candidate.suffix.lower() != '.wav':
        raise SpeechError('INVALID_OUTPUT', 'La salida debe ser una ruta absoluta WAV.')
    # Resolve the parent, never follow a pre-existing final symlink.
    output = candidate.parent.resolve() / candidate.name
    if os.path.lexists(output):
        raise SpeechError('OUTPUT_EXISTS', 'El destino ya existe. Usa un nombre nuevo para conservar los originales.')
    return {'text': text, 'language': language, 'voice': voice, 'speed': float(speed),
            'maxDurationSeconds': float(maximum), 'outputPath': output}


def synthesize(request):
    checked = validate_request(request)
    with exclusive_lock():
        return _synthesize(checked)


def _synthesize(request):
    started = time.monotonic()
    state = doctor()
    if not state['ready']:
        raise SpeechError('SPEECH_NOT_READY', state['message'])
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    options = ort.SessionOptions()
    options.intra_op_num_threads = MANIFEST['threads']
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    emit('progress', progress=10, message='Cargando la voz local en CPU.')
    session = ort.InferenceSession(str(MODELS / MANIFEST['files'][0]['name']), options,
                                   providers=['CPUExecutionProvider'])
    kokoro = Kokoro.from_session(session, str(MODELS / MANIFEST['files'][1]['name']))
    emit('progress', progress=35, message='Interpretando el diálogo con la voz del personaje.')
    try:
        audio, sample_rate = kokoro.create(request['text'], voice=request['voice'], speed=request['speed'],
                                          lang='es' if request['language'] == 'es' else 'en-us')
    finally:
        kokoro.voices.close()
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    duration = len(audio) / sample_rate
    if not len(audio) or not np.isfinite(audio).all():
        raise SpeechError('INVALID_AUDIO', 'El motor no produjo audio válido.')
    if duration > request['maxDurationSeconds']:
        raise SpeechError('DURATION_LIMIT', 'El diálogo supera 15 segundos. Acorta la línea o aumenta su velocidad; no se ha recortado.',
                          duration=duration, maxDurationSeconds=request['maxDurationSeconds'])
    peak = float(np.max(np.abs(audio)))
    silence = float(np.mean(np.abs(audio) < 0.001))
    if peak < 0.001 or silence > 0.995:
        raise SpeechError('SILENT_AUDIO', 'El resultado no contiene voz audible suficiente.')
    gain = min(1.0, 0.98 / peak)
    output = request['outputPath']
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + '.%s.part' % os.getpid())
    emit('progress', progress=95, message='Verificando y guardando un original WAV nuevo.')
    try:
        with temporary.open('xb') as handle:
            with wave.open(handle, 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(sample_rate)
                wav.writeframes(np.rint(audio * gain * 32767).astype('<i2').tobytes())
        # No overwrite, including a destination created while synthesis ran.
        os.link(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if platform.system() != 'Darwin':
        peak_rss *= 1024
    result = {'ok': True, 'outputPath': str(output), 'duration': duration, 'sampleRate': sample_rate,
              'channels': 1, 'sampleFormat': 'PCM_16', 'voice': request['voice'], 'voiceId': request['voice'],
              'language': request['language'], 'speed': request['speed'], 'model': MANIFEST['model'], 'engine': 'kokoro',
              'modelSha256': MANIFEST['files'][0]['sha256'], 'sha256': sha256(output),
              'textSha256': hashlib.sha256(request['text'].encode()).hexdigest(),
              'metrics': {'elapsedSeconds': round(time.monotonic() - started, 3), 'peakRssBytes': peak_rss,
                          'peakAmplitude': peak * gain, 'silenceFraction': silence, 'appliedGain': gain,
                          'provider': 'CPUExecutionProvider', 'threads': MANIFEST['threads'],
                          'memoryScope': 'Peak RSS del proceso; no incluye otros procesos ni memoria total del sistema.'},
              'warnings': ['Revisa la pronunciación, el acento y la interpretación antes de exportar.']}
    emit('progress', progress=100, message='Diálogo local terminado y verificado.')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['doctor', 'setup', 'install', 'synthesize', 'generate', '_probe'])
    parser.add_argument('--request')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        if args.command == '_probe':
            result = {'errors': probe_environment()}
        elif args.command == 'doctor':
            result = doctor()
        elif args.command in ('setup', 'install'):
            result = setup()
        else:
            if not args.request:
                raise SpeechError('INVALID_REQUEST', 'Falta --request con el archivo JSON del diálogo.')
            request_path = Path(args.request)
            if request_path.stat().st_size > 16384:
                raise SpeechError('INVALID_REQUEST', 'La solicitud supera 16 KiB.')
            request = json.loads(request_path.read_text())
            validate_request(request)
            if Path(sys.prefix).resolve() != (SPEECH_ROOT / '.venv').resolve():
                if not PYTHON.is_file():
                    raise SpeechError('SPEECH_NOT_READY', 'Prepara primero las voces locales.')
                os.execv(str(PYTHON), [str(PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])
            result = synthesize(request)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except SpeechError as error:
        print(json.dumps({'ok': False, 'error': str(error), 'code': error.code, **error.details}, ensure_ascii=False), flush=True)
        raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error), 'code': 'SPEECH_FAILED'}, ensure_ascii=False), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
