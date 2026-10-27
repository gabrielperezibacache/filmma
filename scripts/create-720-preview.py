"""Fit an existing native take to a new 720p file without cropping or retiming.

Usage: python3 scripts/create-720-preview.py SOURCE DESTINATION
Preserves the original and audio packets; validates full decode and frame clock.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def run(*args):
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace')[-3000:])
    return result


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path):
    metadata = json.loads(run('ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(path)).stdout)
    video = next(stream for stream in metadata['streams'] if stream['codec_type'] == 'video')
    audio = next(stream for stream in metadata['streams'] if stream['codec_type'] == 'audio')
    return metadata, video, audio


def audio_sha(path):
    return hashlib.sha256(run('ffmpeg', '-v', 'error', '-nostdin', '-i', str(path), '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', '-').stdout).hexdigest()


def main():
    source, destination = [Path(argument).resolve() for argument in sys.argv[1:3]]
    assert source != destination and not destination.exists(), 'Refusing to overwrite an original or existing delivery.'
    metadata, original, audio = probe(source)
    assert audio['codec_name'] == 'aac', 'This native H3 preview expects its existing AAC audio.'
    assert 0 < float(original['duration']) <= 15
    source_sha = sha(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = run('ffmpeg', '-v', 'error', '-nostdin', '-n', '-threads', '2', '-i', str(source),
        '-map', '0:v:0', '-map', '0:a:0', '-filter_threads', '1',
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
        '-fps_mode', 'passthrough', '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '16',
        '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(destination))
    assert not result.stderr.strip()
    delivered, video, delivered_audio = probe(destination)
    assert (video['width'], video['height']) == (1280, 720)
    assert video['avg_frame_rate'] == original['avg_frame_rate'] and video['nb_read_frames'] == original['nb_read_frames']
    assert abs(float(video['duration']) - float(original['duration'])) < .00001
    assert delivered_audio['channels'] == audio['channels']
    assert audio_sha(source) == audio_sha(destination), 'Delivery altered the source audio packets.'
    decoded = run('ffmpeg', '-v', 'error', '-nostdin', '-threads', '2', '-i', str(destination), '-f', 'null', '-')
    assert not decoded.stderr.strip() and sha(source) == source_sha
    report = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'source': str(source), 'sourceSha256': source_sha,
        'destination': str(destination), 'sha256': sha(destination), 'originalPreserved': True, 'audioPacketsPreserved': True,
        'sourceProbe': metadata, 'deliveryProbe': delivered, 'fullDecodePassed': True,
        'framing': 'Entire source fitted inside 1280x720 with even dimensions and padding; no crop, stretching, frame repetition or timing change. Review the image visually too.'}
    destination.with_suffix('.verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'verified': True, 'source': str(source), 'destination': str(destination), 'frames': video['nb_read_frames'], 'fps': video['avg_frame_rate'], 'duration': video['duration']}))


if __name__ == '__main__':
    main()
