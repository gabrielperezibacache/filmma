"""Run one supervised native-resolution request, preserving evidence and sources.

Usage: python3 scripts/validate-native-resolution.py EVIDENCE_DIRECTORY
The directory must contain request.json and preservation-before.json.
No retries, downloads, restoration, or project edits are performed.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
directory = Path(sys.argv[1]).resolve()
state_path = directory / 'process.json'
if state_path.exists():
    raise SystemExit('Existing attempt evidence; refusing a duplicate.')
request = json.loads((directory / 'request.json').read_text())
output = Path(request['outputPath'])
started = time.monotonic()
child = None

def stamp():
    return datetime.now(timezone.utc).isoformat()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

state = {'status': 'preflight', 'supervisorPid': os.getpid(), 'startedAt': stamp(),
         'request': request, 'maximumAdditionalRetries': 0,
         'runtimeSha256': sha(ROOT / 'runtime/filmma_runtime.py')}

def save():
    temporary = state_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(state_path)

def cancel(signum, _frame):
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
    raise RuntimeError('Validation cancelled; no retry.')

save()
try:
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, cancel)
    for port in (4317, 4318):
        jobs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/jobs', timeout=15))
        (directory / f'jobs-before-{port}.json').write_text(json.dumps(jobs, indent=2))
        assert not any(j['status'] in ('running', 'queued') for j in jobs['jobs']), 'Another Filmma operation is active.'
    assert not output.exists(), 'Output exists; refusing to overwrite.'
    before = json.loads((directory / 'preservation-before.json').read_text())
    assert all(sha(path) == digest for path, digest in before.items()), 'Source changed before launch.'
    command = [sys.executable, str(ROOT / 'runtime/filmma_runtime.py'), 'generate', '--request', str(directory / 'request.json')]
    with (directory / 'generation.jsonl').open('x') as log, (directory / 'stderr.txt').open('x') as errors:
        child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=errors, start_new_session=True,
                                 env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        state.update(status='running', workerPid=child.pid, command=command)
        save()
        code = child.wait(timeout=6 * 60 * 60)
    state.update(exitCode=code, elapsedSeconds=round(time.monotonic() - started, 3))
    assert code == 0, f'Worker failed ({code}); preserve generation.jsonl and stderr.txt.'
    probe = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(output)], capture_output=True, text=True, check=True)
    (directory / 'ffprobe.json').write_text(probe.stdout)
    metadata = json.loads(probe.stdout)
    video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
    rate_n, rate_d = map(int, video['avg_frame_rate'].split('/'))
    assert (video['width'], video['height'], int(video['nb_read_frames'])) == (request['width'], request['height'], request['numFrames'])
    assert rate_n / rate_d == request['fps'] and abs(float(video['duration']) - request['numFrames'] / request['fps']) < .002
    decoded = subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-threads', '2', '-i', str(output), '-f', 'null', '-'], capture_output=True, text=True)
    (directory / 'decode.txt').write_text(decoded.stdout + decoded.stderr)
    assert decoded.returncode == 0 and not decoded.stderr.strip(), 'Full decoding failed.'
    frames = directory / 'frames'
    frames.mkdir(exist_ok=True)
    for index in sorted(set((0, request['numFrames'] // 2, request['numFrames'] - 1))):
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-threads', '2', '-i', str(output), '-vf', f'select=eq(n\\,{index})', '-frames:v', '1', '-update', '1', '-threads', '1', str(frames / f'frame-{index:03}.png')], check=True)
    after = {path: sha(path) for path in before}
    (directory / 'preservation-after.json').write_text(json.dumps(after, indent=2))
    assert before == after, 'Source or production project changed.'
    state.update(status='media-verified', completedAt=stamp(), sha256=sha(output), originalsPreserved=True,
                 elapsedSeconds=round(time.monotonic() - started, 3),
                 video={'width': video['width'], 'height': video['height'], 'frames': int(video['nb_read_frames']), 'fps': rate_n / rate_d, 'duration': float(video['duration'])},
                 verificationLimit='Full structural decoding; native detail and prompt compliance need visual review. A short pilot does not validate a longer take.')
    save()
except BaseException as error:
    state.update(status='failed', completedAt=stamp(), error=str(error), elapsedSeconds=round(time.monotonic() - started, 3))
    save()
    raise
finally:
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
