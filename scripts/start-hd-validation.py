"""Start at most one real long HD take after the isolated 720p pilot passes.

No downloads, retries, production edits, upscaling or exports. An ambiguous HTTP
response must be reconciled against jobs; launch.json prevents blind repetition.
"""
from pathlib import Path
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
PILOT = ROOT / 'output/qa/native-resolution/pilot-720'
DESTINATION = ROOT / 'output/qa/native-resolution/long-720'
QA = 'http://127.0.0.1:4317'


def read_json(path):
    return json.loads(Path(path).read_text())


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def get(url):
    return json.load(urllib.request.urlopen(url, timeout=20))


def main():
    pilot = read_json(PILOT / 'process.json')
    assert pilot['status'] == 'media-verified' and pilot['originalsPreserved'], 'Pilot is not verified; do not launch.'
    assert pilot['video']['width'] == 1280 and pilot['video']['height'] == 736
    assert pilot['video']['frames'] == 22 and pilot['video']['fps'] == 24
    assert sha(pilot['request']['outputPath']) == pilot['sha256'], 'Pilot source changed.'
    events = [json.loads(line) for line in (PILOT / 'generation.jsonl').read_text().splitlines()]
    result = next(event for event in reversed(events) if event.get('type') == 'result')
    watchdog = result['metadata']['engineMetrics']['memoryWatchdog']
    assert watchdog['maxPressureLevel'] == 1 and watchdog['maxSwapGrowthBytes'] == 0, 'Pilot memory needs review before extending duration.'
    preserved = read_json(PILOT / 'preservation-before.json')
    preserved[pilot['request']['outputPath']] = pilot['sha256']
    assert all(sha(path) == expected for path, expected in preserved.items()), 'A protected original or production project changed.'
    for port in (4317, 4318):
        assert not any(job['status'] in ('running', 'queued') for job in get(f'http://127.0.0.1:{port}/api/jobs')['jobs']), 'Another operation is active.'
    with (ROOT / 'runtime/.generation.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_UN)
    bootstrap = get(QA + '/api/bootstrap')
    project = bootstrap['project']
    fingerprint = bootstrap.get('projectFingerprint')
    assert isinstance(fingerprint, str) and len(fingerprint) == 64, 'The QA server needs the guarded-generation API before launch.'
    assert project['id'] == 'qa-minimax-scene' and project['format'] == '16:9' and project['fps'] == 24
    assert not project.get('aiFinishing', {}).get('enabled'), 'Verify the native source before AI finishing.'
    scene = next(scene for scene in project['scenes'] if scene['id'] == 'camera-scene')
    assert not scene.get('assetId') and not scene.get('endAssetId')
    assert abs(scene['duration'] - 345 / 24) < .00001
    assert not any(character.get('assetId') for character in project['characters'] if character['id'] in scene['characterIds'])
    request = {
        'sceneId': scene['id'], 'model': 'minimax-h3', 'memoryProfile': 'h3-hd-ssd',
        'conditioningMode': 'text', 'duration': 15, 'width': 1280, 'height': 736,
        'steps': 20, 'seed': 20261018,
        'expectedProjectId': project['id'], 'expectedProjectFingerprint': fingerprint,
        'clientRequestId': str(uuid.uuid4()),
        'prompt': scene['prompt'] + '\nOnly the camera object and setting are visible. No people, faces or hands. '
                  'Keep the entire camera and both reels within the frame, with space above the top reel. '
                  'The camera has blank, unmarked surfaces without any lettering or inscription. '
                  'The camera body and reels remain motionless. Keep the entire camera in focus; visible material texture and precise optical detail.',
    }
    DESTINATION.mkdir(parents=True, exist_ok=True)
    launch_path = DESTINATION / 'launch.json'
    state = {'status': 'submitting', 'startedAt': datetime.now(timezone.utc).isoformat(),
             'supervisorPid': os.getpid(), 'maximumAdditionalRetries': 0, 'api': QA,
             'request': request, 'expected': {'width': 1280, 'height': 736, 'frames': 345, 'fps': 24, 'duration': 14.375},
             'runtimeSha256': sha(ROOT / 'runtime/filmma_runtime.py'), 'pilotSha256': pilot['sha256']}
    # Exclusive creation is the one-shot guard, written before any mutation.
    with launch_path.open('x') as stream:
        stream.write(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    (DESTINATION / 'preservation-before.json').write_text(json.dumps(preserved, indent=2) + '\n')
    (DESTINATION / 'qa-project-before.json').write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n')
    (DESTINATION / 'runtime-source-at-launch.py').write_bytes((ROOT / 'runtime/filmma_runtime.py').read_bytes())
    work_root = ROOT / 'output/qa/minimax-scene/store/work'
    before = set(work_root.iterdir())

    def save():
        temporary = launch_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(launch_path)

    try:
        http_request = urllib.request.Request(QA + '/api/generate', data=json.dumps(request).encode(),
            headers={'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma'}, method='POST')
        with urllib.request.urlopen(http_request, timeout=60) as response:
            assert response.status == 202
            job = json.load(response)['job']
        state.update(status='submitted', jobId=job['id'], job=job)
        save()
        for _ in range(30):
            candidates = []
            for directory in set(work_root.iterdir()) - before:
                try:
                    actual = read_json(directory / 'request.json')
                    if actual.get('clientRequestId') == request['clientRequestId']:
                        assert actual.get('memoryProfile') == 'h3-hd-ssd' and actual.get('width') == 1280 and actual.get('height') == 736 and actual.get('numFrames') == 345, 'Correlated job request differs from the HD specification.'
                        candidates.append((directory, actual))
                except (OSError, ValueError):
                    pass
            if len(candidates) == 1:
                directory, actual = candidates[0]
                state.update(workDirectory=str(directory), outputPath=actual['outputPath'])
                break
            time.sleep(1)
        save()
        print(json.dumps(state, ensure_ascii=False))
    except BaseException as error:
        state.update(status='submission-uncertain', error=str(error), action='Inspect API jobs and work folders; never resubmit automatically.')
        save()
        raise


if __name__ == '__main__':
    main()
