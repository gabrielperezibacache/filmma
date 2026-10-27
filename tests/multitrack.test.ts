import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedProject } from '../server/seed.js';
import { audioGainAt, duplicateSceneAttachments, quantizeTimelineSeconds, removeSceneAttachments, resolveTimelineClips } from '../src/multitrack.js';
import type { Project } from '../src/types.js';

function fixture(): Project {
  const project = createSeedProject();
  project.scenes = project.scenes.slice(0, 3).map((scene, index) => ({ ...scene, id: `scene-${index}`, duration: index + 3 }));
  project.assets = [
    { id: 'music', name: 'Music.wav', type: 'audio', url: '/music.wav', mime: 'audio/wav', size: 100 },
    { id: 'video', name: 'Video.mp4', type: 'video', url: '/video.mp4', mime: 'video/mp4', size: 100 },
    { id: 'image', name: 'Image.png', type: 'image', url: '/image.png', mime: 'image/png', size: 100 },
  ];
  project.tracks = [
    { id: 'sound', name: 'Voz', type: 'audio', muted: false, volume: .5, clips: [{ id: 'voice', assetId: 'music', sceneId: 'scene-0', offset: 2, duration: 8, trimStart: 1.5 }] },
    { id: 'picture', name: 'Recuerdo', type: 'video', muted: true, volume: .8, clips: [{ id: 'overlay', assetId: 'video', sceneId: 'scene-1', offset: 1, duration: 20, trimStart: 3 }] },
  ];
  return project;
}

test('additional clips use exact global frames, cross scene cuts, and stop at the V1 movie end', () => {
  const project = fixture(), before = structuredClone(project), clips = resolveTimelineClips(project);
  assert.deepEqual(clips.map(({ startFrame, endFrame, sourceStartFrame, durationFrames }) => ({ startFrame, endFrame, sourceStartFrame, durationFrames })), [
    { startFrame: 48, endFrame: 240, sourceStartFrame: 36, durationFrames: 192 },
    { startFrame: 96, endFrame: 288, sourceStartFrame: 72, durationFrames: 192 },
  ]);
  assert.deepEqual(project, before, 'Resolving never shortens persisted clips or modifies originals');
  assert.equal(clips[1]!.clip.duration, 20);
  assert.equal(clips[1]!.track.muted, true, 'Muting video sound does not remove its picture');
});

test('reordering screenplay scenes moves anchored clips and keeps source in/out intact', () => {
  const project = fixture(); project.scenes = [project.scenes[2]!, project.scenes[0]!, project.scenes[1]!];
  const clips = resolveTimelineClips(project);
  assert.equal(clips[0]!.startFrame, 7 * 24); assert.equal(clips[1]!.startFrame, 9 * 24);
  assert.equal(clips[0]!.sourceStartFrame, 36); assert.equal(clips[1]!.sourceStartFrame, 72);
  assert.equal(clips[0]!.endFrame, 12 * 24); assert.equal(clips[1]!.endFrame, 12 * 24);
});

test('24, 25 and 30 fps quantize mounted timing and retain precise source offsets', () => {
  for (const fps of [24, 25, 30]) {
    const project = fixture(); project.fps = fps;
    project.tracks![0]!.clips = [{ id: 'fraction', assetId: 'music', sceneId: 'scene-1', offset: .117, duration: .041, trimStart: .061 }];
    const clip = resolveTimelineClips(project)[0]!;
    assert.equal(clip.startFrame, 3 * fps + Math.round(.117 * fps)); assert.equal(clip.durationFrames, 1); assert.equal(clip.sourceStartFrame, .061 * fps);
    assert.equal(quantizeTimelineSeconds(.117, fps), Math.round(.117 * fps) / fps);
  }
  assert.equal(quantizeTimelineSeconds(-1, 24), 0); assert.equal(quantizeTimelineSeconds(NaN, 24), 0);
});

test('invalid, missing, mistyped and fully out-of-range clips do not enter the playback plan', () => {
  const project = fixture(), good = project.tracks![0]!.clips[0]!;
  project.tracks![0]!.clips = [
    { ...good, id: 'missing-asset', assetId: 'absent' }, { ...good, id: 'missing-scene', sceneId: 'absent' },
    { ...good, id: 'wrong-type', assetId: 'video' }, { ...good, id: 'after-movie', offset: 12 },
    { ...good, id: 'zero', duration: .001 }, { ...good, id: 'negative', trimStart: -1 },
    { ...good, id: 'nonfinite', offset: NaN }, good,
  ];
  assert.deepEqual(resolveTimelineClips(project).map((item) => item.clip.id), ['voice', 'overlay']);
  assert.deepEqual(resolveTimelineClips({ ...project, scenes: [] }), []);
});

test('composition order is deterministic for overlapping videos and later tracks are on top', () => {
  const project = fixture(), visual = project.tracks![1]!;
  visual.clips.push({ ...visual.clips[0]!, id: 'image-on-video', assetId: 'image' });
  project.tracks!.push({ ...visual, id: 'top', clips: [{ ...visual.clips[0]!, id: 'top-video', muted: true, opacity: .3 }] });
  assert.deepEqual(resolveTimelineClips(project).map((item) => item.clip.id), ['voice', 'overlay', 'image-on-video', 'top-video']);
});

test('audio gain applies linear fades, inclusive start/exclusive end, and an independent track gain', () => {
  const settings = { volume: .8, fadeIn: 2, fadeOut: 4 };
  assert.equal(audioGainAt(0, 10, settings), 0); assert.equal(audioGainAt(1, 10, settings), .4);
  assert.equal(audioGainAt(2, 10, settings), .8); assert.equal(audioGainAt(6, 10, settings), .8);
  assert.equal(audioGainAt(8, 10, settings), .4); assert.equal(audioGainAt(10, 10, settings), 0);
  assert.equal(audioGainAt(8, 10, settings) * .5, .2, 'Track volume multiplies the clip envelope');
  assert.equal(audioGainAt(4, 10, { ...settings, muted: true }), 0);
  assert.equal(audioGainAt(0, 10), 1); assert.equal(audioGainAt(-.1, 10), 0); assert.equal(audioGainAt(1, 0), 0);
});

test('overlapping fades multiply, invalid values cannot leak NaN or gain outside 0..1', () => {
  assert.equal(audioGainAt(2, 4, { volume: .8, fadeIn: 4, fadeOut: 4 }), .2);
  assert.equal(audioGainAt(2, 4, { fadeIn: 20, fadeOut: 20 }), .25, 'Oversized fades clamp to the resolved clip duration');
  assert.equal(audioGainAt(1, 4, { volume: 5 }), 1); assert.equal(audioGainAt(1, 4, { volume: -1 }), 0);
  assert.equal(audioGainAt(1, 4, { volume: NaN }), 0); assert.equal(audioGainAt(NaN, 4), 0); assert.equal(audioGainAt(1, Infinity), 0);
});

test('removing a scene removes only its attachments and keeps other original files, cues and tracks', () => {
  const project = fixture(); project.subtitleCues = [
    { id: 'cue-0', sceneId: 'scene-0', start: 0, end: 1, text: 'Uno' },
    { id: 'cue-1', sceneId: 'scene-1', start: 0, end: 1, text: 'Dos' },
  ];
  const before = structuredClone(project), result = removeSceneAttachments(project, 'scene-0');
  assert.equal(result.scenes, project.scenes); assert.equal(result.assets, project.assets);
  assert.equal(result.tracks!.length, 2); assert.equal(result.tracks![0]!.clips.length, 0); assert.equal(result.tracks![1]!.clips[0]!.id, 'overlay');
  assert.deepEqual(result.subtitleCues!.map((cue) => cue.id), ['cue-1']); assert.deepEqual(project, before);
});

test('duplicating preserves anchors, settings and originals with unique attachment identities', () => {
  const project = fixture(); project.scenes.push({ ...project.scenes[0]!, id: 'copy' });
  project.subtitleCues = [{ id: 'cue', sceneId: 'scene-0', start: 0, end: 1, text: 'Texto', characterId: 'person', sourceDialogue: 'original' }];
  const before = structuredClone(project), result = duplicateSceneAttachments(project, 'scene-0', 'copy');
  assert.equal(result.assets, project.assets); assert.equal(result.scenes, project.scenes); assert.equal(result.tracks![0]!.clips.length, 2);
  const duplicate = result.tracks![0]!.clips[1]!; assert.equal(duplicate.sceneId, 'copy'); assert.notEqual(duplicate.id, 'voice'); assert.equal(duplicate.assetId, 'music'); assert.equal(duplicate.trimStart, 1.5);
  assert.equal(result.subtitleCues![1]!.sceneId, 'copy'); assert.equal(result.subtitleCues![1]!.text, 'Texto'); assert.equal(result.subtitleCues![1]!.sourceDialogue, 'original');
  const twice = duplicateSceneAttachments(result, 'scene-0', 'copy');
  assert.equal(new Set(twice.tracks![0]!.clips.map((clip) => clip.id)).size, 3); assert.equal(new Set(twice.subtitleCues!.map((cue) => cue.id)).size, 3);
  assert.deepEqual(project, before);
  delete project.subtitleCues; assert.equal(duplicateSceneAttachments(project, 'scene-0', 'copy').subtitleCues, undefined);
});

test('attachment duplication rejects clip and caption limits without mutating the project', () => {
  const project = fixture(); project.scenes.push({ ...project.scenes[0]!, id: 'copy' });
  const clip = project.tracks![0]!.clips[0]!;
  project.tracks = [{ ...project.tracks![0]!, clips: Array.from({ length: 500 }, (_, index) => ({ ...clip, id: `clip-${index}`, sceneId: index ? 'scene-1' : 'scene-0' })) }];
  const before = structuredClone(project); assert.throws(() => duplicateSceneAttachments(project, 'scene-0', 'copy'), /500 clips/); assert.deepEqual(project, before);
  project.tracks = []; project.subtitleCues = Array.from({ length: 1000 }, (_, index) => ({ id: `cue-${index}`, sceneId: index ? 'scene-1' : 'scene-0', start: 0, end: 1, text: 'Texto' }));
  assert.throws(() => duplicateSceneAttachments(project, 'scene-0', 'copy'), /1.000 subtítulos/); assert.equal(project.subtitleCues.length, 1000);
});
