import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedProject } from '../server/seed';
import type { Asset } from '../src/types';
import { buildStoryboard, collectStoryboardThumbnails, storyboardCinematography, storyboardCsv, storyboardCsvCell, storyboardDirection, storyboardEscapeHtml, storyboardHtml, storyboardImageData, storyboardSampleTime, storyboardSource } from '../src/storyboard';

test('storyboard uses the selected take or AI version and never substitutes a reference for a missing take', () => {
  const project = createSeedProject(), scene = project.scenes[0]!;
  const reference = project.assets.find(asset => asset.id === scene.assetId)!;
  const take: Asset = { id: 'actual-take', name: 'Toma elegida.mp4', type: 'video', url: '/media/actual-take.mp4', mime: 'video/mp4', size: 1000 };
  project.assets.push(take); scene.videoAssetId = take.id;
  assert.equal(storyboardSource(project, scene), take);
  scene.videoAssetId = 'missing-take';
  assert.equal(storyboardSource(project, scene), undefined);
  assert.equal(buildStoryboard(project)[0]!.sourceLabel, 'Fuente seleccionada no disponible');
  delete scene.videoAssetId;
  assert.equal(storyboardSource(project, scene), reference);
  assert.equal(buildStoryboard(project)[0]!.sourceLabel, 'Imagen de referencia en montaje');
  const audio: Asset = { ...take, id: 'audio-only', type: 'audio' }; project.assets.push(audio); scene.videoAssetId = audio.id;
  assert.equal(storyboardSource(project, scene), undefined);
});

test('sample follows the edited midpoint, trim and playback speed, and stays before source EOF', () => {
  const scene = createSeedProject().scenes[0]!;
  Object.assign(scene, { duration: 4, trimStart: 3, speed: 2 });
  assert.equal(storyboardSampleTime(scene, 24), 7);
  assert.equal(storyboardSampleTime(scene, 24, 5, 30), 5 - 1 / 30);
  Object.assign(scene, { duration: 1 / 24, trimStart: 0, speed: 1 });
  assert.equal(storyboardSampleTime(scene, 24), 0);
  Object.assign(scene, { duration: 8, trimStart: 1, speed: .25 });
  assert.equal(storyboardSampleTime(scene, 24), 2);
  assert.equal(storyboardSampleTime(scene, 24, .01), 0);
});

test('shot times share the frame grid and continuity follows actual appearances without modifying the project', () => {
  const project = createSeedProject();
  project.fps = 24; project.scenes[0]!.duration = 1.03;
  project.characters[0]!.continuity = { costume: 'Abrigo ocre', props: 'Lata metálica' };
  project.scenes[1]!.continuity = { elena: { props: 'Lata sobre la mesa', intentionalChange: true, changeReason: 'La deja en la cabina.' } };
  const before = JSON.stringify(project), shots = buildStoryboard(project);
  assert.equal(shots[0]!.duration, 25 / 24);
  assert.equal(shots[0]!.start, '00:00:00:00');
  assert.equal(shots[1]!.start, '00:00:01:01');
  assert(shots[3]!.continuity.join(' ').includes('Lata sobre la mesa'));
  assert(shots[1]!.continuity.join(' ').includes('Cambio intencional: La deja en la cabina.'));
  assert.equal(JSON.stringify(project), before);
});

test('cinematography exports human labels, preferring structured framing but retaining a free camera with only a lens setting', () => {
  const scene = createSeedProject().scenes[0]!;
  scene.camera = 'Plano general'; scene.cinematography = { lens: '85mm' };
  assert.deepEqual(storyboardCinematography(scene), ['Óptica sugerida: 85 mm · retrato']);
  assert.equal(storyboardDirection(scene)[0], 'Dirección libre: Plano general');
  scene.cinematography.framing = 'close-up';
  assert.equal(storyboardDirection(scene)[0], 'Encuadre: Primer plano');
  assert(!storyboardDirection(scene).join(' ').includes('Plano general'));
  delete scene.cinematography.framing; scene.cinematography.movement = 'locked';
  assert(!storyboardDirection(scene).join(' ').includes('Plano general'));
});

test('HTML is standalone, preserves text and embedded images, and escapes user content and untrusted image URLs', () => {
  const project = createSeedProject();
  project.name = '</title><script>alert("owned")</script>';
  project.scenes[0]!.description = 'María <entra> & dice "hola"\nSin recortar.';
  project.scenes[0]!.title = '\"><img src=x onerror=alert(1)>';
  const html = storyboardHtml(project, {
    [project.scenes[0]!.id]: { status: 'ready', dataUrl: 'data:image/jpeg;base64,AAAA', sourceTime: 2 },
    [project.scenes[1]!.id]: { status: 'ready', dataUrl: 'https://example.com/track.png' },
    [project.scenes[2]!.id]: { status: 'failed', message: '<script>missing</script>' },
  });
  assert.match(html, /data:image\/jpeg;base64,AAAA/);
  assert.doesNotMatch(html, /<script|onerror=alert\(1\)>|https:\/\/example.com/);
  assert.match(html, /María &lt;entra&gt; &amp; dice &quot;hola&quot;\nSin recortar\./);
  assert.match(html, /&lt;script&gt;missing&lt;\/script&gt;/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /guardar.*PDF/);
  assert.equal(storyboardEscapeHtml("'&<>\""), '&#39;&amp;&lt;&gt;&quot;');
  assert.equal(storyboardImageData({ status: 'ready', dataUrl: 'data:image/svg+xml;base64,AAAA' }), undefined);
});

test('CSV quotes multiline cells and neutralizes spreadsheet formulas even after leading whitespace', () => {
  assert.equal(storyboardCsvCell('Ella dice "sí", luego sale\nCorte.'), '"Ella dice ""sí"", luego sale\nCorte."');
  for (const value of ['=HYPERLINK("x")', ' +2+2', '\t@SUM(1)', '-1+2', '\ntexto']) assert(storyboardCsvCell(value).startsWith('"\''));
  const project = createSeedProject(); project.scenes[0]!.title = '=1+1';
  const csv = storyboardCsv(project);
  assert(csv.startsWith('\uFEFF"Plano","Título"'));
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"Continuidad"/);
  assert.equal(csv.split('\r\n').length, project.scenes.length + 2);
});

test('thumbnail decoding runs one source at a time; a failure is explicit and never falls back to a different image', async () => {
  const shots = buildStoryboard(createSeedProject()), controller = new AbortController(), seen: string[] = [];
  let active = 0, peak = 0;
  const results = await collectStoryboardThumbnails(shots, async shot => {
    active++; peak = Math.max(peak, active); seen.push(shot.source!.id);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    if (shot.index === 1) throw new Error('La toma no se pudo leer');
    return { status: 'ready', dataUrl: 'data:image/jpeg;base64,AAAA' };
  }, controller.signal);
  assert.equal(peak, 1);
  assert.deepEqual(seen, shots.map(shot => shot.source!.id));
  assert.deepEqual(results[shots[1]!.scene.id], { status: 'failed', message: 'La toma no se pudo leer' });
  assert.equal(results[shots[2]!.scene.id]!.status, 'ready');
});

test('aborting a stale project prevents old results from publishing and stops further decoding', async () => {
  const shots = buildStoryboard(createSeedProject()), controller = new AbortController(), updates: string[] = [];
  let calls = 0;
  const result = await collectStoryboardThumbnails(shots, async () => {
    calls++; controller.abort(); return { status: 'ready', dataUrl: 'data:image/jpeg;base64,AAAA' };
  }, controller.signal, id => updates.push(id));
  assert.equal(calls, 1); assert.deepEqual(updates, []); assert.deepEqual(result, {});
});

test('missing selected source is reported without invoking the decoder', async () => {
  const project = createSeedProject(); project.scenes = [project.scenes[0]!]; project.scenes[0]!.videoAssetId = 'removed';
  const result = await collectStoryboardThumbnails(buildStoryboard(project), async () => { throw new Error('Decoder must not run'); }, new AbortController().signal);
  assert.deepEqual(result[project.scenes[0]!.id], { status: 'failed', message: 'Fuente seleccionada no disponible' });
});
