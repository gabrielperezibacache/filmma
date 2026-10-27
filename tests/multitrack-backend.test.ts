import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import { projectSchema, validateEditingReferences, type Project } from '../server/types.js';
import { createSeedProject } from '../server/seed.js';
import { Store } from '../server/store.js';
import { renderProject, subtitleCard } from '../server/render.js';
import { runProcess, parseJsonOutput } from '../server/process.js';
import { importProjectArchive, projectToSrt } from '../server/extensions.js';
import { detectMedia } from '../server/app.js';
import { writeZip } from '../server/zip.js';

function editingProject(): Project {
  const project = createSeedProject();
  project.scenes = [{ ...project.scenes[0]!, duration: 2, assetId: 'picture', audio: { volume: .6, fadeIn: .25, fadeOut: .5 } }];
  project.assets = [{ id: 'picture', name: 'Picture', type: 'image', url: '/api/media/picture.png', size: 0, mime: 'image/png' }, { id: 'sound', name: 'Sound', type: 'audio', url: '/api/media/sound.wav', size: 0, mime: 'audio/wav' }];
  project.characters[0]!.assetId = 'picture';
  project.scenes[0]!.continuity = { elena: { costume: 'Abrigo ocre' } };
  project.tracks = [{ id: 'audio-track', name: 'Voz', type: 'audio', muted: false, volume: .5, clips: [{ id: 'clip-one', assetId: 'sound', sceneId: project.scenes[0]!.id, offset: .25, duration: 3, trimStart: .5, fadeIn: .5, fadeOut: 1, volume: .25 }] }, { id: 'video-track', name: 'Imagen', type: 'video', muted: true, volume: 1, clips: [{ id: 'clip-two', assetId: 'picture', sceneId: project.scenes[0]!.id, offset: 1, duration: 1, trimStart: 0, opacity: .5 }] }];
  project.subtitleCues = [{ id: 'cue', sceneId: project.scenes[0]!.id, start: .5, end: 3, text: 'Hola <b> & adiós.', characterId: 'elena', sourceDialogue: 'Mi diálogo' }];
  project.subtitlesEnabled = false;
  return project;
}
test('multitrack schema and persistence retain optional editing state and reject limits or broken anchors', async () => {
  const project = projectSchema.parse(editingProject()); validateEditingReferences(project);
  const directory = await mkdtemp(join(tmpdir(), 'filmma-edit-schema-'));
  try {
    const store = new Store(directory); await store.init(); store.project = project; await store.save();
    const restored = new Store(directory); await restored.init(); assert.deepEqual(restored.project, project);
    assert(projectSchema.safeParse({ ...project, tracks: undefined, subtitleCues: undefined }).success);
    for (const patch of [{ volume: 1.1 }, { fadeIn: -1 }, { duration: .001 }, { opacity: 1.1 }]) {
      const bad = structuredClone(project); Object.assign(bad.tracks![0]!.clips[0]!, patch); assert.equal(projectSchema.safeParse(bad).success, false);
    }
    assert.equal(projectSchema.safeParse({ ...project, tracks: Array.from({ length: 9 }, () => project.tracks![0]) }).success, false);
    const duplicate = structuredClone(project); duplicate.tracks![1]!.clips[0]!.id = 'clip-one'; assert.throws(() => validateEditingReferences(duplicate), /únicos/);
    const missingScene = structuredClone(project); missingScene.tracks![0]!.clips[0]!.sceneId = 'missing'; assert.throws(() => validateEditingReferences(missingScene), /plano inexistente/);
    const wrongType = structuredClone(project); wrongType.tracks![0]!.clips[0]!.assetId = 'picture'; assert.throws(() => validateEditingReferences(wrongType), /tipo/);
    const missingSpeaker = structuredClone(project); missingSpeaker.subtitleCues![0]!.characterId = 'missing'; assert.throws(() => validateEditingReferences(missingSpeaker), /personaje inexistente/);
    // Speaker survives unlinking from a scene; it is metadata, not a render prefix.
    project.scenes[0]!.characterIds = []; validateEditingReferences(project);
    assert.match(projectToSrt(project), /00:00:00,500 --> 00:00:02,000\nHola &lt;b&gt; &amp; adiós/);
    project.subtitleCues = []; assert.equal(projectToSrt(project), '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('archive imports remap all track, speaker, anchor and continuity identities and preserve original bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-edit-archive-'));
  try {
    const project = editingProject(), dataDirectory = join(directory, 'data'), store = new Store(dataDirectory); await store.init();
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).png().toBuffer();
    const wave = join(directory, 'sound.wav'); const result = await runProcess('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', wave]); assert.equal(result.code, 0, result.stderr);
    const sound = await readFile(wave); project.assets[0]!.url = 'assets/picture.png'; project.assets[0]!.size = image.length; project.assets[1]!.url = 'assets/sound.wav'; project.assets[1]!.size = sound.length;
    const archive = join(directory, 'movie.zip'); await writeZip(archive, [{ name: 'assets/picture.png', data: image }, { name: 'assets/sound.wav', data: sound }, { name: 'project.json', data: Buffer.from(JSON.stringify({ schemaVersion: 1, project })) }]);
    const imported = await importProjectArchive(archive, { store, dataDirectory, detectMedia, backupProject: async () => {} });
    assert.notEqual(imported.scenes[0]!.id, project.scenes[0]!.id); assert.notEqual(imported.characters[0]!.id, project.characters[0]!.id);
    assert.deepEqual(imported.scenes[0]!.audio, project.scenes[0]!.audio); assert.equal(imported.tracks![0]!.clips[0]!.assetId, imported.assets[1]!.id);
    assert.equal(imported.tracks![0]!.clips[0]!.sceneId, imported.scenes[0]!.id); assert.notEqual(imported.tracks![0]!.clips[0]!.id, project.tracks![0]!.clips[0]!.id);
    assert.equal(imported.subtitleCues![0]!.sceneId, imported.scenes[0]!.id); assert.equal(imported.subtitleCues![0]!.characterId, imported.characters[0]!.id);
    assert.equal(imported.scenes[0]!.continuity![imported.characters[0]!.id]!.costume, 'Abrigo ocre');
    assert.equal(imported.subtitleCues![0]!.text, project.subtitleCues![0]!.text); assert.equal(imported.subtitlesEnabled, false);
    assert.deepEqual(await readFile(join(dataDirectory, 'media', basename(imported.assets[1]!.url))), sound);
    validateEditingReferences(imported);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function command(args: string[]) { const result = await runProcess('ffmpeg', ['-y', '-v', 'error', ...args]); assert.equal(result.code, 0, result.stderr); }
async function pixel(video: string, frame: number, directory: string, x = 160, y = 80) {
  const path = join(directory, `frame-${frame}.png`);
  await command(['-i', video, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', path]);
  return [...await sharp(path).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
}
function rms(bytes: Buffer, from: number, to: number) {
  let sum = 0, count = 0;
  for (let sample = Math.round(from * 48000); sample < Math.round(to * 48000); sample++) { const value = bytes.readFloatLE(sample * 4); sum += value * value; count++; }
  return Math.sqrt(sum / count);
}
test('real renderer composes ordered transparent layers, holds EOF, clamps to movie and mixes audio with exact subtitle frames', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-edit-render-')), work = join(directory, 'work'); await mkdir(work);
  try {
    const red = join(directory, 'red.mp4'), green = join(directory, 'green.mp4'), sound = join(directory, 'sound.wav');
    await command(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red]);
    await command(['-f', 'lavfi', '-i', 'color=0x00ff00:s=320x180:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', green]);
    await command(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', sound]);
    await sharp({ create: { width: 90, height: 180, channels: 3, background: 'blue' } }).png().toFile(join(directory, 'blue.png'));
    await sharp({ create: { width: 320, height: 180, channels: 3, background: 'black' } }).png().toFile(join(directory, 'black.png'));
    const project = createSeedProject(); project.characters = [];
    project.assets = [['red', 'video', 'mp4'], ['green', 'video', 'mp4'], ['sound', 'audio', 'wav'], ['blue', 'image', 'png'], ['black', 'image', 'png']].map(([id, type, extension]) => ({ id: id!, type: type as 'video'|'audio'|'image', url: `/api/media/${id}.${extension}`, name: id!, size: 0, mime: `${type}/${extension}` }));
    project.scenes = [{ ...project.scenes[0]!, id: 'first', duration: 1.5, assetId: undefined, videoAssetId: 'red', characterIds: [], audio: { muted: true } }, { ...project.scenes[1]!, id: 'second', duration: 1.5, assetId: 'black', characterIds: [] }];
    project.tracks = [
      { id: 'lower', name: 'Azul', type: 'video', muted: true, volume: 1, clips: [{ id: 'blue-clip', assetId: 'blue', sceneId: 'first', offset: .5, duration: 1, trimStart: 0 }] },
      { id: 'upper', name: 'Verde', type: 'video', muted: true, volume: 1, clips: [{ id: 'green-clip', assetId: 'green', sceneId: 'first', offset: 1, duration: 1.5, trimStart: 2, opacity: .5 }] },
      { id: 'voice', name: 'Voz', type: 'audio', muted: false, volume: .5, clips: [{ id: 'sound-clip', assetId: 'sound', sceneId: 'first', offset: .5, duration: 5, trimStart: .25, volume: .5, fadeIn: .5, fadeOut: 2 }] },
    ];
    project.subtitleCues = [{ id: 'sub', sceneId: 'second', start: .5, end: 1, text: 'Hola <b> & {\\pos(0,0)}' }];
    const output = join(directory, 'movie.mp4');
    await renderProject(project, { destination: output, workDirectory: work, mediaPath: async (asset) => join(directory, basename(asset.url)), signal: new AbortController().signal, update: () => {}, dimensions: [320, 180] });
    const first = await pixel(output, 4, directory); assert(first[0]! > 240 && first[1]! < 10, String(first));
    const blue = await pixel(output, 18, directory); assert(blue[2]! > 240 && blue[0]! < 10, String(blue));
    const padded = await pixel(output, 18, directory, 10, 80); assert(padded.every((channel) => channel < 10), 'contain pads an extra image with opaque black');
    const cyan = await pixel(output, 30, directory); assert(cyan[0]! < 10 && cyan[1]! > 110 && cyan[1]! < 145 && cyan[2]! > 110, String(cyan));
    const halfGreen = await pixel(output, 42, directory); assert(halfGreen[1]! > 110 && halfGreen[1]! < 145 && halfGreen[2]! < 10, String(halfGreen));
    const black = await pixel(output, 62, directory); assert(black.every((channel) => channel < 10), String(black));
    const bottomBefore = await pixel(output, 47, directory, 24, 158), bottomDuring = await pixel(output, 48, directory, 24, 158), bottomAfter = await pixel(output, 60, directory, 24, 158);
    assert(bottomBefore[1]! > 110, String(bottomBefore)); assert(bottomDuring[1]! < 55, String(bottomDuring)); assert(bottomAfter.every((value) => value < 10), String(bottomAfter));
    const audioPath = join(directory, 'audio.f32'); await command(['-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', audioPath]); const samples = await readFile(audioPath);
    assert(rms(samples, .15, .3) < .0001, 'muted base scene stays silent');
    assert(rms(samples, .55, .65) < rms(samples, 1.05, 1.15) * .5, 'input fade follows clip start');
    assert(Math.abs(rms(samples, 1.05, 1.15) - .125 / Math.sqrt(2) * .25) < .001, `track × clip gain and no premature movie-end fade: ${rms(samples, 1.05, 1.15)}`);
    assert(rms(samples, 1.4, 1.7) < .0001, 'audio is silent beyond the trimmed source');
    const probe = await runProcess('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', output]); assert.equal(parseJsonOutput(probe.stdout).streams[0].nb_read_frames, '72');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('base scene audio follows its own level and fades; trimming beyond video EOF freezes without leaking source audio', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-scene-audio-')), work = join(directory, 'work'); await mkdir(work);
  try {
    const source = join(directory, 'source.mp4');
    await command(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
    const project = createSeedProject(); project.characters = [];
    project.assets = [{ id: 'source', name: 'Fuente', url: '/api/media/source.mp4', mime: 'video/mp4', type: 'video', size: 0 }];
    project.scenes = [{ ...project.scenes[0]!, id: 'first', duration: 2, trimStart: .5, assetId: undefined, videoAssetId: 'source', characterIds: [], audio: { volume: .5, fadeIn: .5, fadeOut: .5 } }, { ...project.scenes[1]!, id: 'second', duration: 2, trimStart: 4, assetId: undefined, videoAssetId: 'source', characterIds: [] }];
    const output = join(directory, 'movie.mp4');
    await renderProject(project, { destination: output, workDirectory: work, mediaPath: async () => source, signal: new AbortController().signal, update: () => {}, dimensions: [320, 180] });
    const samplesPath = join(directory, 'samples.f32'); await command(['-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', samplesPath]); const samples = await readFile(samplesPath);
    const middle = rms(samples, .8, 1.2); assert(Math.abs(middle - .125 / Math.sqrt(2) * .5) < .002, String(middle));
    assert(rms(samples, .05, .15) < middle * .35); assert(rms(samples, 1.85, 1.95) < middle * .35);
    assert(rms(samples, 2.1, 3.8) < .0001);
    const last = await pixel(output, 90, directory); assert(last[0]! > 240 && last[1]! < 10, String(last));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('subtitle rasterization displays markup literally and preserves long Unicode text without XML execution', async () => {
  const safe = await subtitleCard('<span size="99999">¡Elena & 中! {\\pos(0,0)}</span>', 640, 360);
  const metadata = await sharp(safe).metadata(); assert.equal(metadata.width, 640); assert.equal(metadata.height, 360);
  assert.equal(metadata.hasAlpha, true);
  await assert.rejects(() => subtitleCard('a'.repeat(20001), 640, 360), /superpuestos/);
});

test('fractional scene durations and one-frame overlays retain an exact 24 fps clock across cuts', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-frame-clock-')), work = join(directory, 'work'); await mkdir(work);
  try {
    await sharp({ create: { width: 320, height: 180, channels: 3, background: 'black' } }).png().toFile(join(directory, 'black.png'));
    await sharp({ create: { width: 320, height: 180, channels: 3, background: 'red' } }).png().toFile(join(directory, 'red.png'));
    await sharp({ create: { width: 320, height: 180, channels: 4, background: { r: 255, g: 0, b: 0, alpha: .25 } } }).png().toFile(join(directory, 'transparent.png'));
    const project = createSeedProject(); project.characters = [];
    project.assets = ['black', 'red', 'transparent'].map((id) => ({ id, name: id, type: 'image', mime: 'image/png', url: `/api/media/${id}.png`, size: 0 }));
    project.scenes = project.scenes.slice(0, 3).map((scene) => ({ ...scene, duration: 26 / 24, characterIds: [], assetId: 'black' }));
    project.tracks = [{ id: 'track', name: 'Un fotograma', type: 'video', muted: true, volume: 1, clips: [{ id: 'clip', assetId: 'red', sceneId: project.scenes[1]!.id, offset: 1 / 24, duration: 1 / 24, trimStart: 0 }] }];
    project.tracks[0]!.clips.push({ id: 'transparent', assetId: 'transparent', sceneId: project.scenes[1]!.id, offset: 2 / 24, duration: 1 / 24, trimStart: 0 });
    const output = join(directory, 'movie.mp4');
    await renderProject(project, { destination: output, workDirectory: work, mediaPath: async (asset) => join(directory, basename(asset.url)), signal: new AbortController().signal, update: () => {}, dimensions: [320, 180] });
    for (const frame of [26, 29]) assert((await pixel(output, frame, directory)).every((channel) => channel < 10), `frame ${frame} is outside the single-frame overlays`);
    assert((await pixel(output, 27, directory))[0]! > 240);
    const transparent = await pixel(output, 28, directory); assert(transparent[0]! >= 58 && transparent[0]! < 70 && transparent[1]! < 5, `transparent image must composite on black: ${transparent}`);
    const probe = await runProcess('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', output]);
    const frames = parseJsonOutput(probe.stdout).frames; assert.equal(frames.length, 78);
    frames.forEach((frame: any, index: number) => assert(Math.abs(Number(frame.best_effort_timestamp_time) - index / 24) < .000002, `frame ${index}`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
