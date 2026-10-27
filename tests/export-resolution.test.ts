import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { createSeedProject } from '../server/seed.js';
import { renderProject } from '../server/render.js';
import { runProcess, parseJsonOutput } from '../server/process.js';
import { exportDimensions, projectAspectRatio, PROJECT_FORMATS, PROJECT_FRAME_RATES } from '../src/export-resolution.js';
import { projectSchema } from '../server/types.js';
import { buildTimeline, frameToTimecode, splitProjectScene } from '../src/timeline.js';
import { createHash } from 'node:crypto';
import { trimProjectScene } from '../src/scene-trim.js';
import { sourceTrim } from '../src/sourceTrim.js';
import { cuesFromDialogue, replaceSceneSubtitleCues, resolveSubtitleCues } from '../src/subtitles.js';
import { projectToEdl, projectToSrt } from '../server/extensions.js';

test('export canvases retain horizontal, vertical and square framing at both delivery resolutions', () => {
  assert.deepEqual(exportDimensions('16:9'), [1920, 1080]);
  assert.deepEqual(exportDimensions('9:16'), [1080, 1920]);
  assert.deepEqual(exportDimensions('1:1'), [1080, 1080]);
  assert.deepEqual(exportDimensions('16:9', '2160p'), [3840, 2160]);
  assert.deepEqual(exportDimensions('9:16', '2160p'), [2160, 3840]);
  assert.deepEqual(exportDimensions('1:1', '2160p'), [2160, 2160]);
  assert.deepEqual(exportDimensions('legacy', '2160p'), [3840, 2160]);
  assert.deepEqual(exportDimensions('4:3'), [1440, 1080]);
  assert.deepEqual(exportDimensions('4:5'), [1080, 1350]);
  assert.deepEqual(exportDimensions('2.39:1'), [1920, 804]);
  assert.deepEqual(exportDimensions('4:3', '2160p'), [2880, 2160]);
  assert.deepEqual(exportDimensions('4:5', '2160p'), [2160, 2700]);
  assert.deepEqual(exportDimensions('2.39:1', '2160p'), [3840, 1608]);
  for (const format of PROJECT_FORMATS) {
    const [width, height] = exportDimensions(format, '2160p');
    assert.equal(width % 2, 0); assert.equal(height % 2, 0);
    assert.ok(width * height <= 3840 * 2160, 'each canvas stays within the UHD pixel budget');
    assert.ok(Math.abs(width / height - projectAspectRatio(format)) < .003, 'preview and export keep the same framing within codec rounding');
  }
});

test('editable delivery settings validate supported ratios and frame rates with cinematic defaults', () => {
  const original = createSeedProject(), before = structuredClone(original);
  const { format: _format, fps: _fps, ...missingSettings } = original;
  const defaults = projectSchema.parse(missingSettings);
  assert.equal(defaults.format, '16:9'); assert.equal(defaults.fps, 24);
  for (const format of PROJECT_FORMATS) for (const fps of PROJECT_FRAME_RATES) {
    const project = projectSchema.parse({ ...original, format, fps });
    assert.equal(project.format, format); assert.equal(project.fps, fps);
    assert.deepEqual(project.characters, before.characters);
    assert.deepEqual(project.scenes, before.scenes);
    assert.deepEqual(project.assets, before.assets);
    assert.equal(buildTimeline(project).fps, fps);
    assert.equal(frameToTimecode(fps * 60 - 1, fps), `00:00:59:${fps - 1}`);
    const divided = splitProjectScene(project, project.scenes[0]!.id, 1 + 1 / fps, `split-${fps}`);
    assert.equal(divided.scenes[0]!.duration, (fps + 1) / fps);
    assert.equal(buildTimeline(divided).totalFrames, buildTimeline(project).totalFrames);
  }
  for (const fps of [0, 23.976, 29.97, 59.94, 120, '60', null]) assert.equal(projectSchema.safeParse({ ...original, fps }).success, false);
  for (const format of ['21:9', 'custom', '', null]) assert.equal(projectSchema.safeParse({ ...original, format }).success, false);
  assert.deepEqual(original, before);
});

test('60 fps portrait export uses the selected frame clock and preserves original video and audio timing', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-delivery-clock-'));
  try {
    const source = join(directory, 'source.mov'), destination = join(directory, 'movie.mp4'), work = join(directory, 'work');
    await mkdir(work);
    const generated = await runProcess('ffmpeg', ['-y', '-v', 'error', '-threads', '2', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', source]);
    assert.equal(generated.code, 0, generated.stderr);
    const checksum = createHash('sha256').update(await readFile(source)).digest('hex');
    const project = createSeedProject(); project.format = '4:5'; project.fps = 60; project.subtitlesEnabled = false;
    project.scenes = [{ ...project.scenes[0]!, duration: 61 / 60, assetId: undefined, videoAssetId: 'source', trimStart: 0 }, { ...project.scenes[1]!, duration: 1, assetId: undefined, videoAssetId: 'source', trimStart: 1.5 }];
    project.assets = [{ id: 'source', name: 'Original 24 fps', type: 'video', url: '/api/media/source.mov', mime: 'video/quicktime', size: 0 }];
    const before = structuredClone(project);
    await renderProject(project, { destination, workDirectory: work, mediaPath: async () => source, signal: new AbortController().signal, update: () => {}, dimensions: [144, 180] });
    const result = await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,nb_read_frames,avg_frame_rate,duration,sample_rate', '-of', 'json', destination]);
    assert.equal(result.code, 0, result.stderr);
    const streams = parseJsonOutput(result.stdout).streams, video = streams.find((stream: any) => stream.codec_type === 'video'), audio = streams.find((stream: any) => stream.codec_type === 'audio');
    assert.equal(video.width, 144); assert.equal(video.height, 180); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_read_frames), 121);
    assert.ok(Math.abs(Number(video.duration) - 121 / 60) < .00001);
    assert.equal(audio.sample_rate, '48000'); assert.ok(Math.abs(Number(audio.duration) - 121 / 60) < 1 / 60);
    const decoded = await runProcess('ffmpeg', ['-v', 'error', '-xerror', '-i', destination, '-f', 'null', '-']); assert.equal(decoded.code, 0, decoded.stderr);
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), checksum, 'changing delivery does not rewrite the 24 fps original');
    assert.deepEqual(project, before, 'export retains scene durations, references and continuity');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('high-rate source trims, anchored subtitles and EDL share the output clock without altering script or identities', () => {
  for (const fps of [48, 50, 60] as const) {
    const project = createSeedProject(); project.fps = fps;
    project.scenes = [{ ...project.scenes[0]!, duration: 2 + 1 / fps, dialogue: 'ELENA: Una más.', videoAssetId: 'source', trimStart: 1 }];
    project.assets.push({ id: 'source', name: 'Original', type: 'video', url: '/api/media/original.mp4', mime: 'video/mp4', size: 1 });
    project.subtitlesEnabled = true;
    const scene = project.scenes[0]!, before = structuredClone(project);
    assert.deepEqual(sourceTrim(fps + 1, 2 * fps + 2, 4, fps), { trimStart: (fps + 1) / fps, duration: (fps + 1) / fps });
    const proposal = cuesFromDialogue(scene, fps, project.characters, () => 'cue');
    assert.equal(proposal[0]!.end, (2 * fps + 1) / fps);
    const captions = replaceSceneSubtitleCues(project, scene.id, [{ ...proposal[0]!, start: 1 / fps, end: 2 / fps }]);
    assert.deepEqual(resolveSubtitleCues(captions).map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[1, 2]]);
    const trimmed = trimProjectScene(captions, scene.id, 'start', 1);
    assert.equal(trimmed.scenes[0]!.duration, 2); assert.equal(trimmed.scenes[0]!.trimStart, (fps + 1) / fps);
    assert.deepEqual(resolveSubtitleCues(trimmed).map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 1]]);
    const validated = projectSchema.parse(trimmed);
    assert.match(projectToEdl(validated), new RegExp(`FILMMA FRAME RATE: ${fps}`));
    assert.match(projectToEdl(validated), /00:00:01:01 00:00:03:01 01:00:00:00 01:00:02:00/);
    assert.match(projectToSrt(validated), new RegExp(`00:00:00,000 --> 00:00:00,${String(Math.round(1000 / fps)).padStart(3, '0')}`));
    assert.equal(trimmed.scenes[0]!.dialogue, scene.dialogue); assert.deepEqual(trimmed.characters, project.characters);
    assert.deepEqual(project, before);
  }
});

test('the export API rejects invalid resolutions before queueing and retains a verified 1080p default', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-export-resolution-'));
  const publicDirectory = join(directory, 'public');
  await mkdir(join(publicDirectory, 'demo'), { recursive: true });
  await sharp({ create: { width: 160, height: 90, channels: 3, background: '#a88756' } }).png().toFile(join(publicDirectory, 'demo', 'scene-01.png'));
  const runtime = await createApp({ dataDirectory: join(directory, 'data'), publicDirectory, skipDiagnostics: true });
  const server: Server = await new Promise((resolve, reject) => { const listener = runtime.app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(listener)); });
  try {
    const address = server.address(); assert(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/export`;
    const request = (body: unknown) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify(body) });
    runtime.store.project.scenes = [{ ...runtime.store.project.scenes[0]!, duration: 1 }];
    runtime.store.project.subtitlesEnabled = false;
    const projectBefore = structuredClone(runtime.store.project), initialJobs = runtime.store.jobs.length;
    for (const resolution of ['4k', '480p', 2160, null]) {
      const response = await request({ format: 'mp4', resolution });
      assert.equal(response.status, 400, `must reject ${resolution}`);
      assert.equal(runtime.store.jobs.length, initialJobs, 'invalid input cannot add an export job');
    }
    const response = await request({ format: 'mp4' }); assert.equal(response.status, 202);
    const submitted = await response.json();
    const deadline = Date.now() + 45000;
    let job = runtime.store.jobs.find((item) => item.id === submitted.job.id)!;
    while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      job = runtime.store.jobs.find((item) => item.id === submitted.job.id)!;
    }
    assert.equal(job.status, 'completed', job.message);
    const metadata = job.result as typeof job.result & { resolution: string; width: number; height: number };
    assert.equal(metadata?.resolution, '1080p');
    assert.equal(metadata?.width, 1920); assert.equal(metadata?.height, 1080);
    const probe = await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,duration', '-of', 'json', join(directory, 'data', 'exports', job.result!.filename!)]);
    assert.equal(probe.code, 0, probe.stderr);
    const stream = parseJsonOutput(probe.stdout).streams[0];
    assert.equal(stream.width, 1920); assert.equal(stream.height, 1080); assert.equal(Number(stream.nb_read_frames), 24); assert.equal(Number(stream.duration), 1);
    const hdResponse = await request({ format: 'mp4', resolution: '720p' });
    assert.equal(hdResponse.status, 202);
    const hdSubmitted = await hdResponse.json();
    let hdJob = runtime.store.jobs.find((item) => item.id === hdSubmitted.job.id)!;
    const hdDeadline = Date.now() + 45000;
    while (['queued', 'running'].includes(hdJob.status) && Date.now() < hdDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      hdJob = runtime.store.jobs.find((item) => item.id === hdSubmitted.job.id)!;
    }
    assert.equal(hdJob.status, 'completed', hdJob.message);
    assert.equal((hdJob.result as typeof hdJob.result & { resolution: string })?.resolution, '720p');
    const hdProbe = await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,duration', '-of', 'json', join(directory, 'data', 'exports', hdJob.result!.filename!)]);
    assert.equal(hdProbe.code, 0, hdProbe.stderr);
    const hdStream = parseJsonOutput(hdProbe.stdout).streams[0];
    assert.equal(hdStream.width, 1280); assert.equal(hdStream.height, 720);
    assert.equal(Number(hdStream.nb_read_frames), 24); assert.equal(Number(hdStream.duration), 1);
    assert.deepEqual(runtime.store.project, projectBefore, 'export cannot alter the screenplay or character continuity');
  } finally {
    await runtime.close(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('render verification rejects an output whose reported dimensions differ from the canvas', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-export-verification-'));
  try {
    const source = join(directory, 'source.png'), work = join(directory, 'work'); await mkdir(work);
    await sharp({ create: { width: 160, height: 90, channels: 3, background: '#a88756' } }).png().toFile(source);
    const wrongProbe = join(directory, 'wrong-probe');
    await writeFile(wrongProbe, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({streams:[{width:160,height:90,nb_read_frames:24}],format:{duration:1}}));\n`);
    await chmod(wrongProbe, 0o700);
    const project = createSeedProject(); project.scenes = [{ ...project.scenes[0]!, duration: 1 }]; project.subtitlesEnabled = false;
    await assert.rejects(renderProject(project, { destination: join(directory, 'movie.mp4'), workDirectory: work, mediaPath: async () => source, signal: new AbortController().signal, update: () => {}, dimensions: [320, 180], ffprobe: wrongProbe }), /resolución exportada no coincide/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('render fits anamorphic video by its display aspect without cropping or stretching', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-export-aspect-'));
  try {
    const source = join(directory, 'anamorphic.mp4'), work = join(directory, 'work'), destination = join(directory, 'movie.mp4'); await mkdir(work);
    const generated = await runProcess('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x180:r=24:d=1', '-vf', 'setsar=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    assert.equal(generated.code, 0, generated.stderr);
    const project = createSeedProject(); project.scenes = [{ ...project.scenes[0]!, duration: 1, assetId: undefined, videoAssetId: 'source' }]; project.subtitlesEnabled = false;
    project.assets = [{ id: 'source', name: 'Anamorphic', type: 'video', url: '/api/media/anamorphic.mp4', mime: 'video/mp4', size: 0 }];
    await renderProject(project, { destination, workDirectory: work, mediaPath: async () => source, signal: new AbortController().signal, update: () => {}, dimensions: [320, 180] });
    const pixels = join(directory, 'edge.rgb');
    const decoded = await runProcess('ffmpeg', ['-y', '-v', 'error', '-i', destination, '-vf', 'crop=2:2:4:90,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', pixels]);
    assert.equal(decoded.code, 0, decoded.stderr);
    const edge = await readFile(pixels);
    assert.ok(edge[0]! > 230 && edge[1]! < 20 && edge[2]! < 20, 'the square-pixel 16:9 canvas must contain red at the edge, not a spurious black bar');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
