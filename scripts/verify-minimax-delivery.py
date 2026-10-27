"""Read-only verification of the long MiniMax original, AI derivative and UHD export.

Writes evidence and sampled PNGs only; never generates, modifies or deletes media.
Usage: python3 scripts/verify-minimax-delivery.py SOURCE AI UHD EVIDENCE_DIRECTORY [EXPECTED_JSON]
EXPECTED_JSON supplies sourceSha256, sourceSize, aiSize, frames, fps and optional
preserve (absolute path -> SHA256). Defaults retain the first 512px acceptance test.
"""
import array
import hashlib
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def run(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace')[-3000:])
    return result


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inspect(path, width, height, folder, label, frame_count=345, fps=24):
    before = sha(path)
    metadata = json.loads(run('ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(path)).stdout)
    video = next(item for item in metadata['streams'] if item['codec_type'] == 'video')
    audio = next(item for item in metadata['streams'] if item['codec_type'] == 'audio')
    num, den = map(int, video['avg_frame_rate'].split('/'))
    assert (video['width'], video['height']) == (width, height), (label, video)
    duration = frame_count / fps
    assert int(video['nb_read_frames']) == frame_count and num / den == fps
    assert abs(float(video['duration']) - duration) < .00001
    assert audio['channels'] == 2 and abs(float(audio['duration']) - duration) < .03
    decoded = run('ffmpeg', '-v', 'error', '-nostdin', '-threads', '2', '-i', str(path), '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-')
    assert not decoded.stderr.strip(), decoded.stderr.decode(errors='replace')
    frames = folder / (label + '-frames')
    frames.mkdir(exist_ok=True)
    for index in sorted({round((frame_count - 1) * fraction / 4) for fraction in range(5)}):
        target = frames / ('frame-%03d.png' % index)
        run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-threads', '2', '-i', str(path), '-vf', 'select=eq(n\\,%d)' % index, '-frames:v', '1', '-update', '1', '-threads', '1', str(target))
    assert sha(path) == before
    (folder / (label + '-probe.json')).write_text(json.dumps(metadata, indent=2) + '\n')
    return {'path': str(path), 'sha256': before, 'width': width, 'height': height, 'frames': frame_count, 'fps': fps, 'videoDurationSeconds': float(video['duration']), 'audioDurationSeconds': float(audio['duration']), 'audioSampleRate': int(audio['sample_rate']), 'audioChannels': audio['channels'], 'decodeExitCode': decoded.returncode, 'decodeErrorOutput': '', 'bytes': path.stat().st_size}


def audio_packets(path):
    return hashlib.sha256(run('ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', '-').stdout).hexdigest()


def pcm(path):
    raw = run('ffmpeg', '-v', 'error', '-threads', '2', '-i', str(path), '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-f', 's16le', '-').stdout
    samples = array.array('h')
    samples.frombytes(raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples


def main():
    source, ai, uhd, folder = map(lambda value: Path(value).resolve(), sys.argv[1:5])
    folder.mkdir(parents=True, exist_ok=True)
    configuration = json.loads(Path(sys.argv[5]).read_text()) if len(sys.argv) > 5 else {
        'sourceSha256': 'f9ab463b327527cad9d7e8b5c30ff98481e2243a5709568522ac42d91c5d7016',
        'sourceSize': [512, 320], 'aiSize': [3642, 2276], 'frames': 345, 'fps': 24,
    }
    expected = configuration['sourceSha256']
    frames, fps = configuration['frames'], configuration['fps']
    assert isinstance(frames, int) and frames > 0 and fps > 0 and frames / fps <= 15
    preserved = configuration.get('preserve', {})
    assert all(sha(path) == digest for path, digest in preserved.items()), 'A preserved source changed before verification.'
    assert sha(source) == expected, 'The original changed before verification.'
    results = {'original': inspect(source, *configuration['sourceSize'], folder, 'original', frames, fps), 'ai': inspect(ai, *configuration['aiSize'], folder, 'ai', frames, fps), 'uhd': inspect(uhd, 3840, 2160, folder, 'uhd', frames, fps)}
    original_audio, ai_audio = audio_packets(source), audio_packets(ai)
    assert original_audio == ai_audio, 'AI processing changed the original audio packets.'
    a, b = pcm(source), pcm(uhd)
    count = min(len(a), len(b), round(frames / fps * 48000 * 2))
    energy_a = sum(value * value for value in a[:count])
    energy_b = sum(value * value for value in b[:count])
    correlation = sum(x * y for x, y in zip(a[:count], b[:count])) / math.sqrt(energy_a * energy_b) if energy_a and energy_b else None
    assert correlation is not None and correlation > .98, 'Exported audio does not match the source timing/content closely enough.'
    assert sha(source) == expected
    assert all(sha(path) == digest for path, digest in preserved.items()), 'A preserved source changed during verification.'
    report = {'verifiedAtUtc': datetime.now(timezone.utc).isoformat(), 'media': results, 'originalPreserved': True, 'preservedSources': preserved, 'aiAudioPacketsIdentical': True, 'aiAudioPacketSha256': original_audio, 'exportAudio': {'interleavedSamplesCompared': count, 'channels': 2, 'sampleRate': 48000, 'correlationWithoutTimeShift': correlation, 'originalRms': math.sqrt(energy_a / count), 'exportRms': math.sqrt(energy_b / count), 'note': 'The MP4 export resamples/re-encodes audio; stereo correlation checks content, channel ordering and timing, not bit identity.'}, 'framing': 'The source is fitted inside the 16:9 UHD canvas. Inspect sampled frames to confirm geometry and padding; dimensions alone do not prove absence of cropping.', 'visualReviewRequired': ['original-frames', 'ai-frames', 'uhd-frames'], 'native4K': False}
    (folder / 'media-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
