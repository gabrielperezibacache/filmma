import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedProject } from '../server/seed.js';
import type { Project } from '../src/types.js';
import { commitClipGesture, compatibleGestureTrack, createClipGesture, previewClipGesture } from '../src/clip-gestures.js';

function fixture(): Project {
  const project = createSeedProject(); project.scenes = project.scenes.slice(0, 3).map((scene, index) => ({ ...scene, id: `scene-${index}`, duration: 5 }));
  project.assets = [
    { id: 'sound', name: 'Voz.wav', type: 'audio', url: '/sound.wav', size: 123, mime: 'audio/wav' },
    { id: 'film', name: 'Toma.mp4', type: 'video', url: '/film.mp4', size: 123, mime: 'video/mp4' },
    { id: 'still', name: 'Imagen.png', type: 'image', url: '/still.png', size: 123, mime: 'image/png' },
  ];
  project.tracks = [
    { id: 'audio-1', name: 'Voz', type: 'audio', volume: 1, muted: false, clips: [{ id: 'voice', assetId: 'sound', sceneId: 'scene-0', offset: 2, duration: 4, trimStart: 3, volume: .6, fadeOut: 1 }] },
    { id: 'audio-2', name: 'Ambiente', type: 'audio', volume: .5, muted: false, clips: [{ id: 'ambient', assetId: 'sound', sceneId: 'scene-1', offset: 2, duration: 2, trimStart: 0 }] },
    { id: 'video', name: 'Capa', type: 'video', volume: 1, muted: true, clips: [{ id: 'image', assetId: 'still', sceneId: 'scene-0', offset: 4, duration: 4, trimStart: 0, opacity: .5 }] },
  ]; return project;
}

test('global movement reanchors at exact cuts, preserving source and duration at every project fps', () => {
  for (const fps of [24, 25, 30]) {
    const project = fixture(); project.fps = fps; const before = structuredClone(project);
    const snapshot = createClipGesture(project, 'audio-1', 'voice', 'move'), preview = previewClipGesture(snapshot, 3 * fps, { snap: false });
    assert.equal(preview.clip.sceneId, 'scene-1'); assert.equal(preview.clip.offset, 0); assert.equal(preview.startFrame, 5 * fps);
    assert.equal(preview.clip.duration, 4); assert.equal(preview.clip.trimStart, 3); assert.equal(preview.clip.volume, .6);
    assert.deepEqual(project, before); assert.deepEqual(snapshot.clip, before.tracks![0]!.clips[0]);
    const result = commitClipGesture(project, snapshot, preview); assert.equal(result.tracks![0]!.clips[0]!.sceneId, 'scene-1'); assert.equal(result.assets, project.assets);
  }
});

test('preview may repeat arbitrarily without writing; one final commit keeps unrelated changes', () => {
  const project = fixture(), before = structuredClone(project), snapshot = createClipGesture(project, 'audio-1', 'voice', 'move');
  let preview = previewClipGesture(snapshot, 0, { snap: false });
  for (let frame = 1; frame < 96; frame++) preview = previewClipGesture(snapshot, frame, { snap: false });
  assert.deepEqual(project, before, 'Preview/Escape/pointercancel never receive a document setter');
  project.scenes[0]!.dialogue = 'Editado durante el gesto'; project.tracks![0]!.clips[0]!.volume = .2;
  const result = commitClipGesture(project, snapshot, preview);
  assert.equal(result.scenes[0]!.dialogue, 'Editado durante el gesto'); assert.equal(result.tracks![0]!.clips[0]!.volume, .2);
  assert.equal(result.tracks![0]!.clips[0]!.offset, (2 * 24 + 95 - 5 * 24) / 24);
});

test('left trim changes the source in-point and preserves end, clamped at source zero and one frame', () => {
  const snapshot = createClipGesture(fixture(), 'audio-1', 'voice', 'trim-start');
  const right = previewClipGesture(snapshot, 24, { snap: false });
  assert.equal(right.clip.offset, 3); assert.equal(right.clip.trimStart, 4); assert.equal(right.clip.duration, 3); assert.equal(right.endFrame, snapshot.endFrame);
  const left = previewClipGesture(snapshot, -10000, { snap: false }); assert.equal(left.startFrame, 0); assert.equal(left.clip.trimStart, 1); assert.equal(left.clip.duration, 6);
  const last = previewClipGesture(snapshot, 10000, { snap: false }); assert.equal(last.clip.duration, 1 / 24); assert.equal(last.endFrame, snapshot.endFrame); assert.equal(last.clip.sceneId, 'scene-1');
  const project = fixture(); project.tracks![0]!.clips[0]!.trimStart = .5;
  const sourceBound = previewClipGesture(createClipGesture(project, 'audio-1', 'voice', 'trim-start'), -1000, { snap: false });
  assert.equal(sourceBound.startFrame, 1.5 * 24); assert.equal(sourceBound.clip.trimStart, 0);
});

test('image left trim may expand to movie start without inventing a source offset', () => {
  const snapshot = createClipGesture(fixture(), 'video', 'image', 'trim-start');
  const preview = previewClipGesture(snapshot, -96, { snap: false });
  assert.equal(preview.startFrame, 0); assert.equal(preview.clip.duration, 8); assert.equal(preview.clip.trimStart, 0); assert.equal(preview.clip.opacity, .5);
});

test('right trim preserves anchor/source, starts from the visible edge and cannot cross movie end', () => {
  const project = fixture(); project.tracks![0]!.clips[0]!.offset = 7; project.tracks![0]!.clips[0]!.duration = 20;
  const snapshot = createClipGesture(project, 'audio-1', 'voice', 'trim-end');
  const trimmed = previewClipGesture(snapshot, -24, { snap: false });
  assert.equal(trimmed.clip.sceneId, 'scene-0', 'Right trim retains the intentional anchor'); assert.equal(trimmed.clip.offset, 7); assert.equal(trimmed.clip.trimStart, 3);
  assert.equal(trimmed.endFrame, 14 * 24); assert.equal(trimmed.clip.duration, 7);
  assert.equal(previewClipGesture(snapshot, 10000, { snap: false }).endFrame, 15 * 24);
  assert.equal(previewClipGesture(snapshot, -10000, { snap: false }).clip.duration, 1 / 24);
});

test('snap finds cut, playhead and other clip edges, can use the moving end, and Alt bypasses it', () => {
  const snapshot = createClipGesture(fixture(), 'audio-1', 'voice', 'move', 11);
  assert.ok(snapshot.snapFrames.includes(11 * 24)); assert.ok(snapshot.snapFrames.includes(7 * 24)); assert.ok(snapshot.snapFrames.includes(9 * 24));
  const endSnap = previewClipGesture(snapshot, 22, { snapThresholdFrames: 3 });
  assert.equal(endSnap.startFrame, 3 * 24); assert.equal(endSnap.endFrame, 7 * 24); assert.equal(endSnap.snapFrame, 7 * 24);
  const free = previewClipGesture(snapshot, 22, { snap: false, snapThresholdFrames: 3 }); assert.equal(free.startFrame, 70); assert.equal(free.snapFrame, undefined);
  const cut = previewClipGesture(snapshot, 71, { snapThresholdFrames: 2 }); assert.equal(cut.startFrame, 5 * 24);
  const playhead = previewClipGesture(snapshot, 9 * 24 + 1, { snapThresholdFrames: 2 }); assert.equal(playhead.startFrame, 11 * 24);
});

test('drop moves between compatible tracks, preserves clips/order, and rejects incompatible destinations', () => {
  const project = fixture(), snapshot = createClipGesture(project, 'audio-1', 'voice', 'move');
  assert.equal(compatibleGestureTrack(snapshot, 'audio-2'), true); assert.equal(compatibleGestureTrack(snapshot, 'video'), false);
  const preview = previewClipGesture(snapshot, 0, { snap: false, targetTrackId: 'audio-2' }), result = commitClipGesture(project, snapshot, preview);
  assert.equal(result.tracks![0]!.clips.length, 0); assert.deepEqual(result.tracks![1]!.clips.map((clip) => clip.id), ['ambient', 'voice']);
  assert.equal(previewClipGesture(snapshot, 0, { targetTrackId: 'video' }).trackId, 'audio-1');
  assert.throws(() => commitClipGesture(project, snapshot, { ...preview, trackId: 'video' }), /no es compatible/);
});

test('stale project, changed scenes, missing tracks or changed clip timing reject commit without overwrites', () => {
  const project = fixture(), snapshot = createClipGesture(project, 'audio-1', 'voice', 'move'), preview = previewClipGesture(snapshot, 24);
  const cases = [
    { ...project, id: 'other' }, { ...project, fps: 30 },
    { ...project, scenes: [...project.scenes].reverse() }, { ...project, tracks: project.tracks!.slice(1) },
    { ...project, tracks: project.tracks!.map((track, index) => index ? track : { ...track, clips: track.clips.map((clip) => ({ ...clip, offset: 4 })) }) },
  ];
  for (const current of cases) { const before = structuredClone(current); assert.throws(() => commitClipGesture(current, snapshot, preview), /cambió durante/); assert.deepEqual(current, before); }
});

test('zero movement is an identity commit, rounding is finite and all gesture outputs obey temporal bounds', () => {
  const project = fixture(), snapshot = createClipGesture(project, 'audio-1', 'voice', 'move');
  assert.equal(commitClipGesture(project, snapshot, previewClipGesture(snapshot, 0, { snap: false })), project);
  assert.equal(previewClipGesture(snapshot, -.4, { snap: false }).startFrame, snapshot.startFrame);
  assert.equal(previewClipGesture(snapshot, NaN, { snap: false }).startFrame, snapshot.startFrame);
  for (const kind of ['move', 'trim-start', 'trim-end'] as const) for (const delta of [-1e9, -24, 0, .6, 24, 1e9]) {
    const preview = previewClipGesture(createClipGesture(project, 'audio-1', 'voice', kind), delta, { snap: false });
    assert.ok(preview.clip.offset >= 0); assert.ok(preview.clip.trimStart >= 0 && preview.clip.trimStart <= 86400); assert.ok(preview.clip.duration >= 1 / 24 && preview.clip.duration <= 86400);
    assert.ok(preview.startFrame >= 0 && preview.startFrame < snapshot.totalFrames); assert.ok(preview.endFrame > preview.startFrame);
  }
});

test('speed-aware left trims preserve exact source samples and negative animation endpoints', () => {
  for (const speed of [.25, .75, 2, 4]) {
    const project = fixture(), clip = project.tracks![0]!.clips[0]!; clip.speed = speed;
    clip.keyframes = [{ id: 'one', time: 0, x: 0, y: 0, scale: 1, opacity: 1, easing: 'ease-in-out' }, { id: 'two', time: 2, x: 60, y: 0, scale: 2, opacity: .5, easing: 'linear' }];
    const snapshot = createClipGesture(project, 'audio-1', 'voice', 'trim-start'), preview = previewClipGesture(snapshot, 1, { snap: false });
    assert.equal(preview.clip.trimStart, 3 + speed / 24);
    assert.equal(preview.clip.keyframes![0]!.time, -1 / 24);
    const result = commitClipGesture(project, snapshot, preview); assert.deepEqual(result.tracks![0]!.clips[0]!.keyframes, preview.clip.keyframes);
    const expanded = previewClipGesture(createClipGesture(result, 'audio-1', 'voice', 'trim-start'), -1, { snap: false });
    assert.equal(expanded.clip.trimStart, 3); assert.equal(expanded.clip.keyframes![0]!.time, 0);
  }
});

test('changing speed or animation during a gesture rejects a stale commit', () => {
  for (const patch of [{ speed: 2 }, { keyframes: [{ id: 'key', time: 0, x: 0, y: 0, scale: 1, opacity: .5, easing: 'linear' as const }] }]) {
    const project = fixture(), snapshot = createClipGesture(project, 'audio-1', 'voice', 'trim-start');
    Object.assign(project.tracks![0]!.clips[0]!, patch);
    assert.throws(() => commitClipGesture(project, snapshot, previewClipGesture(snapshot, 24)), /cambió durante/);
  }
});
