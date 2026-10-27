import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { Store } from '../server/store.js';
import { createSeedProject } from '../server/seed.js';
import { detectMedia } from '../server/app.js';
import { writeZip } from '../server/zip.js';
import { importProjectArchive, projectToEdl, projectToSrt, registerExtensions } from '../server/extensions.js';
import type { Project } from '../server/types.js';

const image = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082', 'hex');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-archive-'));
  const dataDirectory = join(directory, 'data'), store = new Store(dataDirectory); await store.init();
  const backupProject = async (project: Project) => { await writeFile(join(dataDirectory, 'projects', `${project.id}-snapshot.json`), JSON.stringify(project)); };
  return { directory, dataDirectory, store, backupProject, detectMedia, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function portableProject() {
  const project = createSeedProject();
  project.assets = [{ id: 'original', name: 'Original de cámara.png', type: 'image', url: 'assets/original.png', mime: 'image/png', size: image.length }];
  project.scenes = [{ ...project.scenes[0]!, duration: 2.125, assetId: 'original', characterIds: ['elena'], endAssetId: 'original' }];
  project.characters = [{ ...project.characters[0]!, assetId: 'original' }];
  return project;
}
async function archive(directory: string, project: unknown = portableProject(), extras: { name: string; data: Buffer }[] = [], version = 1) {
  const path = join(directory, `project-${Math.random()}.filmma.zip`);
  await writeZip(path, [{ name: 'assets/original.png', data: image }, { name: 'project.json', data: Buffer.from(JSON.stringify({ schemaVersion: version, project })) }, { name: 'README.txt', data: Buffer.from('Filmma project') }, ...extras]);
  return path;
}
async function expectUntouched(f: Awaited<ReturnType<typeof fixture>>, operation: () => Promise<unknown>, message: RegExp) {
  const before = structuredClone(f.store.project);
  await assert.rejects(operation, message);
  assert.deepEqual(f.store.project, before);
  assert.deepEqual(await readdir(join(f.dataDirectory, 'media')), []);
  assert.deepEqual(await readdir(join(f.dataDirectory, 'work')), []);
  const persisted = JSON.parse(await readFile(join(f.dataDirectory, 'project.json'), 'utf8'));
  assert.deepEqual(persisted, before);
}
async function mutateArchive(path: string, mutation: (buffer: Buffer) => void) { const bytes = await readFile(path); mutation(bytes); await writeFile(path, bytes); }
function centralOffsets(buffer: Buffer) { const offsets: number[] = []; let start = buffer.readUInt32LE(buffer.length - 6); while (buffer.readUInt32LE(start) === 0x02014b50) { offsets.push(start); start += 46 + buffer.readUInt16LE(start + 28) + buffer.readUInt16LE(start + 30) + buffer.readUInt16LE(start + 32); } return offsets; }

test('Filmma ZIP roundtrip preserves original bytes, writing and references with independent identities', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.store.project), source = portableProject();
    source.scenes[0]!.color = { exposure: .5, contrast: 1.1, saturation: .8, temperature: -.2 }; source.scenes[0]!.speed = .5;
    source.tracks = [{ id: 'visual-track', name: 'Capas', type: 'video', muted: false, volume: 1, clips: [{ id: 'animated', assetId: 'original', sceneId: source.scenes[0]!.id, offset: .25, duration: 1, trimStart: 0, speed: 2, color: { exposure: -.5 }, transform: { x: 3, y: 5, scale: .5, opacity: .7 }, keyframes: [{ id: 'before-trim', time: -.25, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in-out' }, { id: 'last-key', time: 1, x: 30, y: -20, scale: 1.5, opacity: .4, easing: 'hold' }] }] }];
    const path = await archive(f.directory, source);
    const project = await importProjectArchive(path, f);
    assert.notEqual(project.id, source.id); assert.notEqual(project.assets[0]!.id, 'original');
    assert.equal(project.name, source.name); assert.equal(project.logline, source.logline);
    assert.equal(project.scenes[0]!.description, source.scenes[0]!.description); assert.equal(project.scenes[0]!.duration, 2.125);
    assert.deepEqual(project.scenes[0]!.color, source.scenes[0]!.color); assert.equal(project.scenes[0]!.speed, .5);
    const savedClip = project.tracks![0]!.clips[0]!, originalClip = source.tracks[0]!.clips[0]!;
    for (const field of ['color', 'speed', 'transform', 'keyframes'] as const) assert.deepEqual(savedClip[field], originalClip[field]);
    assert.equal(savedClip.sceneId, project.scenes[0]!.id); assert.equal(savedClip.assetId, project.assets[0]!.id);
    assert.equal(project.scenes[0]!.assetId, project.assets[0]!.id); assert.equal(project.scenes[0]!.endAssetId, project.assets[0]!.id); assert.equal(project.characters[0]!.assetId, project.assets[0]!.id);
    assert.equal(hash(await readFile(join(f.dataDirectory, 'media', basename(project.assets[0]!.url)))), hash(image));
    assert.deepEqual(JSON.parse(await readFile(join(f.dataDirectory, 'projects', `${before.id}-snapshot.json`), 'utf8')), before);
    assert.deepEqual(JSON.parse(await readFile(join(f.dataDirectory, 'project.json'), 'utf8')), JSON.parse(JSON.stringify(project)));
    assert.deepEqual(await readdir(join(f.dataDirectory, 'work')), []);
    const second = await importProjectArchive(path, f);
    assert.notEqual(second.id, project.id); assert.notEqual(second.assets[0]!.id, project.assets[0]!.id);
    assert.equal((await readdir(join(f.dataDirectory, 'media'))).length, 2);
  } finally { await f.cleanup(); }
});

test('early exported demo size zero is normalized to the unchanged original byte size', async () => {
  const f = await fixture();
  try { const source = portableProject(); source.assets[0]!.size = 0; const project = await importProjectArchive(await archive(f.directory, source), f); assert.equal(project.assets[0]!.size, image.length); }
  finally { await f.cleanup(); }
});

test('archive traversal paths, symlinks and duplicate names are rejected before any project mutation', async () => {
  const f = await fixture();
  try {
    const traversal = await archive(f.directory);
    await mutateArchive(traversal, (bytes) => {
      const original = Buffer.from('assets/original.png'), replacement = Buffer.from('../outside-file.txt'); assert.equal(original.length, replacement.length);
      for (let offset = bytes.indexOf(original); offset !== -1; offset = bytes.indexOf(original, offset + original.length)) replacement.copy(bytes, offset);
    });
    await expectUntouched(f, () => importProjectArchive(traversal, f), /Ruta ZIP/);
    const linked = await archive(f.directory);
    await mutateArchive(linked, (bytes) => bytes.writeUInt32LE(0xa0000000, centralOffsets(bytes)[0]! + 38));
    await expectUntouched(f, () => importProjectArchive(linked, f), /enlaces/);
    const duplicate = await archive(f.directory, portableProject(), [{ name: 'assets/original.png', data: image }]);
    await expectUntouched(f, () => importProjectArchive(duplicate, f), /repetida/);
  } finally { await f.cleanup(); }
});

test('CRC damage, truncated archives and ZIP size lies are rejected without touching the active project', async () => {
  const f = await fixture();
  try {
    const corrupt = await archive(f.directory);
    await mutateArchive(corrupt, (bytes) => { bytes[30 + bytes.readUInt16LE(26)]! ^= 0xff; });
    await expectUntouched(f, () => importProjectArchive(corrupt, f), /CRC/);
    const truncated = await archive(f.directory), bytes = await readFile(truncated); await writeFile(truncated, bytes.subarray(0, bytes.length - 10));
    await expectUntouched(f, () => importProjectArchive(truncated, f), /directorio/);
    const oversized = await archive(f.directory);
    await mutateArchive(oversized, (bytes) => bytes.writeUInt32LE(0xfffffffe, centralOffsets(bytes)[1]! + 24));
    await expectUntouched(f, () => importProjectArchive(oversized, f), /límites/);
    const overlapping = await archive(f.directory);
    await mutateArchive(overlapping, (bytes) => bytes.writeUInt32LE(0, centralOffsets(bytes)[1]! + 42));
    await expectUntouched(f, () => importProjectArchive(overlapping, f), /no coinciden/);
  } finally { await f.cleanup(); }
});

test('invalid project version, absent originals, bad references and unknown assets preserve the open project', async () => {
  const f = await fixture();
  try {
    await expectUntouched(f, async () => importProjectArchive(await archive(f.directory, portableProject(), [], 2), f), /versión/);
    const missing = portableProject(); missing.assets[0]!.url = 'assets/missing.png';
    await expectUntouched(f, async () => importProjectArchive(await archive(f.directory, missing), f), /Falta un original/);
    const broken = portableProject(); broken.scenes[0]!.characterIds = ['missing-character'];
    await expectUntouched(f, async () => importProjectArchive(await archive(f.directory, broken), f), /personaje inexistente/);
    const remote = portableProject(); remote.assets[0]!.url = '/api/media/private.png';
    await expectUntouched(f, async () => importProjectArchive(await archive(f.directory, remote), f), /ruta de original/);
    const extra = await archive(f.directory, portableProject(), [{ name: 'assets/extra.png', data: image }]);
    await expectUntouched(f, () => importProjectArchive(extra, f), /no están declarados/);
    const size = portableProject(); size.assets[0]!.size = image.length + 1;
    await expectUntouched(f, async () => importProjectArchive(await archive(f.directory, size), f), /tamaño/);
  } finally { await f.cleanup(); }
});

test('an edit arriving during import is preserved; imported media is rolled back', async () => {
  const f = await fixture();
  try {
    const path = await archive(f.directory);
    const operation = () => importProjectArchive(path, { ...f, backupProject: async (project) => { await f.backupProject(project); f.store.project.name = 'Edición concurrente'; await f.store.save(); } });
    await assert.rejects(operation, /cambió durante/);
    assert.equal(f.store.project.name, 'Edición concurrente'); assert.deepEqual(await readdir(join(f.dataDirectory, 'media')), []); assert.deepEqual(await readdir(join(f.dataDirectory, 'work')), []);
  } finally { await f.cleanup(); }
});

test('a failed import save restores the previous document and removes installed originals', async () => {
  const f = await fixture();
  try {
    const path = await archive(f.directory), save = f.store.save.bind(f.store); let calls = 0;
    f.store.save = () => { if (++calls === 1) return Promise.reject(new Error('Disk fixture')); return save(); };
    await expectUntouched(f, () => importProjectArchive(path, f), /Disk fixture/);
  } finally { await f.cleanup(); }
});

// Convert the first entry of the real writer's ZIP to deflate, updating offsets as an external ZIP utility would.
async function deflateFirst(path: string) {
  const source = await readFile(path), offsets = centralOffsets(source), first = offsets[0]!, localOffset = source.readUInt32LE(first + 42), size = source.readUInt32LE(first + 24);
  const start = localOffset + 30 + source.readUInt16LE(localOffset + 26) + source.readUInt16LE(localOffset + 28), compressed = deflateRawSync(source.subarray(start, start + size)), delta = compressed.length - size;
  const output = Buffer.concat([source.subarray(0, start), compressed, source.subarray(start + size)]);
  output.writeUInt16LE(8, localOffset + 8); output.writeUInt32LE(compressed.length, localOffset + 18);
  for (const [index, previous] of offsets.entries()) { const central = previous + delta; if (index === 0) { output.writeUInt16LE(8, central + 10); output.writeUInt32LE(compressed.length, central + 20); } else output.writeUInt32LE(source.readUInt32LE(previous + 42) + delta, central + 42); }
  output.writeUInt32LE(offsets[0]! + delta, output.length - 6); await writeFile(path, output);
}
test('deflated originals are accepted and restored byte for byte', async () => {
  const f = await fixture();
  try { const path = await archive(f.directory); await deflateFirst(path); const project = await importProjectArchive(path, f); assert.equal(hash(await readFile(join(f.dataDirectory, 'media', basename(project.assets[0]!.url)))), hash(image)); }
  finally { await f.cleanup(); }
});

test('EDL uses exact frame totals and video trims, and SRT follows the same scene timing', () => {
  const project = createSeedProject(); project.name = 'Película\nFCM: DROP FRAME'; project.fps = 24;
  project.assets.push({ id: 'video', name: 'Toma original.mp4', type: 'video', url: '/api/media/original.mp4', mime: 'video/mp4', size: 100 });
  project.scenes = [
    { ...project.scenes[0]!, duration: 1.1, dialogue: '', videoAssetId: 'video', trimStart: 2.5 },
    { ...project.scenes[1]!, duration: 2.125, dialogue: 'ELENA: Volvemos.\n\nHoy.', videoAssetId: 'video', trimStart: 5 },
    { ...project.scenes[2]!, duration: 1, dialogue: 'Se apaga la luz.', assetId: undefined },
  ];
  const edl = projectToEdl(project);
  assert.match(edl, /^TITLE: Película FCM: DROP FRAME\r\nFCM: NON-DROP FRAME/);
  assert.match(edl, /AX000001 V     C        00:00:02:12 00:00:03:14 01:00:00:00 01:00:01:02/);
  assert.match(edl, /AX000001 V     C        00:00:05:00 00:00:07:03 01:00:01:02 01:00:03:05/);
  assert.match(edl, /003  BL/); assert.match(edl, /MISSING MEDIA/); assert.match(edl, /FROM CLIP NAME: original.mp4/);
  assert.equal(projectToSrt(project), '1\n00:00:01,083 --> 00:00:03,208\nELENA: Volvemos.\nHoy.\n\n2\n00:00:03,208 --> 00:00:04,208\nSe apaga la luz.\n');
  assert.doesNotMatch(edl, /COLOR CORRECTION/);
  project.scenes[0]!.color = { exposure: 1 }; project.scenes[0]!.speed = .5;
  assert.match(projectToEdl(project), /COLOR CORRECTION, FILM LOOKS, SPEED CHANGES, LAYER TRANSFORMS AND KEYFRAMES ARE NOT INCLUDED/);
  assert.match(projectToEdl(project), /EVENTS USE NORMAL-SPEED CUTS/);
});

test('multipart project import and text export endpoints work and clean temporary uploads', async () => {
  const f = await fixture(), app = express(); registerExtensions({ ...f, app });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  try {
    const form = new FormData(); form.append('projectFile', new Blob([await readFile(await archive(f.directory))]), 'movie.filmma.zip');
    const response = await fetch(base + '/api/projects/import', { method: 'POST', body: form });
    assert.equal(response.status, 201, await response.clone().text()); const result = await response.json(); assert.equal(result.importedAsNew, true); assert.equal(result.project.id, f.store.project.id);
    assert.deepEqual(await readdir(join(f.dataDirectory, 'work')), []);
    const edl = await fetch(base + '/api/project/edl'); assert.equal(edl.status, 200); assert.match(edl.headers.get('Content-Disposition')!, /filmma-montaje.edl/); assert.match(await edl.text(), /FCM: NON-DROP FRAME/);
    assert.equal((await fetch(base + '/api/project/subtitles')).status, 400);
    f.store.project.scenes[0]!.dialogue = 'Volvemos.'; const srt = await fetch(base + '/api/project/subtitles'); assert.equal(srt.status, 200); assert.equal(srt.headers.get('X-Filmma-Subtitle-Timing'), 'scene-based'); assert.match(await srt.text(), /Volvemos/);
    const bad = new FormData(); bad.append('projectFile', new Blob(['not a zip']), 'bad.filmma.zip'); assert.equal((await fetch(base + '/api/projects/import', { method: 'POST', body: bad })).status, 400);
    assert.deepEqual(await readdir(join(f.dataDirectory, 'work')), []);
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await f.cleanup(); }
});
