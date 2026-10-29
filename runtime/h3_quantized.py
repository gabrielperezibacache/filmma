"""Optional H3 GGUF backend. BF16 paths and original assets remain untouched."""
import json
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import uuid
import time

from model_transfer import file_matches, transfer

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / 'runtime/vendor/h3-gguf-candidate'
BINARY = ENGINE / 'filmma-h3-gguf'
REVISION = '754858b4f28acd537d16a6ad97c5ee0f0635e950'
VALIDATION = ROOT / 'runtime/validation/h3-quantized/latest.json'
Q8 = {
    'FL2VA/transformer/model.gguf': (21437786208, '1c77759fd30e4b41dd4fb341d684518177f544428c6186fd9f5fd96f8ebf55d4'),
    'Ref2VA/transformer/model.gguf': (21414002784, '60f8a47434ec9a925f0aea41d9e0db9cb78ebc46791b7488d621dbd6905e5d89'),
}


def catalog(variant='gguf-q4'):
    if variant not in ('gguf-q4', 'gguf-q8'):
        raise ValueError('Variante cuantizada desconocida.')
    result = json.loads((ROOT / 'runtime/h3-gguf-catalog.json').read_text())
    result['variant'] = variant
    if variant == 'gguf-q8':
        for entry in result['files']:
            if entry['path'] in Q8:
                entry['size'], entry['sha256'] = Q8[entry['path']]
                entry['url'] = entry['url'].replace('-Q4_K.gguf', '-Q8_0.gguf')
    return result


def catalog_digest(variant):
    return hashlib.sha256(json.dumps(catalog(variant), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def directory(variant):
    import filmma_runtime as r
    configured = r.config().get('models', {}).get('minimax-h3', {}).get('quantized', {}).get('directories', {})
    return Path(configured.get(variant, str(ROOT / 'runtime/models' / ('minimax-h3-' + variant)))).expanduser().resolve()


def active():
    import filmma_runtime as r
    value = r.config().get('models', {}).get('minimax-h3', {}).get('variant', 'bf16')
    if value not in ('bf16', 'gguf-q4', 'gguf-q8'):
        raise ValueError('Variante MiniMax configurada desconocida; no se sustituye silenciosamente.')
    return None if value == 'bf16' else value


def files(variant, references=False):
    destination = directory(variant)
    entries = [x for x in catalog(variant)['files'] if references or not x['path'].startswith('Ref2VA/')]
    missing, present, partial = [], 0, 0
    for entry in entries:
        path = destination / entry['path']
        if path.is_file() and path.stat().st_size == entry['size']:
            present += entry['size']
        else:
            missing.append(entry['path'])
            pending = Path(str(path) + '.part')
            partial += min(pending.stat().st_size, entry['size']) if pending.is_file() else 0
    total = sum(x['size'] for x in entries)
    try:
        receipt = json.loads((destination / 'verified-model.json').read_text())
        verified = receipt['revision'] == catalog(variant)['revision'] and bool(receipt.get('verifiedAt'))
    except (OSError, KeyError, ValueError):
        verified = False
    return {'complete': not missing and verified, 'missingCount': len(missing), 'missing': missing[:8],
        'presentBytes': present, 'partialBytes': partial, 'downloadedBytes': present + partial,
        'progress': round(100 * (present + partial) / total, 2), 'totalBytes': total,
        'directory': str(destination), 'hashesVerified': verified, 'withReferences': references}


def validation(variant):
    try:
        value = json.loads(VALIDATION.read_text())
        row = value['variants'][variant]
        if row.get('status') != 'media-verified' or row.get('visualReview', {}).get('status') != 'accepted' or row.get('modelRevision') != catalog(variant)['revision'] or row.get('catalogSha256') != catalog_digest(variant):
            return None
        import filmma_runtime as r
        if row.get('engineRevision') != REVISION or row.get('adapterSha256') != r.sha256_file(ROOT / 'runtime/h3_gguf_cli.c') or row.get('binarySha256') != r.sha256_file(BINARY):
            return None
        return row
    except (OSError, KeyError, ValueError):
        return None


def status():
    try:
        review = json.loads(VALIDATION.read_text()).get('continuityReview')
    except (OSError, ValueError):
        review = None
    return {'continuityReview': review, 'active': active() or 'bf16', 'engineInstalled': BINARY.is_file(), 'engineRevision': REVISION,
        'repository': 'unsloth/MiniMax-H3-GGUF', 'memoryMode': 'quantized-ssd-streaming',
        'note': 'Los bloques se descomprimen a BF16 en la GPU. Reduce las lecturas; no mantiene todo el modelo residente en 36 GiB.',
        'variants': [{'id': variant, 'name': 'MiniMax H3 · ' + variant.upper(),
            'weights': files(variant, True), 'validation': validation(variant), 'trial': trial(variant)} for variant in ('gguf-q4', 'gguf-q8')]}


def trial_path(variant):
    catalog(variant)
    return VALIDATION.parent / 'trials' / ('last-' + variant + '.json')


def trial(variant):
    try:
        return json.loads(trial_path(variant).read_text())
    except (OSError, ValueError):
        return None


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def _check_trial(variant, row):
    import filmma_runtime as r
    if row.get('status') != 'media-verified' or row.get('request', {}).get('modelVariant') != variant:
        raise ValueError('La toma no confirma esta variante.')
    if row.get('modelRevision') != catalog(variant)['revision'] or row.get('catalogSha256') != catalog_digest(variant) or row.get('engineRevision') != REVISION:
        raise ValueError('Los pesos o el motor cambiaron después de la prueba.')
    if row.get('adapterSha256') != r.sha256_file(ROOT / 'runtime/h3_gguf_cli.c') or row.get('binarySha256') != r.sha256_file(BINARY):
        raise ValueError('El adaptador cambió después de la prueba.')
    if r.sha256_file(Path(row['request']['outputPath'])) != row.get('outputSha256'):
        raise ValueError('El video de prueba no coincide con su hash.')
    for reference in row['request']['references']:
        if r.sha256_file(Path(reference['path'])) != reference['sha256']:
            raise ValueError('La referencia de la prueba cambió; se conserva la toma para revisarla.')


def record_trial(variant, result):
    import filmma_runtime as r
    row = json.loads(Path(result).read_text())
    _check_trial(variant, row)
    row.update(trialId=str(uuid.uuid4()), visualReview={'status': 'pending'})
    with r.exclusive_lock('configuration', blocking=True):
        _write(trial_path(variant).parent / (row['trialId'] + '.json'), row)
        _write(trial_path(variant), row)
    return {'ok': True, 'variant': variant, 'trialId': row['trialId']}


def review_trial(variant, trial_id, accepted):
    import filmma_runtime as r
    with r.exclusive_lock('generation'), r.exclusive_lock('configuration', blocking=True):
        row = trial(variant)
        if not row or row.get('trialId') != trial_id:
            raise ValueError('La prueba cambió; vuelve a abrir el resultado antes de revisarlo.')
        _check_trial(variant, row)
        row['visualReview'] = {'status': 'accepted' if accepted else 'rejected', 'reviewedAt': time.time(),
            'notes': 'Revisión de calidad desde Filmma. Las alertas de continuidad por plano se conservan.'}
        _write(trial_path(variant).parent / (trial_id + '.json'), row)
        _write(trial_path(variant), row)
        if accepted:
            previous = json.loads(VALIDATION.read_text()) if VALIDATION.exists() else {'schema': 1, 'variants': {}}
            previous.setdefault('variants', {})[variant] = row
            _write(VALIDATION, previous)
    return {'ok': True, 'variant': variant, 'trialId': trial_id, 'accepted': accepted, 'activated': False}


def download_plan(variant):
    import filmma_runtime as r
    report = files(variant, True)
    parent = directory(variant)
    while not parent.exists():
        parent = parent.parent
    free = shutil.disk_usage(parent).free
    needed = report['totalBytes'] - report['downloadedBytes']
    destination = directory(variant)
    volume = Path(*destination.parts[:3]) if len(destination.parts) >= 3 and destination.parts[1] == 'Volumes' else None
    mounted = not volume or os.path.ismount(volume)
    return {**report, 'model': 'minimax-h3', 'variant': variant, 'downloadBytes': needed,
        'freeBytes': free, 'reserveBytes': r.MIN_DISK_HEADROOM, 'volumeMounted': bool(mounted),
        'fits': bool(mounted and free >= needed + r.MIN_DISK_HEADROOM), 'licenseUrl': catalog(variant)['licenseUrl']}


def install(emit):
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise ValueError('Este adaptador GGUF requiere macOS Apple Silicon; no es un motor CUDA para Windows.')
    ENGINE.parent.mkdir(parents=True, exist_ok=True)
    if not ENGINE.exists():
        subprocess.run(['git', 'clone', '--no-checkout', 'https://github.com/JunzoKamahara/H3cApp', str(ENGINE)], check=True, capture_output=True)
        subprocess.run(['git', 'checkout', '--detach', REVISION], cwd=str(ENGINE), check=True, capture_output=True)
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=str(ENGINE), text=True).strip() != REVISION:
        raise ValueError('El motor GGUF tiene una revisión distinta; se conserva sin modificar.')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--'], cwd=str(ENGINE)).returncode:
        raise ValueError('El motor GGUF tiene cambios locales; se conservan sin sobrescribir.')
    emit('progress', stage='compile', message='Compilando el adaptador GGUF para Apple Silicon.')
    subprocess.run(['make', '-j4', 'libh3.a', 'h3_gguf_tool'], cwd=str(ENGINE), check=True, capture_output=True)
    frameworks = ['Foundation', 'Metal', 'MetalPerformanceShaders', 'MetalPerformanceShadersGraph', 'Accelerate',
        'AVFoundation', 'CoreMedia', 'CoreVideo', 'CoreAudio', 'CoreGraphics', 'ImageIO']
    command = ['clang', '-std=c11', '-O3', '-D_DARWIN_C_SOURCE', '-mmacosx-version-min=15.0', '-I' + str(ENGINE),
        str(ROOT / 'runtime/h3_gguf_cli.c'), str(ENGINE / 'libh3.a'), '-o', str(BINARY)]
    for framework in frameworks:
        command += ['-framework', framework]
    subprocess.run(command + ['-licucore', '-lm'], check=True, capture_output=True)


def prepare(variant, destination, accepted, emit):
    import filmma_runtime as r
    if not accepted:
        raise ValueError('Revisa la licencia de MiniMax H3 antes de descargar.')
    destination = Path(destination).expanduser().resolve()
    if destination == r.model_dir('minimax-h3'):
        raise ValueError('Elige una carpeta separada del modelo BF16 original.')
    for part in ('FL2VA/transformer', 'FL2VA/text_encoder', 'Ref2VA/transformer'):
        if any((destination / part).glob('*.safetensors')):
            raise ValueError('La carpeta contiene pesos safetensors originales; no se mezclan con GGUF.')
    for other in ('gguf-q4', 'gguf-q8'):
        if other != variant and destination == directory(other):
            raise ValueError('Cada variante debe tener su propia carpeta; los componentes comunes se comparten al prepararla.')
    r.require_disk_reserve([destination])
    # The downloader owns its separate lock and never mutates BF16 configuration.
    with r.exclusive_lock('generation'):
        install(emit)
    if variant == 'gguf-q8':
        # Share unchanged, verified components on the same volume. Never link a
        # Q4 transformer into a Q8 installation and never replace an existing file.
        source = directory('gguf-q4')
        common = {e['path']: e for e in catalog('gguf-q4')['files']}
        for entry in catalog(variant)['files']:
            original = source / entry['path']
            target = destination / entry['path']
            if entry == common.get(entry['path']) and not target.exists() and file_matches(original, entry):
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.link(str(original), str(target))
                except OSError:
                    pass  # Different volumes download separately after capacity preflight.
    transfer(catalog(variant), destination, lambda line: _progress(line, emit))
    with r.exclusive_lock('configuration', blocking=True):
        value = r.config()
        options = value.setdefault('models', {}).setdefault('minimax-h3', {}).setdefault('quantized', {})
        options.setdefault('directories', {})[variant] = str(destination)
        temporary = r.CONFIG_PATH.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n')
        temporary.replace(r.CONFIG_PATH)
    return {'ok': True, 'variant': variant, 'directory': str(destination), 'activated': False}


def _progress(line, emit):
    data = json.loads(line)
    emit('progress', **data, message='Preparando MiniMax H3 cuantizado.', progress=round(100 * data['downloadedBytes'] / data['totalBytes'], 2))


def activate(variant):
    import filmma_runtime as r
    if variant not in ('bf16', 'gguf-q4', 'gguf-q8'):
        raise ValueError('Variante desconocida.')
    with r.exclusive_lock('generation'), r.exclusive_lock('configuration', blocking=True):
        if variant != 'bf16':
            evidence = validation(variant)
            if not r.hardware()['appleSilicon'] or not BINARY.is_file() or not files(variant, True)['complete'] or not evidence:
                raise ValueError('La variante necesita pesos verificados y una prueba de imagen revisada antes de activarse.')
            if evidence.get('engineRevision') != REVISION or evidence.get('adapterSha256') != r.sha256_file(ROOT / 'runtime/h3_gguf_cli.c') or evidence.get('binarySha256') != r.sha256_file(BINARY):
                raise ValueError('El motor cambió después de la prueba; se requiere otra validación.')
            for entry in catalog(variant)['files']:
                if not file_matches(directory(variant) / entry['path'], entry):
                    raise ValueError('Un archivo cuantizado no coincide con su hash; se conserva sin activarlo: ' + entry['path'])
            path = Path(evidence['request']['outputPath'])
            if not path.is_file() or r.sha256_file(path) != evidence.get('outputSha256'):
                raise ValueError('La toma de validación ya no coincide con su hash.')
        value = r.config()
        value.setdefault('models', {}).setdefault('minimax-h3', {})['variant'] = variant
        temporary = r.CONFIG_PATH.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n')
        temporary.replace(r.CONFIG_PATH)
    return {'ok': True, 'variant': variant, 'originalsPreserved': True}
