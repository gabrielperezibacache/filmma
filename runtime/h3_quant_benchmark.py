#!/usr/bin/env python3
"""One isolated, supervised H3 GGUF trial. Never changes a Filmma project."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
import errno

import filmma_runtime as runtime

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / 'runtime/vendor/h3-gguf-candidate'


def sha(path):
    return runtime.sha256_file(Path(path))


def idle(job_marker=None, api_port=None):
    reachable = 0
    for port in sorted(set([4318, 4320] + ([api_port] if api_port else []))):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/api/jobs' % port, timeout=5) as response:
                body = json.load(response)
        except urllib.error.URLError as error:
            if isinstance(error.reason, OSError) and error.reason.errno == errno.ECONNREFUSED:
                continue
            raise RuntimeError('Cannot verify the Filmma queue on port %d' % port) from error
        reachable += 1
        jobs = body.get('jobs', []) if isinstance(body, dict) else body
        if any(j.get('status') in ('running', 'queued') and not (job_marker and (j.get('result') or {}).get('quantizedTestId') == job_marker) for j in jobs):
            raise RuntimeError('Filmma has other queued or active work on port %d; benchmark not started' % port)
    if not reachable:
        raise RuntimeError('Open Filmma before starting a model validation')


def save(path, body):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(body, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def run(args):
    destination = Path(args.output).resolve()
    if destination.exists():
        raise RuntimeError('Benchmark directory exists; choose a new destination')
    idle(args.job_marker, args.api_port)
    destination.mkdir(parents=True)
    reference = Path(args.reference).resolve()
    request = {'model': 'minimax-h3', 'modelVariant': args.variant, 'prompt': args.prompt,
        'width': args.width, 'height': args.height, 'numFrames': args.frames,
        'steps': args.steps, 'fps': 24, 'seed': args.seed, 'memoryProfile': 'conservative',
        'modelDirectory': str(Path(args.model).resolve()), 'outputPath': str(destination / 'original.mp4'),
        'references': [{'type': 'image', 'path': str(reference), 'characterId': args.character_id, 'sha256': sha(reference)}],
        'projectId': args.project_id, 'sceneId': 'quantized-validation',
        'characterIds': [args.character_id], 'script': 'Prueba técnica aislada; el guion del proyecto se conserva.',
        'comparisonControls': {'ditLayers': 50, 'denoiseReuse': 1, 'coreReuse': 1,
            'sampler': 'Euler', 'lora': None, 'textEncoder': 'H3 Qwen3VL Q4_K_M', 'videoVae': 'FP16',
            'resident': False, 'turbo': False, 'nativeFps': 24},
        'originalsPreserved': True}
    runtime.normalize_request(request)
    request['modelDirectory'] = str(Path(args.model).resolve())
    request['engineModelDirectory'] = runtime.prepare_h3_view(request['modelDirectory'])
    save(destination / 'request.json', request)
    evidence = {'status': 'preflight', 'request': request,
        'engineRevision': '754858b4f28acd537d16a6ad97c5ee0f0635e950',
        'modelRevision': runtime.h3_quantized.catalog(args.variant)['revision'],
        'catalogSha256': runtime.h3_quantized.catalog_digest(args.variant),
        'adapterSha256': sha(ROOT / 'runtime/h3_gguf_cli.c'),
        'binarySha256': sha(ENGINE / 'filmma-h3-gguf'),
        'limitations': ['A short pilot does not validate long takes or other resolutions.',
            'Process footprint, RSS, Metal buffers and swap overlap; never add them as unified memory.',
            'Sampled process disk counters can miss final reads and cached/mmap I/O; engine stream bytes are logical reads.',
            'Q4 and Q8 share a Q4 text encoder and FP16 VAE; this comparison isolates the DiT quantization.',
            'The original BF16 model is unavailable while the external SSD is disconnected.']}
    child = None
    monitor = None
    began = time.monotonic()
    def cancel(signum, _frame):
        raise runtime.RuntimeFailure('CANCELLED', 'Prueba cancelada; se conservan los originales.')
    with runtime.exclusive_lock('generation'):
        previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            idle(args.job_marker, args.api_port)
            baseline = runtime.generation_memory_preflight({**request, 'memoryProfile': 'h3-long-ssd'}, runtime.hardware())
            evidence['baselineMemory'] = baseline
            env = {**os.environ, 'H3_PROFILE': '1', 'H3_NAX': '0', 'PYTHONUNBUFFERED': '1'}
            command = [str(ENGINE / 'filmma-h3-gguf'), '-d', request['engineModelDirectory'], '-p', args.prompt,
                '-o', request['outputPath'], '--width', str(args.width), '--height', str(args.height),
                '--frames', str(args.frames), '--steps', str(args.steps), '--seed', str(args.seed),
                '--ref-image', str(reference), '--ssd-streaming', '--raw-frames', str(destination / 'frames.rgb24')]
            with (destination / 'generation.log').open('w') as log:
                child = subprocess.Popen(command, cwd=str(ENGINE), env=env, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, start_new_session=True, text=True, bufsize=1)
                evidence.update(status='running', pid=child.pid, startedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
                save(destination / 'result.json', evidence)
                monitor = runtime.LongGenerationMonitor(child, {**request, 'memoryProfile': 'h3-long-ssd'}, baseline)
                monitor.start()
                for line in child.stdout:
                    log.write(line)
                    log.flush()
                    runtime.report_engine_line(line.strip())
                rc = child.wait()
                child.stdout.close()
                evidence['memory'] = monitor.close()
            if monitor.failure:
                raise monitor.failure
            if rc:
                raise RuntimeError('GGUF engine failed (%d); see generation.log' % rc)
            evidence['generationSeconds'] = round(time.monotonic() - began, 3)
            media = runtime.validate_media(Path(request['outputPath']))
            if (media['width'], media['height'], media['frames']) != (args.width, args.height, args.frames):
                raise RuntimeError('Decoded media does not match the requested canvas or frames')
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', request['outputPath']]))
            video = next(x for x in probe['streams'] if x['codec_type'] == 'video')
            if video['avg_frame_rate'] != '24/1' or abs(float(video['duration']) - args.frames / 24) > 0.002:
                raise RuntimeError('Unexpected native video clock or duration')
            subprocess.run(['ffmpeg', '-v', 'error', '-i', request['outputPath'], '-f', 'null', '-'], check=True, capture_output=True)
            raw = destination / 'frames.rgb24'
            if raw.stat().st_size != args.width * args.height * args.frames * 3:
                raise RuntimeError('Lossless decoded frame count mismatch')
            indices = sorted(set([0, args.frames // 4, args.frames // 2, args.frames * 3 // 4, args.frames - 1]))
            (destination / 'frames').mkdir()
            selection = '+'.join('eq(n,%d)' % i for i in indices).replace(',', '\\,')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size',
                '%dx%d' % (args.width, args.height), '-framerate', '24', '-i', str(raw), '-vf', 'select=' + selection,
                '-fps_mode', 'vfr', str(destination / 'frames/frame-%02d.png')], check=True, capture_output=True)
            if sha(reference) != request['references'][0]['sha256']:
                raise RuntimeError('Reference changed during the benchmark')
            log = (destination / 'generation.log').read_text(errors='replace')
            stream = re.findall(r'h3: (?:BF16 )?SSD stream ([\d.]+) GiB read in ([\d.]+)s', log)
            evidence.update(status='media-verified', media=media, videoStream=video,
                outputSha256=sha(request['outputPath']), referenceUnchanged=True,
                streamReads=[{'logicalGiB': float(a), 'readSeconds': float(b)} for a, b in stream],
                visualReview='pending', representativeFrameIndices=indices)
            save(destination / 'original.filmma.json', {'request': request, 'metadata': evidence})
        except BaseException as error:
            evidence.update(status='failed', error=str(error), errorCode=getattr(error, 'code', 'BENCHMARK_FAILED'))
            if child and child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                except ProcessLookupError:
                    pass
            if monitor:
                evidence['memory'] = monitor.close()
            raise
        finally:
            evidence['elapsedSeconds'] = round(time.monotonic() - began, 3)
            save(destination / 'result.json', evidence)
            for sig, handler in previous.items():
                signal.signal(sig, handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--variant', choices=['gguf-q4', 'gguf-q8'], required=True)
    parser.add_argument('--reference', default=str(ROOT / 'output/google-live/store/media/elena-reference.png'))
    parser.add_argument('--width', type=int, default=512)
    parser.add_argument('--height', type=int, default=320)
    parser.add_argument('--frames', type=int, default=22)
    parser.add_argument('--steps', type=int, default=20)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--project-id', default='qa-h3-quantized')
    parser.add_argument('--character-id', default='elena')
    parser.add_argument('--job-marker')
    parser.add_argument('--api-port', type=int)
    parser.add_argument('--prompt', default='A cinematic medium close-up of the woman in the reference image, Elena, sitting in the same vintage movie theater. Keep her identical face, curly dark brown shoulder-length hair, camel tan trench coat with the same buttons and collar. She slowly turns her head toward the camera and gives a subtle smile. Warm tungsten practical lights, red velvet seats, blue projector beam in the background. Static camera, natural human movement, consistent identity, no cuts, no text.')
    run(parser.parse_args())
