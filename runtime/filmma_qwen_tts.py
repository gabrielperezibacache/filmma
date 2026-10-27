#!/usr/bin/env python3
"""Read-only bridge to the Qwen3-TTS GGUF installation already used by Hermes."""
import argparse
from array import array
import contextlib
import fcntl
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
import wave

ROOT = Path(__file__).resolve().parent / 'qwen'
CONNECTION = ROOT / 'connection.json'
MAX_TEXT = 600
MAX_DURATION = 15.0
MAX_FRAMES = 256
THREADS = 4
MAX_RSS = 8 * 1024**3
VOICE = 'hermes-default'
CHILD = None


class QwenError(Exception):
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


def connection():
    try:
        config = json.loads(CONNECTION.read_text())
        for key in ['binaryPath', 'modelPath', 'projectorPath', 'referencePath']:
            config[key] = Path(config[key]).expanduser().resolve()
        if config['schemaVersion'] != 1:
            raise ValueError('version')
        for key in ['modelSha256', 'projectorSha256']:
            if not re.fullmatch(r'[a-f0-9]{64}', config[key]):
                raise ValueError('hash')
        return config
    except (OSError, ValueError, KeyError, TypeError):
        raise QwenError('QWEN_CONNECTION', 'No se encuentra una conexión válida con la instalación Qwen de Hermes.')


def signature(path):
    stat = Path(path).stat()
    return [str(Path(path).resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino]


def ffmpeg():
    result = shutil.which('ffmpeg')
    if not result and Path('/opt/homebrew/bin/ffmpeg').is_file():
        result = '/opt/homebrew/bin/ffmpeg'
    return result


def doctor():
    """Probe models separately from the optional legacy Hermes speaker reference."""
    errors, missing, reference_errors, config = [], [], [], {}
    reference_hash = None
    supported = platform.system() == 'Darwin' and platform.machine() == 'arm64'
    try:
        config = connection()
        for key, label in [('binaryPath', 'Motor llama-tts de Hermes'), ('modelPath', 'Modelo Qwen GGUF'),
                           ('projectorPath', 'Proyector de audio Qwen')]:
            path = config[key]
            if not path.is_file():
                missing.append(label)
            elif key in ['modelPath', 'projectorPath']:
                prefix = 'model' if key == 'modelPath' else 'projector'
                with path.open('rb') as handle:
                    header = handle.read(4)
                if header != b'GGUF' or path.stat().st_size != config[prefix + 'Bytes']:
                    errors.append('El archivo de %s no coincide con la conexión guardada.' % label)
            elif not os.access(path, os.X_OK):
                errors.append('El motor de Hermes no tiene permiso de ejecución.')
        if not ffmpeg():
            missing.append('FFmpeg para conservar el tono al ajustar el ritmo')
        try:
            with wave.open(str(config['referencePath']), 'rb') as audio:
                if audio.getnframes() < 1 or audio.getnchannels() not in [1, 2] or audio.getnframes() / audio.getframerate() > 120:
                    raise ValueError('invalid reference')
            reference_hash = sha256(config['referencePath'])
        except (OSError, wave.Error, ValueError):
            reference_errors.append('La referencia de Hermes no está disponible; puedes usar una voz propia conservada en la película.')
    except (QwenError, OSError, ValueError) as error:
        errors.append(str(error))
    model_ready = supported and not missing and not errors
    ready = model_ready and not reference_errors
    return {'ok': True, 'ready': ready, 'modelReady': model_ready, 'available': model_ready, 'supported': supported,
            'installed': not missing and bool(config), 'engine': 'qwen', 'provider': 'llama.cpp/Metal',
            'model': config.get('model', 'Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M'),
            'modelRevision': config.get('modelRevision'), 'modelSha256': config.get('modelSha256'),
            'referenceSha256': reference_hash, 'threads': THREADS, 'modelBytes': config.get('modelBytes', 0) + config.get('projectorBytes', 0),
            'downloadBytes': 0, 'status': 'ready' if model_ready else 'unsupported' if not supported else 'missing' if missing else 'error',
            'voices': [{'id': VOICE, 'voiceId': VOICE, 'name': 'Voz de Hermes', 'label': 'Voz de Hermes',
                        'language': 'es', 'languages': ['es', 'en'], 'referenceSha256': reference_hash}] if ready else [],
            'languages': ['es', 'en'], 'minSpeed': .7, 'maxSpeed': 1.3,
            'maxTextCharacters': MAX_TEXT, 'maxDurationSeconds': MAX_DURATION,
            'connection': {key: str(config[key]) for key in ['binaryPath', 'modelPath', 'projectorPath', 'referencePath'] if key in config},
            'message': ('Qwen local conectado a los modelos existentes de Hermes; admite una referencia propia por personaje.' if ready else
                        'Este perfil requiere Apple Silicon.' if not supported else '; '.join(errors + ['Falta ' + item for item in missing] + reference_errors)),
            'missing': missing, 'errors': errors, 'referenceErrors': reference_errors,
            'limitations': ['Las referencias de personajes se guardan en la película sin modificar la voz predeterminada de Hermes.',
                            'El ritmo se ajusta después de sintetizar, sin cambiar el tono.',
                            'La referencia fija ayuda a la continuidad, pero la interpretación necesita revisión.']}


def validate_request(request):
    if not isinstance(request, dict):
        raise QwenError('INVALID_REQUEST', 'El diálogo debe ser un objeto JSON.')
    text = request.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT or any(ord(c) < 32 and c not in '\n\t' for c in text):
        raise QwenError('INVALID_TEXT', 'Escribe entre 1 y 600 caracteres de diálogo.')
    voice = request.get('voiceId', VOICE)
    reference = request.get('referencePath')
    if voice != VOICE and (not isinstance(voice, str) or not re.fullmatch(r'profile-[a-zA-Z0-9_-]{1,100}', voice) or not reference):
        raise QwenError('INVALID_VOICE', 'Selecciona una voz de Hermes o un perfil conservado en Filmma.')
    if reference is not None:
        if voice == VOICE or not isinstance(reference, str) or '\0' in reference or not Path(reference).is_absolute() or Path(reference).suffix.lower() != '.wav':
            raise QwenError('INVALID_REFERENCE', 'El perfil requiere una referencia WAV absoluta propia.')
        reference = Path(reference).resolve()
        if not request.get('expectedReferenceSha256'):
            raise QwenError('INVALID_REFERENCE', 'El perfil necesita la huella de su referencia inmutable.')
    language = request.get('language', 'es')
    if language not in ['es', 'en']:
        raise QwenError('INVALID_LANGUAGE', 'Selecciona español o inglés para esta conexión.')
    speed = request.get('speed', 1)
    if isinstance(speed, bool) or not isinstance(speed, (float, int)) or not math.isfinite(speed) or not .7 <= speed <= 1.3:
        raise QwenError('INVALID_SPEED', 'El ritmo de Qwen debe estar entre 0,7 y 1,3.')
    maximum = request.get('maxDurationSeconds', MAX_DURATION)
    if isinstance(maximum, bool) or not isinstance(maximum, (float, int)) or not math.isfinite(maximum) or not 0 < maximum <= MAX_DURATION:
        raise QwenError('INVALID_DURATION', 'Cada diálogo admite como máximo 15 segundos.')
    expected = request.get('expectedReferenceSha256')
    if expected is not None and (not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected)):
        raise QwenError('INVALID_REFERENCE', 'La huella de la voz de referencia no es válida.')
    path = request.get('outputPath')
    if not isinstance(path, str) or not path or '\0' in path:
        raise QwenError('INVALID_OUTPUT', 'La salida debe ser una ruta absoluta WAV nueva.')
    candidate = Path(path).expanduser()
    if not candidate.is_absolute() or candidate.suffix.lower() != '.wav':
        raise QwenError('INVALID_OUTPUT', 'La salida debe ser una ruta absoluta WAV nueva.')
    output = candidate.parent.resolve() / candidate.name
    if os.path.lexists(output):
        raise QwenError('OUTPUT_EXISTS', 'El destino ya existe; usa otro nombre para conservar los originales.')
    return {'text': text.strip(), 'voiceId': voice, 'language': language, 'speed': float(speed),
            'maxDurationSeconds': float(maximum), 'outputPath': output, 'expectedReferenceSha256': expected, 'referencePath': reference}


@contextlib.contextmanager
def exclusive_lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / '.worker.lock').open('a+') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise QwenError('QWEN_BUSY', 'Qwen ya está generando una voz en Filmma.')
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def terminate_child():
    if CHILD is not None and CHILD.poll() is None:
        try:
            os.killpg(CHILD.pid, signal.SIGTERM)
            CHILD.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(CHILD.pid, signal.SIGKILL)
            CHILD.wait()
        except ProcessLookupError:
            pass


def stop(_signum, _frame):
    terminate_child()
    raise QwenError('CANCELLED', 'Voz cancelada; los originales y Hermes siguen intactos.')


def run_process(command, log_path, timeout=900, monitor=False):
    global CHILD
    started, peak = time.monotonic(), 0
    # No HF token, cloud credentials, implicit download, or caller LLAMA_ARG override.
    env = {key: value for key, value in os.environ.items()
           if key in ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'DYLD_LIBRARY_PATH']}
    env.update({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'OMP_NUM_THREADS': str(THREADS)})
    with Path(log_path).open('wb') as log:
        CHILD = subprocess.Popen(command, stdout=log, stderr=log, env=env, start_new_session=True)
        last_sample = 0.0
        try:
            while CHILD.poll() is None:
                elapsed = time.monotonic() - started
                if elapsed > timeout:
                    raise QwenError('QWEN_TIMEOUT', 'Qwen superó el tiempo de espera. Acorta el diálogo e inténtalo de nuevo.')
                if monitor and elapsed - last_sample > 1:
                    competing = subprocess.run(['/usr/bin/pgrep', '-x', 'llama-tts'], capture_output=True, text=True, timeout=5)
                    if any(pid.isdigit() and int(pid) != CHILD.pid for pid in competing.stdout.split()):
                        raise QwenError('QWEN_BUSY', 'Hermes inició otra voz durante la generación. Filmma se detuvo para liberar memoria; inténtalo cuando termine.')
                    sampled = subprocess.run(['/bin/ps', '-o', 'rss=', '-p', str(CHILD.pid)], capture_output=True, text=True, timeout=5)
                    if sampled.stdout.strip().isdigit():
                        peak = max(peak, int(sampled.stdout.strip()) * 1024)
                    if peak > MAX_RSS:
                        raise QwenError('QWEN_MEMORY_LIMIT', 'Qwen superó la reserva de memoria del perfil de 36 GB; se detuvo sin publicar audio.')
                    last_sample = elapsed
                time.sleep(.15)
            if CHILD.returncode:
                raise QwenError('QWEN_ENGINE_FAILED', 'El motor local no pudo generar la voz. Revisa la conexión de Hermes.', exitCode=CHILD.returncode)
        except QwenError as error:
            terminate_child()
            log.flush()
            failure_dir = ROOT / 'failures'
            failure_dir.mkdir(parents=True, exist_ok=True)
            diagnostic = failure_dir / ('%s-%s.log' % (time.time_ns(), Path(log_path).name))
            shutil.copyfile(log_path, diagnostic)
            diagnostic.chmod(0o600)
            error.details['diagnosticPath'] = str(diagnostic)
            raise
        finally:
            terminate_child()
            CHILD = None
    return {'elapsedSeconds': round(time.monotonic() - started, 3), 'sampledPeakRssBytes': peak}


def verify_models(config):
    """Cache verified hashes against exact file identities, never trust size alone for inference."""
    receipt_path = ROOT / 'verified-models.json'
    try:
        receipt = json.loads(receipt_path.read_text())
    except (OSError, ValueError):
        receipt = {}
    next_receipt = {}
    for prefix in ['model', 'projector']:
        path = config[prefix + 'Path']
        before = signature(path)
        expected = config[prefix + 'Sha256']
        cached = receipt.get(prefix, {})
        if cached.get('signature') != before or cached.get('sha256') != expected:
            if sha256(path) != expected or signature(path) != before:
                raise QwenError('QWEN_MODEL_INTEGRITY', 'Los pesos existentes de Qwen no superan SHA256. Se han conservado sin cambios.')
        next_receipt[prefix] = {'signature': before, 'sha256': expected}
    temporary = receipt_path.with_suffix('.json.part')
    temporary.write_text(json.dumps(next_receipt))
    temporary.replace(receipt_path)
    return next_receipt


def build_command(config, request, prompt, output):
    return [str(config['binaryPath']), '--offline', '-m', str(config['modelPath']), '-mm', str(config['projectorPath']),
            '-f', str(prompt), '--no-escape', '--tts-lang', request['language'], '--tts-speaker-file', str(config['referencePath']),
            '-o', str(output), '-t', str(THREADS), '-tb', str(THREADS), '-c', '2048', '-b', '256', '-ub', '128',
            '-ngl', 'all', '--fit', 'off', '-n', str(MAX_FRAMES), '--seed', '42', '--log-colors', 'off']


def validate_completion(log):
    matches = re.findall(r'generated (\d+) frames,', log)
    if not matches:
        raise QwenError('QWEN_COMPLETION_UNKNOWN', 'El motor no confirmó el final del diálogo; no se publica un audio posiblemente incompleto.')
    frames = int(matches[-1])
    if frames >= MAX_FRAMES:
        raise QwenError('DURATION_LIMIT', 'La voz alcanzó el límite de generación. Acorta la línea; no se ha publicado un diálogo cortado.')
    return frames


def inspect_wav(path, maximum):
    try:
        with wave.open(str(path), 'rb') as audio:
            frames, rate = audio.getnframes(), audio.getframerate()
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or rate != 24000 or frames < 1:
                raise QwenError('INVALID_AUDIO', 'Qwen no produjo un WAV mono PCM16 de 24 kHz válido.')
            duration = frames / rate
            if duration > maximum:
                raise QwenError('DURATION_LIMIT', 'El diálogo supera su máximo de 15 segundos. Acorta la línea o ajusta el ritmo; no se ha recortado.',
                                duration=duration, maxDurationSeconds=maximum)
            samples = array('h', audio.readframes(frames))
            if len(samples) != frames:
                raise QwenError('INVALID_AUDIO', 'El archivo de voz está incompleto.')
            if sys.byteorder != 'little':
                samples.byteswap()
            peak = max(abs(value) for value in samples) / 32768
            silence = sum(abs(value) < 33 for value in samples) / frames
            if peak < .001 or silence > .995:
                raise QwenError('SILENT_AUDIO', 'El resultado no contiene suficiente voz audible.')
            return {'duration': duration, 'sampleRate': rate, 'channels': 1, 'sampleFormat': 'PCM_16',
                    'peakAmplitude': peak, 'silenceFraction': silence}
    except (OSError, wave.Error) as error:
        raise QwenError('INVALID_AUDIO', 'No se pudo verificar el audio generado.') from error


def synthesize(request):
    checked = validate_request(request)
    with exclusive_lock():
        return _synthesize(checked)


def _synthesize(request):
    started = time.monotonic()
    state = doctor()
    if not (state.get('modelReady', state['ready']) if request.get('referencePath') else state['ready']):
        raise QwenError('QWEN_NOT_READY', state['message'])
    if not request.get('referencePath') and request['expectedReferenceSha256'] and request['expectedReferenceSha256'] != state['referenceSha256']:
        raise QwenError('QWEN_REFERENCE_CHANGED', 'La voz de Hermes cambió desde que se eligió para este personaje. Revisa y vuelve a elegir la referencia antes de generar.')
    config = connection()
    if request.get('referencePath'):
        config = {**config, 'referencePath': request['referencePath']}
        reference_audio = inspect_wav(config['referencePath'], 30.001)
        if reference_audio['duration'] < 3:
            raise QwenError('INVALID_REFERENCE', 'La referencia del personaje debe durar entre 3 y 30 segundos.')
        if sha256(config['referencePath']) != request['expectedReferenceSha256']:
            raise QwenError('QWEN_REFERENCE_CHANGED', 'La referencia del personaje cambió; crea un perfil nuevo conservando el original.')
    # Hermes does not participate in Filmma's job queue. Do not overlap its active TTS.
    existing = subprocess.run(['/usr/bin/pgrep', '-x', 'llama-tts'], capture_output=True, text=True)
    if existing.returncode == 0:
        raise QwenError('QWEN_BUSY', 'Hermes u otra aplicación está usando Qwen. Espera a que termine esa voz.')
    emit('progress', progress=5, message='Comprobando los modelos y la referencia existentes de Hermes.')
    verified = verify_models(config)
    reference_hash = sha256(config['referencePath'])
    if reference_hash != (request['expectedReferenceSha256'] if request.get('referencePath') else state['referenceSha256']):
        raise QwenError('QWEN_REFERENCE_CHANGED', 'La referencia de Hermes cambió durante la comprobación; vuelve a seleccionar la voz.')
    binary_hash = sha256(config['binaryPath'])
    before = {key: signature(config[key]) for key in ['binaryPath', 'modelPath', 'projectorPath', 'referencePath']}
    output = request['outputPath']
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.filmma-qwen-', dir=str(output.parent)) as work:
        work = Path(work)
        prompt, raw, final = work / 'dialogue.txt', work / 'raw.wav', work / 'voice.wav'
        prompt.write_text(request['text'], encoding='utf-8')
        emit('progress', progress=20, message='Interpretando el diálogo con Qwen y la referencia de voz.')
        metrics = run_process(build_command(config, request, prompt, raw), work / 'engine.log', monitor=True)
        generated_frames = validate_completion((work / 'engine.log').read_text(errors='replace'))
        if not raw.is_file() or raw.stat().st_size > 16 * 1024**2:
            raise QwenError('INVALID_AUDIO', 'El motor no produjo un archivo de audio válido.')
        emit('progress', progress=85, message='Ajustando el ritmo sin cambiar el tono y verificando el diálogo completo.')
        tempo_filter = 'anull' if request['speed'] == 1 else 'atempo=%.6f' % request['speed']
        command = [ffmpeg(), '-hide_banner', '-nostdin', '-v', 'error', '-n', '-i', str(raw), '-map', '0:a:0', '-vn',
                   '-af', tempo_filter, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(final)]
        run_process(command, work / 'audio.log', timeout=60)
        audio = inspect_wav(final, request['maxDurationSeconds'])
        if any(signature(config[key]) != value for key, value in before.items()) or sha256(config['referencePath']) != reference_hash:
            raise QwenError('QWEN_SOURCE_CHANGED', 'La instalación o la referencia de Hermes cambió mientras se generaba. Se conserva todo y se descarta esta copia sin aplicarla.')
        try:
            os.link(final, output)
        except FileExistsError:
            raise QwenError('OUTPUT_EXISTS', 'El destino se creó durante la generación; no se ha sobrescrito.')
    emit('progress', progress=100, message='Voz de Qwen verificada; los modelos y la referencia de Hermes siguen intactos.')
    return {'ok': True, 'engine': 'qwen', 'outputPath': str(output), 'voice': request['voiceId'], 'voiceId': request['voiceId'],
            'language': request['language'], 'speed': request['speed'], 'duration': audio['duration'], 'sampleRate': audio['sampleRate'],
            'channels': 1, 'sampleFormat': 'PCM_16', 'model': config['model'], 'modelRevision': config['modelRevision'],
            'modelSha256': verified['model']['sha256'], 'projectorSha256': verified['projector']['sha256'],
            'referenceSha256': reference_hash, 'runtimeSha256': binary_hash, 'sha256': sha256(output),
            'textSha256': hashlib.sha256(request['text'].encode()).hexdigest(),
            'metrics': {**metrics, 'elapsedSeconds': round(time.monotonic() - started, 3), 'provider': 'llama.cpp/Metal',
                        'threads': THREADS, 'contextTokens': 2048, 'seed': 42, 'generatedFrames': generated_frames,
                        'peakAmplitude': audio['peakAmplitude'], 'silenceFraction': audio['silenceFraction'],
                        'memoryScope': 'RSS del proceso llama-tts muestreado cada segundo; puede omitir picos y no mide memoria GPU/unificada total.',
                        'rssGuardBytes': MAX_RSS},
            'warnings': ['Revisa pronunciación y actuación; una referencia constante no garantiza una interpretación idéntica.',
                         'El audio utiliza la referencia inmutable del personaje.' if request.get('referencePath') else 'El audio utiliza la voz de referencia ya configurada en Hermes.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['doctor', 'setup', 'synthesize', 'generate'])
    parser.add_argument('--request')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        if args.command in ['doctor', 'setup']:
            result = doctor()
        else:
            if not args.request or Path(args.request).stat().st_size > 16384:
                raise QwenError('INVALID_REQUEST', 'Se requiere una solicitud JSON de hasta 16 KiB.')
            result = synthesize(json.loads(Path(args.request).read_text()))
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except QwenError as error:
        print(json.dumps({'ok': False, 'error': str(error), 'code': error.code, **error.details}, ensure_ascii=False), flush=True)
        raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error), 'code': 'QWEN_FAILED'}, ensure_ascii=False), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
