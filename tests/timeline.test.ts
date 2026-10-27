import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentCutFrame, buildTimeline, frameFromSeconds, frameToTimecode, segmentAtFrame, splitProjectScene, timelineDropIndex, timelineRulerTicks } from '../src/timeline.js';
import { createSeedProject } from '../server/seed.js';

function videoProject() {
  const project = createSeedProject();
  project.assets.push({ id: 'original-video', name: 'Original.mp4', type: 'video', url: '/api/media/original.mp4', mime: 'video/mp4', size: 100 });
  project.scenes[1] = { ...project.scenes[1]!, videoAssetId: 'original-video', endAssetId: 'demo-04', duration: 6, trimStart: 2.25, look: 'noir', transition: 'fade' };
  return project;
}

test('splitting video preserves source continuity and all references without duplicating assets or dialogue', () => {
  const original = videoProject(), before = structuredClone(original), shot = original.scenes[1]!;
  const divided = splitProjectScene(original, shot.id, 2.125, 'second-part');
  assert.deepEqual(original, before, 'The source project is untouched');
  assert.equal(divided.assets, original.assets); assert.equal(divided.characters, original.characters); assert.equal(divided.updatedAt, original.updatedAt);
  assert.equal(divided.scenes.length, original.scenes.length + 1);
  assert.equal(divided.scenes[0], original.scenes[0]); assert.equal(divided.scenes[3], original.scenes[2]);
  const first = divided.scenes[1]!, second = divided.scenes[2]!;
  assert.equal(first.id, shot.id); assert.equal(second.id, 'second-part'); assert.equal(second.title, shot.title + ' · continuación');
  assert.equal(first.duration, 2.125); assert.equal(second.duration, 3.875); assert.equal(first.duration + second.duration, shot.duration);
  assert.equal(first.trimStart, 2.25); assert.equal(second.trimStart, 4.375); assert.equal(second.trimStart! + second.duration, shot.trimStart! + shot.duration);
  assert.equal(first.dialogue, shot.dialogue); assert.equal(second.dialogue, '');
  for (const part of [first, second]) {
    assert.equal(part.videoAssetId, shot.videoAssetId); assert.equal(part.assetId, shot.assetId); assert.equal(part.endAssetId, shot.endAssetId);
    assert.equal(part.look, shot.look); assert.equal(part.transition, 'cut'); assert.equal(part.prompt, shot.prompt); assert.equal(part.negativePrompt, shot.negativePrompt); assert.equal(part.seed, shot.seed);
    assert.deepEqual(part.characterIds, shot.characterIds); assert.notEqual(part.characterIds, shot.characterIds);
  }
});

test('cuts and total durations use exact project frames for every supported delivery rate', () => {
  for (const fps of [24, 25, 30, 48, 50, 60] as const) {
    const project = videoProject(); project.fps = fps; project.scenes[1]!.duration = 5.013;
    const result = splitProjectScene(project, project.scenes[1]!.id, 1.117, `part-${fps}`), first = result.scenes[1]!, second = result.scenes[2]!;
    const cutFrames = Math.round(1.117 * fps), totalFrames = Math.round(5.013 * fps);
    assert.equal(first.duration, cutFrames / fps); assert.equal(second.duration, (totalFrames - cutFrames) / fps);
    assert.ok(Math.abs((first.duration + second.duration) * fps - totalFrames) < 1e-9);
    assert.equal(second.trimStart, 2.25 + cutFrames / fps);
    assert.ok(Math.abs(first.duration + second.duration - project.scenes[1]!.duration) <= 0.5 / fps + 1e-9);
  }
});

test('still images restart at zero and video without an explicit source trim starts the second part at the cut', () => {
  const still = createSeedProject(); still.scenes[0]!.trimStart = 20;
  const imageSplit = splitProjectScene(still, still.scenes[0]!.id, 2, 'image-second');
  assert.equal(imageSplit.scenes[1]!.trimStart, 0); assert.equal(imageSplit.scenes[1]!.videoAssetId, undefined); assert.equal(imageSplit.scenes[1]!.assetId, still.scenes[0]!.assetId);
  const video = videoProject(); delete video.scenes[1]!.trimStart;
  const videoSplit = splitProjectScene(video, video.scenes[1]!.id, 2, 'video-second');
  assert.equal(videoSplit.scenes[1]!.trimStart, undefined); assert.equal(videoSplit.scenes[2]!.trimStart, 2);
});

test('edge cuts, invalid positions and duplicate identities cannot create unusable shots', () => {
  const project = videoProject(), before = structuredClone(project), scene = project.scenes[1]!;
  for (const offset of [-1, 0, 0.5, 5.5, 6, 7]) assert.throws(() => splitProjectScene(project, scene.id, offset, 'new-part'), /al menos un segundo/);
  for (const offset of [NaN, Infinity, -Infinity]) assert.throws(() => splitProjectScene(project, scene.id, offset, 'new-part'), /números válidos/);
  for (const id of ['', '../invalid', scene.id, 'x'.repeat(101)]) assert.throws(() => splitProjectScene(project, scene.id, 2, id), /identificador/);
  assert.throws(() => splitProjectScene(project, 'missing', 2, 'new-part'), /No se encontró/);
  assert.throws(() => splitProjectScene({ ...project, fps: 29.97 }, scene.id, 2, 'new-part'), /24, 25, 30, 48, 50 o 60/);
  assert.deepEqual(project, before);
  const full = { ...project, scenes: Array.from({ length: 100 }, (_, index) => ({ ...scene, id: `full-${index}` })) };
  assert.throws(() => splitProjectScene(full, 'full-0', 2, 'new-part'), /100 planos/);
  project.scenes[1]!.duration = 2;
  const equal = splitProjectScene(project, scene.id, 1, 'equal-second'); assert.equal(equal.scenes[1]!.duration, 1); assert.equal(equal.scenes[2]!.duration, 1);
  project.scenes[1]!.duration = 1.5; assert.throws(() => splitProjectScene(project, scene.id, 1, 'too-short'), /al menos un segundo/);
});

test('result remains inside the scene title and trim bounds accepted by the backend', () => {
  const project = videoProject(); project.scenes[1]!.title = 'Título '.repeat(36).slice(0, 250);
  const result = splitProjectScene(project, project.scenes[1]!.id, 1, 'part'); assert.equal(result.scenes[2]!.title.length, 250); assert.match(result.scenes[2]!.title, / · continuación$/);
  project.scenes[1]!.trimStart = 86400; assert.throws(() => splitProjectScene(project, project.scenes[1]!.id, 1, 'beyond-source'), /rango permitido/);
});


test('timeline boundaries and selection use one cumulative frame model without fractional gaps', () => {
  const project = videoProject(); project.fps = 25;
  project.scenes = [1.013, 2.027, 3.009].map((duration, index) => ({ ...project.scenes[0]!, id: `fraction-${index}`, duration }));
  const layout = buildTimeline(project);
  assert.deepEqual(layout.segments.map((segment) => [segment.startFrame, segment.endFrame]), [[0, 25], [25, 76], [76, 151]]);
  assert.equal(layout.totalFrames, 151); assert.equal(layout.totalSeconds, 6.04);
  assert.equal(segmentAtFrame(layout, 24)!.scene.id, 'fraction-0');
  assert.equal(segmentAtFrame(layout, 25)!.scene.id, 'fraction-1', 'The exact cut selects the incoming shot');
  assert.equal(segmentAtFrame(layout, 151)!.scene.id, 'fraction-2', 'The end remains on the last shot');
  assert.equal(segmentAtFrame(layout, -20)!.scene.id, 'fraction-0');
  assert.equal(segmentAtFrame(buildTimeline({ ...project, scenes: [] }), 0), undefined);
});

test('frame stepping and timecodes remain exact at second, minute and hour boundaries', () => {
  for (const fps of [24, 25, 30, 48, 50, 60]) {
    for (const frame of [0, fps - 1, fps, fps * 60 - 1, fps * 3600, fps * 3600 + 2]) assert.equal(frameFromSeconds(frame / fps, fps), frame);
    assert.equal(frameToTimecode(fps - 1, fps), `00:00:00:${fps - 1}`);
    assert.equal(frameToTimecode(fps * 60, fps), '00:01:00:00');
    assert.equal(frameToTimecode(fps * 3600 + 2, fps), '01:00:00:02');
    assert.equal(frameFromSeconds(-10, fps, 100), 0); assert.equal(frameFromSeconds(20, fps, 100), 100); assert.equal(frameFromSeconds(NaN, fps, 100), 0);
  }
});

test('cut navigation moves strictly past the current cut and clamps at either end', () => {
  const layout = buildTimeline(createSeedProject());
  assert.equal(adjacentCutFrame(layout, 0, -1), 0);
  assert.equal(adjacentCutFrame(layout, 0, 1), 120);
  assert.equal(adjacentCutFrame(layout, 119, 1), 120);
  assert.equal(adjacentCutFrame(layout, 120, 1), 264);
  assert.equal(adjacentCutFrame(layout, 120, -1), 0);
  assert.equal(adjacentCutFrame(layout, 121, -1), 120);
  assert.equal(adjacentCutFrame(layout, layout.totalFrames, 1), layout.totalFrames);
});

test('drop positions resolve to final indexes on both sides of a moved clip', () => {
  const move = (source: number, target: number, after: boolean) => { const items = ['A', 'B', 'C', 'D']; const [item] = items.splice(source, 1); items.splice(timelineDropIndex(source, target, after), 0, item!); return items.join(''); };
  assert.equal(move(0, 2, false), 'BACD'); assert.equal(move(0, 2, true), 'BCAD');
  assert.equal(move(3, 1, false), 'ADBC'); assert.equal(move(3, 1, true), 'ABDC');
  assert.equal(move(1, 1, false), 'ABCD'); assert.equal(move(1, 1, true), 'ABCD');
  assert.equal(move(0, 3, true), 'BCDA'); assert.equal(move(3, 0, false), 'DABC');
});

test('ruler ticks stay legible and only cover the visible part of a long zoomed film', () => {
  const project = videoProject(); project.scenes = Array.from({ length: 100 }, (_, index) => ({ ...project.scenes[0]!, id: `long-${index}`, duration: 120 }));
  const layout = buildTimeline(project), fitScale = 600 / layout.totalSeconds;
  const fitted = timelineRulerTicks(layout, fitScale);
  assert.ok(fitted.length < 12, 'A whole-film overview does not render thousands of overlapping labels');
  const zoomed = timelineRulerTicks(layout, 192, 24000, 24000 + 3 * layout.fps);
  assert.ok(zoomed.length < 12); assert.ok(zoomed.every((tick) => tick.frame >= 23980 && tick.frame <= 24100));
  for (let index = 1; index < zoomed.length; index++) assert.ok((zoomed[index]!.frame - zoomed[index - 1]!.frame) / layout.fps * 192 >= 76);
  assert.ok(zoomed.every((tick) => Number.isInteger(tick.frame)));
});

test('split retimes later clips and cross-cut captions without changing global placement or originals', async () => {
  const { resolveTimelineClips } = await import('../src/multitrack.js');
  const { resolveSubtitleCues } = await import('../src/subtitles.js');
  const project = videoProject(), sceneId = project.scenes[1]!.id;
  project.subtitleCues = [
    { id: 'before', sceneId, start: 0, end: 1, text: 'Antes' },
    { id: 'across', sceneId, start: 1, end: 4, text: 'Cruza el corte', sourceDialogue: 'original' },
    { id: 'after', sceneId, start: 4, end: 6, text: 'Después' },
    { id: 'other', sceneId: project.scenes[2]!.id, start: 0, end: 1, text: 'Otro plano' },
  ];
  project.tracks = [{ id: 'layer', name: 'Capa', type: 'video', volume: .7, muted: true, clips: [
    { id: 'before-clip', assetId: 'original-video', sceneId, offset: 0, duration: 1, trimStart: 5 },
    { id: 'across-clip', assetId: 'original-video', sceneId, offset: 1, duration: 4, trimStart: 8, fadeIn: 2, fadeOut: 2 },
    { id: 'after-clip', assetId: 'original-video', sceneId, offset: 3, duration: 3, trimStart: 12 },
  ] }];
  const before = structuredClone(project), originalClips = resolveTimelineClips(project), originalCues = resolveSubtitleCues(project);
  const result = splitProjectScene(project, sceneId, 2, 'continuation');
  assert.deepEqual(resolveTimelineClips(result).map(({ startFrame, endFrame, sourceStartFrame, clip }) => [clip.id, startFrame, endFrame, sourceStartFrame]), originalClips.map(({ startFrame, endFrame, sourceStartFrame, clip }) => [clip.id, startFrame, endFrame, sourceStartFrame]));
  assert.equal(result.tracks![0]!.clips[1]!.sceneId, sceneId); assert.equal(result.tracks![0]!.clips[1]!.fadeIn, 2);
  assert.equal(result.tracks![0]!.clips[2]!.sceneId, 'continuation'); assert.equal(result.tracks![0]!.clips[2]!.offset, 1);
  const cues = resolveSubtitleCues(result), originalAcross = originalCues.find((item) => item.cue.id === 'across')!;
  const across = cues.filter((item) => item.cue.text === 'Cruza el corte');
  assert.equal(across.length, 2); assert.equal(across[0]!.startFrame, originalAcross.startFrame); assert.equal(across[1]!.endFrame, originalAcross.endFrame); assert.equal(across[0]!.endFrame, across[1]!.startFrame);
  assert.notEqual(across[0]!.cue.id, across[1]!.cue.id); assert.equal(across[1]!.cue.sourceDialogue, 'original');
  assert.deepEqual(cues.filter((item) => ['before', 'after', 'other'].includes(item.cue.id)).map((item) => [item.cue.id, item.startFrame, item.endFrame]), originalCues.filter((item) => item.cue.id !== 'across').map((item) => [item.cue.id, item.startFrame, item.endFrame]));
  assert.deepEqual(project, before);
});

test('split materializes every legacy caption without unexpectedly enabling burned-in subtitles', async () => {
  const { getProjectSubtitleCues, resolveSubtitleCues } = await import('../src/subtitles.js');
  const project = videoProject(); project.scenes[0]!.dialogue = 'Primer plano'; project.scenes[1]!.dialogue = 'Texto que cruza'; project.scenes[2]!.dialogue = 'Último plano';
  const before = getProjectSubtitleCues(project), result = splitProjectScene(project, project.scenes[1]!.id, 2, 'continuation');
  assert.equal(result.subtitlesEnabled, false); assert.deepEqual(resolveSubtitleCues(result), []);
  for (const cue of before.filter((item) => item.sceneId !== project.scenes[1]!.id)) assert.ok(result.subtitleCues!.some((item) => item.id === cue.id && item.text === cue.text));
  assert.equal(result.subtitleCues!.filter((cue) => cue.text === 'Texto que cruza').length, 2);
  assert.deepEqual(splitProjectScene({ ...project, subtitleCues: [] }, project.scenes[1]!.id, 2, 'empty-captions').subtitleCues, []);
});

test('split preserves mute and gain but never adds audio fades at the internal cut', () => {
  const project = videoProject(); project.scenes[1]!.audio = { muted: true, volume: .4, fadeIn: 3, fadeOut: 5 };
  const result = splitProjectScene(project, project.scenes[1]!.id, 2, 'continuation');
  assert.deepEqual(result.scenes[1]!.audio, { muted: true, volume: .4, fadeIn: 2, fadeOut: 0 });
  assert.deepEqual(result.scenes[2]!.audio, { muted: true, volume: .4, fadeIn: 0, fadeOut: 4 });
  assert.deepEqual(project.scenes[1]!.audio, { muted: true, volume: .4, fadeIn: 3, fadeOut: 5 });
});

test('split rejects attachment limits before returning a changed project', () => {
  const project = videoProject(), sceneId = project.scenes[1]!.id;
  project.subtitleCues = Array.from({ length: 1000 }, (_, index) => ({ id: `cue-${index}`, sceneId, start: index ? 0 : 1, end: index ? 1 : 3, text: 'Texto' }));
  const before = structuredClone(project); assert.throws(() => splitProjectScene(project, sceneId, 2, 'continuation'), /1.000 subtítulos/); assert.deepEqual(project, before);
  project.subtitleCues = []; project.tracks = [{ id: 'track', name: 'Capas', type: 'video', muted: true, volume: 1, clips: Array.from({ length: 501 }, (_, index) => ({ id: `clip-${index}`, sceneId, assetId: 'original-video', offset: 0, duration: 1, trimStart: 0 })) }];
  assert.throws(() => splitProjectScene(project, sceneId, 2, 'continuation'), /500 clips/);
});
