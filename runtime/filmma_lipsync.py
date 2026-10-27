#!/usr/bin/env python3
"""Filmma's isolated MuseTalk 1.5 MLX launcher. No cloud inference or source writes."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'lipsync'
ENV = BASE / '.venv'
MODELS = BASE / 'models' / 'MuseTalk-1.5-fp16'
VENDOR = BASE / 'vendor' / 'musetalk-mlx'
REVISION = 'ad54104a0129121fe2ea67471250c0656c985284'
CODE_REVISION = 'c6eb30ebd1ed4d043983209813370153de9346bf'
ARCHIVE_SHA = '5dc8ed647079957a10d6c8079122bc7be32e84516d7348500eff96a5e91aab67'
MODEL_FILES = {
 'config.json': (186, '527702bfd2111adab8b4713d4f70d920a479b5816cbb373731e791f6e3bd47d5'),
 'unet.safetensors': (1699979043, '12d1e2f496bc91e4db8c989cffa8aa94b3d6a7098ab9d80ba92a1f38cce362f2'),
 'vae.safetensors': (167335279, '2a7670782dbe0ab66c40833dfd431b193375f0bdfc7c2daf76f5bc4e59070f98'),
 'whisper_encoder.safetensors': (16423174, 'c04baf7220bbc73393eeba74b6224398ce56caad60e4e0a0f4c28af3180836d3'),
}
CHILD = None


def digest(path):
 h = hashlib.sha256()
 with Path(path).open('rb') as f:
  for block in iter(lambda: f.read(8 * 1024 * 1024), b''): h.update(block)
 return h.hexdigest()


def emit(event):
 print(json.dumps(event, ensure_ascii=False), flush=True)


def run(command, **kwargs):
 global CHILD
 CHILD = subprocess.Popen([str(v) for v in command], **kwargs)
 result = CHILD.communicate()
 code = CHILD.returncode
 CHILD = None
 if code: raise RuntimeError(f'El proceso local terminó con código {code}: ' + str(result[1] or '')[-3000:])
 return result


def stop(signum, _frame):
 if CHILD is not None and CHILD.poll() is None:
  CHILD.terminate()
  try: CHILD.wait(timeout=3)
  except subprocess.TimeoutExpired: CHILD.kill(); CHILD.wait()
 raise SystemExit(128 + signum)


def ffmpeg_path(name):
 found = shutil.which(name)
 if found: return found
 candidate = Path('/opt/homebrew/bin') / name
 return str(candidate) if candidate.is_file() else None


def manifest_current():
 try:
  record = json.loads((BASE / 'verified.json').read_text())
  return record['revision'] == REVISION and all(
   (MODELS / name).stat().st_size == info[0] and
   record['files'][name]['mtimeNs'] == (MODELS / name).stat().st_mtime_ns and
   record['files'][name]['sha256'] == info[1]
   for name, info in MODEL_FILES.items())
 except (OSError, KeyError, ValueError): return False


def doctor():
 supported = platform.system() == 'Darwin' and platform.machine() == 'arm64'
 installed = (ENV / 'bin/python').is_file() and (VENDOR / 'musetalk_mlx/pipeline_mlx.py').is_file()
 verified = manifest_current()
 ready = supported and installed and verified and bool(ffmpeg_path('ffmpeg')) and bool(ffmpeg_path('ffprobe'))
 return {'ok': True, 'ready': ready, 'installed': installed, 'weightsVerified': verified,
  'model': 'musetalk-1.5-mlx', 'modelRevision': REVISION, 'codeRevision': CODE_REVISION,
  'device': 'Apple Silicon · MLX Metal', 'downloadBytes': sum(v[0] for v in MODEL_FILES.values()),
  'maxDuration': 15, 'fps': 25, 'faceResolution': 256, 'license': 'MIT',
  'reason': None if ready else ('Requiere macOS en Apple Silicon.' if not supported else 'Prepara MuseTalk local para sincronizar los labios.'),
  'limitations': ['Un rostro visible y frontal durante todo el diálogo.', 'El rostro se procesa a 256 × 256; revisar labios y detalles de identidad.', 'La salida es una copia a 25 fps y no reemplaza el original.']}


def download(url, target, expected_size, expected_sha):
 target.parent.mkdir(parents=True, exist_ok=True)
 if target.is_file() and target.stat().st_size == expected_size and digest(target) == expected_sha: return
 part = target.with_name(target.name + '.part')
 offset = part.stat().st_size if part.is_file() else 0
 if offset == expected_size and digest(part) == expected_sha:
  part.replace(target); return
 if offset > expected_size: raise RuntimeError(f'Parcial inválido: {part.name}; conservar para diagnóstico.')
 request = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
 with urllib.request.urlopen(request, timeout=90) as response:
  append = offset > 0 and response.status == 206
  if not append: offset = 0
  with part.open('ab' if append else 'wb') as f:
   last = time.monotonic()
   while True:
    block = response.read(2 * 1024 * 1024)
    if not block: break
    f.write(block); offset += len(block)
    if time.monotonic() - last > 5:
     emit({'stage': 'download', 'file': target.name, 'bytes': offset, 'totalBytes': expected_size}); last = time.monotonic()
 if part.stat().st_size != expected_size or digest(part) != expected_sha:
  raise RuntimeError(f'No coincide SHA256 de {target.name}; se conserva el parcial para diagnóstico.')
 part.replace(target)


def ensure_vision():
 source = BASE / 'faces.swift'
 binary = BASE / ('faces-' + digest(source)[:16])
 if not binary.is_file():
  run(['xcrun', 'swiftc', '-O', '-module-cache-path', BASE / 'swift-cache', source, '-o', binary], stdout=sys.stderr, stderr=sys.stderr)
 return binary


def setup():
 BASE.mkdir(parents=True, exist_ok=True)
 if platform.system() != 'Darwin' or platform.machine() != 'arm64': raise RuntimeError('MuseTalk MLX requiere un Mac con Apple Silicon.')
 with (BASE / 'setup.lock').open('a+') as lock:
  try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
  except BlockingIOError: raise RuntimeError('Ya hay una preparación de MuseTalk en curso.')
  if shutil.disk_usage(BASE).free < 8 * 1024**3: raise RuntimeError('Se necesitan 8 GiB libres para preparar MuseTalk sin tocar otros archivos.')
  if not (ENV / 'bin/python').is_file():
   candidates = [ROOT / '.venv/bin/python', Path.home() / '.local/bin/python3.11']
   python = next((p.resolve() for p in candidates if p.is_file()), None)
   if not python: raise RuntimeError('Falta Python 3.11 o 3.12 para el entorno independiente.')
   run([python, '-m', 'venv', ENV], stdout=sys.stderr, stderr=sys.stderr)
  archive = BASE / 'musetalk-mlx.tar.gz'
  download('https://codeload.github.com/xocialize/musetalk-mlx/tar.gz/' + CODE_REVISION, archive, 212732, ARCHIVE_SHA)
  if not (VENDOR / 'musetalk_mlx/pipeline_mlx.py').is_file():
   VENDOR.parent.mkdir(parents=True, exist_ok=True)
   with tarfile.open(archive) as tar:
    for member in tar.getmembers():
     parts = Path(member.name).parts[1:]
     if not parts: continue
     if member.issym() or member.islnk() or any(p == '..' for p in parts): raise RuntimeError('Ruta inesperada en el paquete del motor.')
     destination = VENDOR.joinpath(*parts)
     if member.isdir(): destination.mkdir(parents=True, exist_ok=True)
     elif member.isfile():
      destination.parent.mkdir(parents=True, exist_ok=True)
      with tar.extractfile(member) as source, destination.open('wb') as output: shutil.copyfileobj(source, output)
     else: raise RuntimeError('Tipo de archivo inesperado en el paquete del motor.')
  emit({'stage': 'dependencies', 'message': 'Preparando entorno independiente de MuseTalk.'})
  run([ENV / 'bin/python', '-m', 'pip', 'install', '--disable-pip-version-check', '-r', BASE / 'requirements.txt'], stdout=sys.stderr, stderr=sys.stderr)
  run([ENV / 'bin/python', '-m', 'pip', 'install', '--no-deps', str(VENDOR)], stdout=sys.stderr, stderr=sys.stderr)
  for name, (size, sha) in MODEL_FILES.items():
   download(f'https://huggingface.co/mlx-community/MuseTalk-1.5-fp16/resolve/{REVISION}/{name}', MODELS / name, size, sha)
  record = {'revision': REVISION, 'files': {name: {'sha256': digest(MODELS / name), 'mtimeNs': (MODELS / name).stat().st_mtime_ns} for name in MODEL_FILES}}
  (BASE / 'verified.json').write_text(json.dumps(record, indent=2))
  ensure_vision()
  emit(doctor())


def finite(value, name, low, high):
 if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
  raise ValueError(f'{name} debe estar entre {low} y {high}.')
 return float(value)


def validate_request(request):
 source = Path(request['sourcePath']).resolve(strict=True)
 audio = Path(request['audioPath']).resolve(strict=True)
 output = Path(request['outputPath']).resolve()
 if not source.is_file() or not audio.is_file(): raise ValueError('Los originales deben ser archivos locales.')
 if output in (source, audio) or output.exists() or output.with_suffix('.lipsync.json').exists(): raise ValueError('La salida debe ser un archivo nuevo; los originales no se sobrescriben.')
 if output.suffix.lower() != '.mp4': raise ValueError('La copia sincronizada debe ser MP4.')
 trim = finite(request.get('trimStart', 0), 'Inicio', 0, 86400)
 speed = finite(request.get('speed', 1), 'Velocidad', .25, 4)
 duration = finite(request['duration'], 'Duración', .08, 15) if 'duration' in request else None
 roi = request.get('faceROI')
 if roi is not None:
  for field in ('x', 'y', 'width', 'height'): finite(roi.get(field), 'Zona del rostro', 0, 1)
  if roi['width'] <= 0 or roi['height'] <= 0 or roi['x'] + roi['width'] > 1 or roi['y'] + roi['height'] > 1:
   raise ValueError('La zona del rostro debe quedar dentro de la imagen.')
 return dict(request, sourcePath=str(source), audioPath=str(audio), outputPath=str(output), trimStart=trim, speed=speed, duration=duration)


def main():
 parser = argparse.ArgumentParser()
 parser.add_argument('command', choices=['doctor', 'setup', 'render'])
 parser.add_argument('--request'); parser.add_argument('--json', action='store_true')
 args = parser.parse_args()
 signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
 try:
  if args.command == 'doctor': emit(doctor())
  elif args.command == 'setup': setup()
  else:
   if not args.request: raise ValueError('Falta el archivo de solicitud.')
   request = validate_request(json.loads(Path(args.request).read_text()))
   if not doctor()['ready']: raise RuntimeError(doctor()['reason'])
   # Full SHA verification before inference; never rely only on the fast UI diagnostic.
   if any(digest(MODELS / name) != sha for name, (_, sha) in MODEL_FILES.items()): raise RuntimeError('Los pesos de MuseTalk no superan SHA256. Prepara el motor otra vez.')
   ensure_vision()
   os.execv(str(ENV / 'bin/python'), [str(ENV / 'bin/python'), str(BASE / 'worker.py'), '--request', str(Path(args.request).resolve())])
 except Exception as error:
  emit({'ok': False, 'error': 'LIPSYNC_FAILED', 'message': str(error)}); raise SystemExit(1)

if __name__ == '__main__': main()
