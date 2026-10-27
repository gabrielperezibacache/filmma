/** Isolated, real-engine acceptance workspace. Never imports or edits the user's movie.
 * node --import tsx scripts/qa-minimax-scene.mjs --prepare
 * node --import tsx scripts/qa-minimax-scene.mjs --serve
 * FILMMA_QA_DIST=output/qa/minimax-scene/dist node --import tsx scripts/qa-minimax-scene.mjs --serve
 * node --import tsx scripts/qa-minimax-scene.mjs --import /absolute/path/to/verified.mp4
 * Importing a sub-second smoke take keeps it in the library without attaching it
 * to the long scene. A held frame is never evidence of native generation.
 */
import { createApp } from '../server/app.ts';
import { projectSchema, validateEditingReferences } from '../server/types.ts';
import { runProcess, parseJsonOutput } from '../server/process.ts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, 'output/qa/minimax-scene');
const directory = join(evidence, 'store');
const projectFile = join(directory, 'project.json');
const action = process.argv[2] ?? '--prepare';
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const saveJson = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const exists = async path => access(path).then(() => true, () => false);
const probe = async path => {
  const result = await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path], { timeoutMs: 120000 });
  if (result.code !== 0) throw new Error(result.stderr || 'ffprobe failed');
  const metadata = parseJsonOutput(result.stdout), video = metadata.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('No video stream.');
  const [num, den = 1] = video.avg_frame_rate.split('/').map(Number);
  return { metadata, video, fps: num / den, frames: Number(video.nb_read_frames), duration: Number(video.duration) };
};

await mkdir(join(directory, 'media'), { recursive: true });
if (!await exists(projectFile)) {
  const project = projectSchema.parse({
    id: 'qa-minimax-scene', name: 'Prueba aislada · MiniMax H3 y 4K',
    logline: 'Verificación técnica de una toma continua de 345 fotogramas (14,375 s, dentro del máximo de 15 s) y su acabado 4K. El proyecto original no se modifica. Una prueba breve no demuestra generación de duración larga.',
    format: '16:9', fps: 24, updatedAt: new Date().toISOString(),
    aiFinishing: { enabled: false, strength: .35 },
    characters: [{
      id: 'camera-object', name: 'Cámara de cine de 35 mm', role: 'Objeto de continuidad · prueba', locked: true,
      description: 'Cámara de cine de 35 mm sobre una mesa de madera, junto a una ventana alta. Conservar la misma forma, metal cepillado y objetivo de vidrio.',
      continuity: { appearance: 'Cámara cinematográfica antigua de metal cepillado.', props: 'Objetivo de vidrio y mesa de madera.', notes: 'La cámara objeto permanece inmóvil. Sin marcas ni texto.' },
    }],
    scenes: [{
      id: 'camera-scene', title: 'La cámara junto a la ventana · 14,375 s', duration: 345 / 24, seed: 20261018,
      description: 'Una cámara antigua permanece sobre la mesa mientras el polvo flota en la luz de la tarde.', dialogue: '',
      prompt: 'A single continuous locked medium close-up of a vintage 35mm cinema camera on a wooden table beside a tall window. Warm late-afternoon light reveals brushed metal and glass. The camera object remains still while a few dust motes drift gently. Restrained cinematic realism, natural detail, no text or logos. Audio: quiet room ambience, no speech or music.',
      negativePrompt: 'text, logos, flicker, geometry changes, duplicated camera, new objects', camera: 'Cámara fija',
      cinematography: { framing: 'medium', movement: 'locked', lighting: 'window', pace: 'still', lens: '50mm', lensFamily: 'spherical-modern', cameraBody: 'cinema-digital' },
      look: 'original', transition: 'cut', characterIds: ['camera-object'], trimStart: 0, speed: 1,
    }],
    assets: [], tracks: [], subtitleCues: [], dialogueLines: [], subtitlesEnabled: false,
  });
  validateEditingReferences(project);
  await saveJson(projectFile, project);
  await saveJson(join(directory, 'jobs.json'), []);
  await saveJson(join(evidence, 'before.json'), {
    createdAt: new Date().toISOString(), project,
    productionProjectSha256: await sha(join(root, 'data/project.json')),
    nativeLongTakeVerified: false, targetFrames: 345, targetFps: 24, targetDuration: 345 / 24, maximumDuration: 15,
    notes: 'No source copied from the user project. No generation, enhancement or export starts automatically.',
  });
}

if (action === '--prepare') {
  const result = await runProcess('python3', [join(root, 'runtime/filmma_upscale.py'), 'doctor', '--json'], { cwd: root, timeoutMs: 30000 });
  await saveJson(join(evidence, 'upscaler-doctor.json'), parseJsonOutput(result.stdout));
  console.log(JSON.stringify({ prepared: true, directory, projectId: 'qa-minimax-scene', sceneId: 'camera-scene', gpuWorkStarted: false }));
} else if (action === '--import') {
  if (!process.argv[3]) throw new Error('Pass an absolute path to a completed, verified local video.');
  const source = resolve(process.argv[3]), sourceBefore = await sha(source), info = await probe(source);
  const request = await json(join(dirname(source), 'request.json'));
  const supervisor = await json(join(dirname(source), 'process.json'));
  if (request.model !== 'minimax-h3' || resolve(request.outputPath) !== source || supervisor.status !== 'media-verified' || resolve(supervisor.outputPath) !== source || supervisor.sha256 !== sourceBefore) throw new Error('MiniMax supervisor evidence must confirm this exact output before importing. An active or failed inference cannot be imported.');
  if (!(info.frames > 0 && info.fps > 0 && info.duration > 0 && info.duration <= 15.001 && Math.abs(info.frames / info.fps - info.duration) < .002)) throw new Error('The source must have verified timing and at most 15 seconds.');
  if (info.frames !== request.numFrames || Math.abs(info.fps - request.fps) > .00001 || info.video.width !== request.width || info.video.height !== request.height) throw new Error('The source does not match its generation request.');
  const decoded = await runProcess('ffmpeg', ['-v', 'error', '-nostdin', '-i', source, '-f', 'null', '-'], { timeoutMs: 120000 });
  if (decoded.code !== 0 || decoded.stderr.trim()) throw new Error(`The source does not decode cleanly: ${decoded.stderr}`);
  const project = projectSchema.parse(await json(projectFile));
  const id = `verified-${sourceBefore.slice(0, 20)}`, filename = `${id}.mp4`, target = join(directory, 'media', filename);
  if (!await exists(target)) await copyFile(source, target, constants.COPYFILE_EXCL);
  if (await sha(target) !== sourceBefore || await sha(source) !== sourceBefore) throw new Error('The source or its preserved copy changed.');
  if (!project.assets.some(asset => asset.id === id)) project.assets.push({ id, name: `MiniMax · original verificado · ${info.duration.toFixed(3)} s`, type: 'video', mime: 'video/mp4', url: `/api/media/${filename}`, size: (await stat(target)).size,
    generation: { projectId: project.id, sceneId: project.scenes[0].id, model: 'minimax-h3', prompt: request.prompt, negativePrompt: request.negativePrompt ?? '', seed: request.seed, createdAt: supervisor.completedAt, width: request.width, height: request.height, numFrames: request.numFrames, fps: request.fps, steps: request.steps, conditioningMode: 'text', referenceAssetIds: [], characterIds: [] },
  });
  // 345 frames is the requested compatible H3 profile below the 15-second cap.
  const nativeLongTakeVerified = info.frames === 345 && Math.abs(info.fps - 24) < .00001 && Math.abs(info.duration - 345 / 24) < .001;
  if (nativeLongTakeVerified) { project.scenes[0].videoAssetId = id; project.scenes[0].takeAssetIds = [...new Set([...(project.scenes[0].takeAssetIds ?? []), id])]; }
  project.updatedAt = new Date().toISOString();
  validateEditingReferences(project);
  await saveJson(projectFile, project);
  const evidenceFile = join(evidence, `import-${id}.json`);
  await saveJson(evidenceFile, { source, target, sha256: sourceBefore, originalPreserved: true, bytes: (await stat(source)).size, probe: info.metadata, decodeExitCode: decoded.code, nativeLongTakeVerified, sceneAttached: nativeLongTakeVerified, note: nativeLongTakeVerified ? '345 genuine source frames at 24 fps (14.375 s), below the 15-second maximum; no padding applied.' : 'Short source retained in library only. A frozen, slowed, looped or interpolated smoke clip is not evidence of native long generation.' });
  console.log(JSON.stringify({ imported: true, id, evidenceFile, nativeLongTakeVerified, sceneAttached: nativeLongTakeVerified }));
} else if (action === '--serve') {
  const distDirectory = resolve(root, process.env.FILMMA_QA_DIST || 'dist');
  const fixture = await createApp({ dataDirectory: directory, distDirectory, credentialsDirectory: join(evidence, 'private-test-connection') });
  const server = fixture.app.listen(4317, '127.0.0.1');
  await once(server, 'listening');
  console.log(JSON.stringify({ url: 'http://127.0.0.1:4317', directory, distDirectory, realRuntime: true, gpuWorkStarted: false }));
  const stop = async () => { await fixture.close(); server.closeAllConnections(); server.close(() => process.exit(0)); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} else {
  throw new Error('Use --prepare, --serve, or --import <verified.mp4>.');
}
