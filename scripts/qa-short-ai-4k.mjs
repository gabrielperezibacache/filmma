/** Validate the existing short-clip AI job and UHD renderer; never starts inference. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, appendFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { renderProject } from '../server/render.ts';
import { projectSchema } from '../server/types.ts';
import { runProcess, parseJsonOutput } from '../server/process.ts';
import { validateAiFrameClock } from '../server/ai-enhance.ts';

const root = resolve(import.meta.dirname, '..'), qa = join(root, 'output/qa/minimax-scene/short-4k');
const store = join(root, 'output/qa/minimax-scene/store'), signal = new AbortController().signal;
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const exists = async file => access(file).then(() => true, () => false);
const command = async (args, timeoutMs = 120000) => {
  const result = await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-n', ...args], { signal, timeoutMs });
  if (result.code !== 0) throw new Error(result.stderr || 'FFmpeg failed');
  return result;
};
const probe = async file => {
  const result = await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { signal, timeoutMs: 120000 });
  if (result.code !== 0) throw new Error(result.stderr);
  return parseJsonOutput(result.stdout);
};
const video = metadata => metadata.streams.find(stream => stream.codec_type === 'video');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
if (await exists(join(qa, 'report.json'))) throw new Error('QA evidence exists; do not rerender or overwrite it.');
const before = await json(join(qa, 'before.json')), submit = await json(join(qa, 'enhance-submit.json'));
const bootstrap = await fetch('http://127.0.0.1:4317/api/bootstrap').then(response => response.json());
const job = bootstrap.jobs.find(item => item.id === submit.response.job.id);
assert(job?.status === 'completed', `Existing enhancement is ${job?.status}: ${job?.message}. No new job is started.`);
await save(join(qa, 'enhance-completed.json'), job);
const project = bootstrap.project;
assert(project.id === before.project.id, 'QA project changed.');
assert(JSON.stringify(project.scenes) === JSON.stringify(before.project.scenes), 'The long scene changed.');
const derivative = project.assets.find(asset => asset.id === job.result.assetId);
const original = project.assets.find(asset => asset.id === derivative?.enhancement?.sourceAssetId);
assert(original && derivative?.enhancement?.method === 'realesrgan-ncnn', 'Real AI provenance missing.');
assert(derivative.enhancement.model === 'realesrgan-x4plus' && derivative.enhancement.strength === .35, 'Unexpected AI profile.');
const mediaPath = async asset => join(store, 'media', basename(asset.url));
const originalCopy = await mediaPath(original), aiSource = await mediaPath(derivative);
const originalMetadata = await probe(originalCopy), aiMetadata = await probe(aiSource);
const originalVideo = video(originalMetadata), aiVideo = video(aiMetadata);
for (const [path, metadata] of [[originalCopy, originalMetadata], [aiSource, aiMetadata]]) {
  const stream = video(metadata);
  assert(Number(stream.nb_read_frames) === 22 && stream.avg_frame_rate === '24/1' && Math.abs(Number(stream.duration) - 22 / 24) < .002, 'Frame clock differs from the genuine 22 source frames.');
  await validateAiFrameClock(path, 'ffprobe', signal, 22, 24);
  await command(['-i', path, '-f', 'null', '-']);
}
assert(aiVideo.width === 3642 && aiVideo.height === 2276, 'Unexpected aspect-preserving AI size.');
assert(await hash(before.originalPath) === before.originalSha256 && await hash(originalCopy) === before.originalSha256, 'Original changed.');
assert(derivative.enhancement.sourceSha256 === before.originalSha256 && derivative.enhancement.outputSha256 === await hash(aiSource), 'Provenance hashes mismatch.');
const aiCopy = join(qa, 'detail-ai-3642x2276.mp4');
await copyFile(aiSource, aiCopy, constants.COPYFILE_EXCL);
await save(join(qa, 'source-probe.json'), originalMetadata);
await save(join(qa, 'ai-probe.json'), aiMetadata);
await save(join(qa, 'enhancement-provenance.json'), derivative.enhancement);

// No API/store write: the scene API has a one-second minimum. Exercise the real
// frame-based renderer separately rather than holding the smoke take to 1s.
const fixture = { ...structuredClone(project), id: 'qa-short-4k-export', name: 'QA breve · 22 fotogramas auténticos',
  scenes: [{ ...structuredClone(project.scenes[0]), id: 'short-native-take', title: 'Toma breve verificada · 22 fotogramas', duration: 22 / 24,
    videoAssetId: derivative.id, takeAssetIds: [original.id, derivative.id], trimStart: 0, speed: 1, transition: 'cut', look: 'original' }],
  tracks: [], subtitleCues: [], dialogueLines: [], subtitlesEnabled: false, aiFinishing: { enabled: false, strength: .35 } };
const apiBoundary = projectSchema.safeParse(fixture);
assert(!apiBoundary.success && apiBoundary.error.issues.some(issue => issue.path.join('.') === 'scenes.0.duration'), 'Review API duration assumptions.');
await save(join(qa, 'renderer-fixture.json'), fixture);
await save(join(qa, 'api-duration-limit.json'), { requestedSeconds: 22 / 24, minimumSceneSeconds: 1, apiSchemaAccepted: false, issues: apiBoundary.error.issues,
  scope: 'Enhancement used the actual API. Exact 22-frame UHD export below one second uses the actual renderer directly in an isolated fixture; it is not an end-to-end UI export claim.' });
const destination = join(qa, 'uhd-3840x2160-22frames.mp4'), work = join(qa, 'render-work');
assert(!await exists(destination), 'UHD result already exists.');
await mkdir(work, { recursive: true });
const renderStarted = Date.now();
await renderProject(fixture, { destination, workDirectory: work, mediaPath, resolution: '2160p', signal,
  update(message, progress) { void appendFile(join(qa, 'render-progress.jsonl'), JSON.stringify({ at: new Date().toISOString(), message, progress }) + '\n'); } });
const rendererSeconds = (Date.now() - renderStarted) / 1000;
const rendered = await probe(destination), renderedVideo = video(rendered);
assert(renderedVideo.width === 3840 && renderedVideo.height === 2160 && Number(renderedVideo.nb_read_frames) === 22 && renderedVideo.avg_frame_rate === '24/1' && Math.abs(Number(renderedVideo.duration) - 22 / 24) < .002, 'UHD export frame/resolution mismatch.');
await validateAiFrameClock(destination, 'ffprobe', signal, 22, 24);
await command(['-i', destination, '-f', 'null', '-']);
await save(join(qa, 'uhd-probe.json'), rendered);
const selection = 'select=eq(n\\,0)+eq(n\\,10)+eq(n\\,21)';
await command(['-i', aiCopy, '-vf', selection, '-fps_mode', 'vfr', '-frames:v', '3', join(qa, 'ai-native-%02d.png')]);
await command(['-i', destination, '-vf', 'select=eq(n\\,10)', '-frames:v', '1', join(qa, 'uhd-frame-10.png')]);
await command(['-i', originalCopy, '-vf', 'select=eq(n\\,10),scale=3642:2276:flags=lanczos,crop=800:800:1350:700', '-frames:v', '1', join(qa, 'detail-lanczos-reference.png')]);
await command(['-i', aiCopy, '-vf', 'select=eq(n\\,10),crop=800:800:1350:700', '-frames:v', '1', join(qa, 'detail-ai-comparison.png')]);
const audioHashes = [];
for (const [label, path] of [['original', originalCopy], ['ai', aiSource]]) {
  const audioPath = join(qa, `${label}-audio.aac`);
  await command(['-i', path, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', audioPath]);
  audioHashes.push({ label, sha256: await hash(audioPath) });
}
assert(audioHashes[0].sha256 === audioHashes[1].sha256, 'Enhanced AAC packets differ from source.');
const finalBootstrap = await fetch('http://127.0.0.1:4317/api/bootstrap').then(response => response.json());
assert(JSON.stringify(finalBootstrap.project.scenes) === JSON.stringify(before.project.scenes), 'Long scene changed.');
const report = { status: 'media-verified-awaiting-visual-comparison', verifiedAt: new Date().toISOString(), enhancementJob: job,
  original: { path: before.originalPath, preservedCopy: originalCopy, sha256: await hash(before.originalPath), originalPreserved: await hash(before.originalPath) === before.originalSha256 && await hash(originalCopy) === before.originalSha256, width: originalVideo.width, height: originalVideo.height },
  ai: { path: aiCopy, libraryPath: aiSource, sha256: await hash(aiCopy), width: aiVideo.width, height: aiVideo.height, provenance: derivative.enhancement, nativeModelScale: 4, nativeAiIntermediate: [2048, 1280], finalResample: [3642, 2276], audioPacketsPreserved: true, audioHashes },
  uhd: { path: destination, sha256: await hash(destination), width: renderedVideo.width, height: renderedVideo.height, rendererSeconds, method: 'Real Filmma renderer, separate in-memory fixture; no API scene-duration bypass persisted.', fit: 'Original proportion contained with lateral black bars; no crop.', framePaddingRequired: false },
  timing: { sourceFrames: 22, aiFrames: 22, uhdFrames: 22, fps: 24, videoDurationSeconds: 22 / 24, frameClockVerifiedForAll: true, decodedCompletely: true },
  preservation: { longSceneUnchanged: true, productionProjectSha256Before: before.productionProjectSha256, productionProjectSha256After: await hash(join(root, 'data/project.json')) },
  limits: ['22 source frames only; not proof of 15-second generation.', 'Real-ESRGAN is frame-independent; this does not guarantee face identity or temporal stability.', 'The neural model is 4x, then Lanczos resamples to the aspect-preserving 4K area; generated detail is not verified scene truth.', 'Subsecond 22-frame export was tested through the real renderer, not the public scene API whose minimum is 1 second.', 'UHD encoding contains exactly 22 frames; no freeze, loop, slowdown or frame interpolation was requested.'],
  inspectedImages: [join(qa, 'detail-lanczos-reference.png'), join(qa, 'detail-ai-comparison.png'), join(qa, 'uhd-frame-10.png')] };
await save(join(qa, 'report.json'), report);
console.log(JSON.stringify({ report: join(qa, 'report.json'), aiPath: aiCopy, uhdPath: destination, frames: 22, fps: 24, duration: 22 / 24, originalPreserved: report.original.originalPreserved }));
