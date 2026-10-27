import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFamilyId, compatibleAiCopy, filmFinishingPlan, finishFilm, replaceFinishingReference, type AiFinishingIdentity, type FinishingSummary } from '../server/film-finishing.js';
import { createSeedProject } from '../server/seed.js';
import type { Asset, Project } from '../server/types.js';

const identity: AiFinishingIdentity = { model: 'realesrgan-x4plus', version: '20220424', modelSha256: 'a'.repeat(64), temporalMode: 'frame-independent-conservative', tile: 128 };
const video = (id: string): Asset => ({ id, name: id, type: 'video', mime: 'video/mp4', url: `/api/media/${id}.mp4`, size: 100 });
function copy(sourceAssetId: string, id = `${sourceAssetId}-ai`, strength = .35): Asset {
  return { ...video(id), enhancement: { sourceAssetId, preset: 'ai-4k', method: 'realesrgan-ncnn', createdAt: '2026-10-17T00:00:00Z', width: 3840, height: 2160, fps: 24, duration: 2, strength, ...identity } };
}
function fixture(): Project {
  const project = createSeedProject();
  project.assets = [video('a'), video('b'), { id: 'still', name: 'Still', type: 'image', mime: 'image/png', url: '/api/media/still.png', size: 10 }, { id: 'score', name: 'Score', type: 'audio', mime: 'audio/wav', url: '/api/media/score.wav', size: 10 }];
  project.scenes = project.scenes.slice(0, 2).map((scene, index) => ({ ...scene, id: `scene-${index}`, assetId: 'still', videoAssetId: index ? 'b' : 'a', trimStart: .375, speed: .5, color: { temperature: .2 }, audio: { volume: .7, fadeIn: .25 } }));
  project.tracks = [
    { id: 'visual', name: 'Layer', type: 'video', volume: .4, muted: false, clips: [
      { id: 'layer-a', sceneId: 'scene-0', assetId: 'a', offset: .5, duration: 1, trimStart: .125, speed: 2, opacity: .7, color: { exposure: .2 }, transform: { x: 10, y: 5, scale: .5, opacity: .9 }, keyframes: [{ id: 'k', time: .5, x: 20, y: 5, scale: .8, opacity: .9, easing: 'ease-in-out' }], volume: .3, fadeOut: .2 },
      { id: 'layer-still', sceneId: 'scene-0', assetId: 'still', offset: 0, duration: 1, trimStart: 0 },
    ] },
    { id: 'audio', name: 'Dialogue', type: 'audio', volume: .8, muted: false, clips: [{ id: 'audio-a', sceneId: 'scene-0', assetId: 'score', offset: 0, duration: 1, trimStart: 0, volume: .6 }] },
  ];
  project.subtitleCues = [{ id: 'subtitle', sceneId: 'scene-0', start: .25, end: 1, text: 'Texto del guion.', characterId: project.characters[0]!.id }];
  project.audioAssetId = 'score'; project.audioVolume = .6;
  return project;
}
const options = (overrides: Partial<Parameters<typeof finishFilm>[1]> = {}): Parameters<typeof finishFilm>[1] => ({
  identity, strength: .35, signal: new AbortController().signal, latestAssets: async () => [], usableCopy: async () => true,
  create: async source => copy(source.id), update() {}, ...overrides,
});
const selected = (project: Project) => ({ scenes: project.scenes.map(scene => scene.videoAssetId), layers: project.tracks?.[0]?.clips.map(clip => clip.assetId) });

test('film plan deduplicates original families across scenes and visual layers and skips stills and audio', () => {
  const project = fixture(), derivative = copy('a'); project.assets.push(derivative);
  project.scenes[1]!.videoAssetId = derivative.id;
  project.scenes.push({ ...project.scenes[0]!, id: 'still-scene', videoAssetId: undefined });
  const plan = filmFinishingPlan(project);
  assert.equal(plan.sources.length, 1); assert.equal(plan.sources[0]!.source.id, 'a');
  assert.equal(plan.sources[0]!.references.length, 3);
  assert.deepEqual(plan.sources[0]!.references.map(reference => reference.assetId), ['a', derivative.id, 'a']);
  assert.deepEqual(plan.skipped.map(item => item.sourceAssetId), ['still']);
});

test('family traversal finds retained originals and rejects missing roots, self cycles and longer cycles', () => {
  const a = video('a'), first = copy('a', 'first'), second = copy('first', 'second');
  assert.equal(assetFamilyId('second', [a, first, second]), 'a');
  assert.equal(assetFamilyId(undefined, [a]), undefined);
  assert.throws(() => assetFamilyId('second', [second]), /original/);
  assert.throws(() => assetFamilyId('self', [copy('self', 'self')]), /ciclo/);
  assert.throws(() => assetFamilyId('one', [copy('two', 'one'), copy('one', 'two')]), /ciclo/);
  const project = fixture(); project.assets.push(copy('missing', 'broken')); project.scenes[0]!.videoAssetId = 'broken';
  assert.throws(() => filmFinishingPlan(project), /original/);
});

test('copy compatibility requires correct original, engine, model, hash, version, strength and processing profile', () => {
  const a = video('a'), b = video('b'), valid = copy('a');
  assert.equal(compatibleAiCopy(valid, a, [a, valid], identity, .35), true);
  const variants: Asset[] = [
    copy('b'), copy('a', 'stronger', .55), { ...valid, type: 'image' },
    ...[{ preset: 'upscale' }, { method: 'ffmpeg-lanczos' }, { model: 'anime' }, { version: 'another' }, { modelSha256: 'b'.repeat(64) }, { profile: 'restore' }, { temporalMode: 'different' }, { tile: 64 }, { strength: undefined }].map(patch => ({ ...valid, enhancement: { ...valid.enhancement!, ...patch } }) as Asset),
  ];
  for (const candidate of variants) assert.equal(compatibleAiCopy(candidate, a, [a, b, candidate], identity, .35), false, JSON.stringify(candidate.enhancement));
  const restoreIdentity: AiFinishingIdentity = {...identity,profile:'restore',temporalMode:'frame-independent-color-preserving-v1'};
  const restored: Asset={...copy('a','restored'),enhancement:{...copy('a').enhancement!,profile:'restore',temporalMode:restoreIdentity.temporalMode}};
  assert.equal(compatibleAiCopy(valid,a,[a,valid],restoreIdentity,.35),false,'an old conservative copy cannot satisfy restoration even at the same strength');
  assert.equal(compatibleAiCopy(restored,a,[a,restored],restoreIdentity,.35),true);
  assert.equal(compatibleAiCopy({...restored,enhancement:{...restored.enhancement!,temporalMode:identity.temporalMode}},a,[a,restored],restoreIdentity,.35),false);
});

test('replacement preserves all scene, layer, script, character and audio fields except source bindings', () => {
  const project = fixture(), before = structuredClone(project), derivative = copy('a');
  assert.equal(replaceFinishingReference(project, { kind: 'scene', sceneId: 'scene-0', assetId: 'a' }, derivative), true);
  assert.equal(replaceFinishingReference(project, { kind: 'clip', trackId: 'visual', clipId: 'layer-a', assetId: 'a' }, derivative), true);
  const expected = structuredClone(before); expected.assets.push(derivative); expected.scenes[0]!.videoAssetId = derivative.id; expected.tracks![0]!.clips[0]!.assetId = derivative.id;
  assert.deepEqual(project, expected);
  assert.equal(replaceFinishingReference(project, { kind: 'scene', sceneId: 'scene-0', assetId: 'a' }, derivative), false);
  assert.equal(project.assets.filter(asset => asset.id === derivative.id).length, 1);
});

test('manual changes, removed layers and explicit scene unlinks win over old finishing references', () => {
  const project = fixture(), derivative = copy('a');
  project.scenes[0]!.videoAssetId = 'b'; project.tracks![0]!.clips[0]!.assetId = 'b';
  assert.equal(replaceFinishingReference(project, { kind: 'scene', sceneId: 'scene-0', assetId: 'a' }, derivative), false);
  assert.equal(replaceFinishingReference(project, { kind: 'clip', trackId: 'visual', clipId: 'layer-a', assetId: 'a' }, derivative), false);
  project.scenes[0]!.videoAssetId = 'a'; project.scenes[0]!.clearVideoAsset = true;
  assert.equal(replaceFinishingReference(project, { kind: 'scene', sceneId: 'scene-0', assetId: 'a' }, derivative), false);
  project.tracks![0]!.clips = [];
  assert.equal(replaceFinishingReference(project, { kind: 'clip', trackId: 'visual', clipId: 'layer-a', assetId: 'a' }, derivative), false);
  assert(project.assets.some(asset => asset.id === derivative.id), 'Completed copy remains available without an unwanted live switch');
});

test('finishing creates each source once, uses its original despite an incompatible selected copy and shares the result', async () => {
  const project = fixture(), old = copy('a', 'older-copy', .7), nested = copy(old.id, 'selected-copy', .7);
  project.assets.push(old, nested); project.scenes[0]!.videoAssetId = nested.id;
  project.scenes[1]!.videoAssetId = 'a'; const calls: string[] = [];
  const result = await finishFilm(project, options({ create: async source => { calls.push(source.id); assert.equal(source.enhancement, undefined); return copy(source.id); } }));
  assert.deepEqual(calls, ['a']); assert.equal(result.total, 1); assert.equal(result.created, 1); assert.equal(result.skipped, 1);
  assert.deepEqual(selected(project), { scenes: ['a-ai', 'a-ai'], layers: ['a-ai', 'still'] });
  assert(project.assets.some(asset => asset.id === 'a')); assert(project.assets.some(asset => asset.id === old.id));
});

test('finishing reuses only usable compatible latest copies, falls back to older valid copies and creates for changed strength', async () => {
  const project = fixture(), valid = copy('a', 'valid'), unavailable = copy('a', 'missing-file'), wrong = copy('b', 'wrong-strength', .6);
  const checked: string[] = [], created: string[] = [];
  const result = await finishFilm(project, options({ latestAssets: async () => [...project.assets, valid, unavailable, wrong], usableCopy: async candidate => { checked.push(candidate.id); return candidate.id !== unavailable.id; }, create: async source => { created.push(source.id); return copy(source.id); } }));
  assert.deepEqual(checked, ['missing-file', 'valid']); assert.deepEqual(created, ['b']);
  assert.equal(result.reused, 1); assert.equal(result.created, 1); assert.equal(project.scenes[0]!.videoAssetId, valid.id);
  assert.equal(project.scenes[1]!.videoAssetId, 'b-ai');
});

test('partial failure preserves complete copies and original bindings; retry reuses completion and retries only failed source', async () => {
  const project = fixture(), saved: Asset[] = [], applied: string[] = [], updates: FinishingSummary[] = [];
  const first = await finishFilm(project, options({ latestAssets: async () => saved, create: async source => { if (source.id === 'b') throw new Error('Model failed for B'); const made = copy(source.id); saved.push(made); return made; }, apply: async (references, derivative) => { applied.push(derivative.id); return references.length; }, update: (_message, _progress, summary) => updates.push(summary) }));
  assert.equal(first.created, 1); assert.equal(first.errors, 1); assert.equal(first.applied, 2);
  assert.deepEqual(applied, ['a-ai']); assert.deepEqual(project.scenes.map(scene => scene.videoAssetId), ['a-ai', 'b']);
  assert.equal(updates[0]!.created, 0, 'Previously published summaries must remain immutable');
  const retried: string[] = [];
  const second = await finishFilm(project, options({ latestAssets: async () => saved, create: async source => { retried.push(source.id); return copy(source.id); } }));
  assert.deepEqual(retried, ['b']); assert.equal(second.reused, 1); assert.equal(second.created, 1); assert.equal(second.errors, 0);
  assert.deepEqual(project.scenes.map(scene => scene.videoAssetId), ['a-ai', 'b-ai']);
});

test('cancellation between sources keeps persisted completion, skips late live application and permits reuse on retry', async () => {
  const project = fixture(), controller = new AbortController(), saved: Asset[] = [], created: string[] = [];
  let applied = 0;
  await assert.rejects(finishFilm(project, options({ signal: controller.signal, create: async source => { created.push(source.id); const made = copy(source.id); saved.push(made); controller.abort(); return made; }, apply: async () => { applied++; return 1; } })), /cancelado/);
  assert.deepEqual(created, ['a']); assert.equal(applied, 0); assert.equal(saved.length, 1);
  const retryCalls: string[] = [];
  const result = await finishFilm(project, options({ latestAssets: async () => saved, create: async source => { retryCalls.push(source.id); return copy(source.id); } }));
  assert.deepEqual(retryCalls, ['b']); assert.equal(result.reused, 1); assert.equal(result.created, 1);
});

test('cancellation during a later source leaves earlier completion and the failed source original untouched', async () => {
  const project = fixture(), controller = new AbortController(), saved: Asset[] = [];
  await assert.rejects(finishFilm(project, options({ signal: controller.signal, create: async source => { if (source.id === 'b') { controller.abort(); throw new Error('Trabajo cancelado.'); } const made = copy(source.id); saved.push(made); return made; } })), /cancelado/);
  assert.deepEqual(project.scenes.map(scene => scene.videoAssetId), ['a-ai', 'b']);
  assert.deepEqual(saved.map(asset => asset.enhancement?.sourceAssetId), ['a']);
  assert(project.assets.some(asset => asset.id === 'a')); assert(project.assets.some(asset => asset.id === 'b'));
});

test('an all-still movie never invokes the AI engine and reports its skipped source once', async () => {
  const project = fixture(); project.scenes.forEach(scene => { delete scene.videoAssetId; }); project.tracks![0]!.clips = [project.tracks![0]!.clips[1]!];
  const before = structuredClone(project);
  const result = await finishFilm(project, options({ latestAssets: async () => assert.fail('No engine discovery for stills'), create: async () => assert.fail('No inference for stills') }));
  assert.deepEqual(project, before); assert.equal(result.total, 0); assert.equal(result.skipped, 1); assert.equal(result.created, 0);
});
