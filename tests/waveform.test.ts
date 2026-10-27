import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWaveformService } from '../server/waveform.js';
import type { Asset } from '../server/types.js';
import { runProcess } from '../server/process.js';

async function ffmpeg(args: string[]) {
  const result = await runProcess('ffmpeg', ['-y', '-v', 'error', ...args]);
  assert.equal(result.code, 0, result.stderr);
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-waveform-')), dataDirectory = join(directory, 'data'), publicDirectory = join(directory, 'public');
  await mkdir(join(dataDirectory, 'media'), { recursive: true }); await mkdir(join(publicDirectory, 'demo'), { recursive: true });
  const assets: Asset[] = [], options = { dataDirectory, publicDirectory, getProject: () => ({ assets }) };
  const service = createWaveformService(options);
  function add(id: string, type: Asset['type'] = 'audio', extension = 'wav') {
    const asset: Asset = { id, type, name: id, url: `/api/media/${id}.${extension}`, mime: `${type}/${extension}`, size: 0 }; assets.push(asset); return join(dataDirectory, 'media', `${id}.${extension}`);
  }
  return { directory, dataDirectory, publicDirectory, assets, options, service, add, cleanup: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
const middlePeaks = (peaks: number[]) => peaks.slice(Math.floor(peaks.length * .1), Math.floor(peaks.length * .9));
const peakMean = (peaks: number[]) => peaks.reduce((sum, peak) => sum + peak, 0) / peaks.length;

test('real tone peaks keep full-scale amplitude and silent audio is distinguished from absent audio', async () => {
  const f = await fixture();
  try {
    const tone = f.add('tone'), silence = f.add('silence');
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', tone]);
    await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:a', 'pcm_s16le', silence]);
    const bytesBefore = createHash('sha256').update(await readFile(tone)).digest('hex');
    const wave = await f.service.get('tone');
    assert.equal(wave.hasAudio, true); assert.equal(wave.cached, false); assert.equal(wave.channels, 1); assert.equal(wave.sampleRate, 48000); assert.equal(wave.peaks.length, 2048); assert(Math.abs(wave.duration - 1) < .001);
    const average = peakMean(middlePeaks(wave.peaks)); assert(average > .123 && average < .126, `Original amplitude, not rescaled to 1: ${average}`);
    assert(wave.peaks.every((peak) => peak >= 0 && peak <= 1));
    const empty = await f.service.get('silence'); assert.equal(empty.hasAudio, true); assert.equal(empty.channels, 2); assert.equal(empty.peaks.length, 2048); assert(empty.peaks.every((peak) => peak === 0));
    assert.equal(createHash('sha256').update(await readFile(tone)).digest('hex'), bytesBefore);
  } finally { await f.cleanup(); }
});

test('all channels are measured so opposite stereo channels and high frequencies do not disappear', async () => {
  const f = await fixture();
  try {
    const path = f.add('stereo');
    await ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*12000*t)|-0.5*sin(2*PI*12000*t):s=48000:d=0.5', '-c:a', 'pcm_f32le', path]);
    const wave = await f.service.get('stereo'); assert.equal(wave.channels, 2);
    assert(peakMean(middlePeaks(wave.peaks)) > .49, 'Neither downmix cancellation nor resampling removes real sound');
  } finally { await f.cleanup(); }
});

test('video without an audio stream returns an honest empty result, and delayed video audio uses source time', async () => {
  const f = await fixture();
  try {
    const silentVideo = f.add('no-audio', 'video', 'mp4'), delayed = f.add('delayed', 'video', 'mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=64x64:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentVideo]);
    const wave = await f.service.get('no-audio'); assert.equal(wave.hasAudio, false); assert.equal(wave.channels, 0); assert.equal(wave.sampleRate, 0); assert.deepEqual(wave.peaks, []); assert(Math.abs(wave.duration - 1) < .001);
    await ffmpeg(['-f', 'lavfi', '-i', 'color=black:s=64x64:r=24:d=2', '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', delayed]);
    const timed = await f.service.get('delayed'); assert.equal(timed.hasAudio, true); assert(Math.abs(timed.duration - 2) < .01);
    const average = (start: number, end: number) => peakMean(timed.peaks.slice(Math.floor(start / timed.duration * timed.peaks.length), Math.floor(end / timed.duration * timed.peaks.length)));
    assert(average(.05, .35) < .001, 'Leading delay is empty'); assert(average(.6, .85) > .1, 'Tone occurs at its media timestamp'); assert(average(1.2, 1.8) < .001, 'The rest of the video is silent');
  } finally { await f.cleanup(); }
});

test('cache survives service restarts, detects changes at the same path and recovers from damaged cache data', async () => {
  const f = await fixture();
  try {
    const path = f.add('source'); await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', path]);
    const first = await f.service.get('source'), cached = await f.service.get('source'); assert.equal(cached.cached, true); assert.deepEqual(cached.peaks, first.peaks);
    const noTools = createWaveformService({ ...f.options, ffmpeg: '/not-installed/ffmpeg', ffprobe: '/not-installed/ffprobe' });
    try { const restarted = await noTools.get('source'); assert.equal(restarted.cached, true); assert.equal(restarted.sourceVersion, first.sourceVersion); } finally { await noTools.close(); }
    // A new, silent file at the same URL must invalidate the old nonzero peaks.
    await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.3', path]);
    const changed = await f.service.get('source'); assert.equal(changed.cached, false); assert.notEqual(changed.sourceVersion, first.sourceVersion); assert(changed.peaks.every((peak) => peak === 0));
    const directory = join(f.dataDirectory, 'waveforms'), files = await readdir(directory); assert.equal(files.filter((name) => name.endsWith('.json')).length, 1);
    await writeFile(join(directory, files[0]!), '{"peaks":[1,1,1],"broken":true}');
    const repaired = await f.service.get('source'); assert.equal(repaired.cached, false); assert(repaired.peaks.every((peak) => peak === 0));
    assert.equal((await readdir(directory)).filter((name) => name.endsWith('.tmp')).length, 0);
  } finally { await f.cleanup(); }
});

test('missing files, unknown assets, images, external paths and symbolic links are rejected without invented waveforms', async () => {
  const f = await fixture();
  try {
    f.add('missing'); f.add('picture', 'image', 'png');
    await assert.rejects(() => f.service.get('missing'), (error: any) => error.status === 404);
    await assert.rejects(() => f.service.get('unknown'), (error: any) => error.status === 404);
    await assert.rejects(() => f.service.get('picture'), (error: any) => error.status === 415);
    f.assets.push({ ...f.assets[0]!, id: 'remote', url: 'https://example.com/file.wav' });
    await assert.rejects(() => f.service.get('remote'), /ruta local/);
    f.assets.push({ ...f.assets[0]!, id: 'traversal', url: '/api/media/../private.wav' });
    await assert.rejects(() => f.service.get('traversal'), /ruta local/);
    const target = join(f.directory, 'outside.wav'); await writeFile(target, 'outside'); const linked = f.add('link'); await symlink(target, linked);
    await assert.rejects(() => f.service.get('link'), /enlaces/);
    const corrupt = f.add('corrupt'); await writeFile(corrupt, 'this is not audio'); await assert.rejects(() => f.service.get('corrupt'), /leer el archivo/);
    assert.equal((await readdir(f.dataDirectory)).includes('waveforms'), false);
  } finally { await f.cleanup(); }
});

test('coalesced requests share extraction; cancelling the last reader stops work and closing rejects new reads', async () => {
  const f = await fixture();
  try {
    const path = f.add('source'); await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path]);
    const counter = join(f.directory, 'invocations.txt'), wrapper = join(f.directory, 'counted-ffmpeg');
    await writeFile(wrapper, `#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');fs.appendFileSync(${JSON.stringify(counter)},'decode\\n');const child=cp.spawn('ffmpeg',process.argv.slice(2),{stdio:'inherit'});child.on('close',code=>process.exit(code??1));\n`); await chmod(wrapper, 0o755);
    const counted = createWaveformService({ ...f.options, ffmpeg: wrapper });
    const values = await Promise.all(Array.from({ length: 5 }, () => counted.get('source'))); await counted.close();
    assert(values.every((value) => value.sourceVersion === values[0]!.sourceVersion)); assert.deepEqual(values[0]!.peaks, values[4]!.peaks);
    assert.equal(await readFile(counter, 'utf8'), 'decode\n', 'Concurrent requests start one real decoder');
    const controller = new AbortController(); controller.abort(); await assert.rejects(() => f.service.get('source', { signal: controller.signal }), (error: any) => error.status === 499);
    // CPU-only extraction fixture that waits, making cancellation observable.
    const slow = join(f.directory, 'slow-ffmpeg'); await writeFile(slow, '#!/usr/bin/env node\nsetTimeout(()=>process.exit(0),30000);\n'); await chmod(slow, 0o755);
    const uncached = f.add('uncached'); await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', uncached]);
    const service = createWaveformService({ ...f.options, ffmpeg: slow }), abort = new AbortController();
    const result = service.get('uncached', { signal: abort.signal });
    const rejected = assert.rejects(result, (error: any) => error.status === 499);
    await new Promise((resolve) => setTimeout(resolve, 60)); const before = Date.now(); abort.abort(); await rejected; await service.close(); assert(Date.now() - before < 3500);
    const timed = createWaveformService({ ...f.options, ffmpeg: slow, timeoutMs: 100 });
    try { await assert.rejects(() => timed.get('uncached'), (error: any) => error.status === 504); } finally { await timed.close(); }
    await f.service.close(); await assert.rejects(() => f.service.get('source'), (error: any) => error.status === 503);
  } finally { await f.cleanup(); }
});
