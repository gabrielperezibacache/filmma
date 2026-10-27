import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';

const execute = promisify(execFile), destination = resolve('output/qa');
const liveUrl = process.env.FILMMA_QA_URL ?? 'http://127.0.0.1:4318';
await mkdir(destination, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'filmma-ui-qa-'));
const api = await createApp({ dataDirectory: join(directory, 'data'), skipDiagnostics: true, codex: join(directory, 'codex-deliberately-unavailable'), python: join(directory, 'runtime-deliberately-unavailable') });
api.store.project.id = 'qa-isolated-project';
api.store.project.name = 'QA temporal — no es un proyecto del usuario';
api.store.project.scenes.forEach((scene) => { scene.duration = 1; });
await api.store.save();
const server = api.app.listen(0, '127.0.0.1'); await once(server, 'listening');
const target = `http://127.0.0.1:${server.address().port}`;
const forwarded = [];
// Stream actual multipart bytes; Chromium's intercepted post data omits file bodies.
const proxy = createServer((request, response) => {
  const isApi = request.url.startsWith('/api/');
  if (!isApi && !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403).end(); return; }
  const destination = new URL(request.url, isApi ? target : liveUrl);
  const entry = { method: request.method, path: request.url, target: destination.href };
  if (isApi) forwarded.push(entry);
  const headers = { ...request.headers, host: destination.host, origin: liveUrl };
  const upstream = httpRequest(destination, { method: request.method, headers }, (incoming) => {
    entry.status = incoming.statusCode; response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
  });
  upstream.on('error', (error) => { entry.error = error.message; response.writeHead(502).end(); });
  request.pipe(upstream);
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const browserUrl = `http://127.0.0.1:${proxy.address().port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'es-CL', acceptDownloads: true });
context.setDefaultTimeout(10000);
const page = await context.newPage(), checks = [], pageErrors = [];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const liveBefore = (await (await fetch('http://127.0.0.1:4318/api/bootstrap')).json()).project;
page.on('pageerror', (error) => pageErrors.push(error.message));
const check = async (name, task) => {
  if (process.env.FILMMA_QA_CHECK && !new RegExp(process.env.FILMMA_QA_CHECK, 'i').test(name)) return;
  const started = performance.now();
  try { const detail = await task(); checks.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - started), detail }); }
  catch (error) { checks.push({ name, status: 'failed', milliseconds: Math.round(performance.now() - started), error: error.message, visibleText: (await page.locator('body').innerText()).slice(-5000) }); if (await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).count()) await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click().catch(() => {}); }
  console.log(JSON.stringify(checks.at(-1)));
};
const nav = (name) => page.getByRole('navigation', { name: 'Secciones del estudio' }).getByRole('button', { name, exact: true });
const saved = async (predicate) => expect.poll(async () => predicate((await (await fetch(`${target}/api/bootstrap`)).json()).project), { timeout: 10000 }).toBeTruthy();
try {
  await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /La sala de montaje/ }).waitFor();
  await check('Six sidebar destinations render with no JavaScript errors', async () => {
    for (const [section, heading] of [['Guion', 'Primero, la historia'], ['Elementos', 'Un mundo que permanece'], ['Biblioteca', 'El material de tus historias'], ['Motores', 'La potencia, en tu Mac'], ['Actividad', 'El estudio está trabajando'], ['Estudio', 'La sala de montaje']]) {
      await nav(section).click(); await expect(page.getByRole('heading', { name: new RegExp(heading) })).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
  });
  await check('Script edits persist through autosave and reload', async () => {
    await nav('Guion').click();
    await page.getByLabel('Título', { exact: true }).fill('QA · La película persiste');
    await page.getByLabel('La historia en una frase').fill('Una restauradora devuelve la luz a una sala de cine.');
    await page.getByLabel('Acción de escena 1').fill('La puerta se abre y una franja de luz alcanza la butaca.');
    await page.getByLabel('Diálogo de escena 1').fill('ELENA: Todavía queda una historia.');
    await saved((project) => project.name === 'QA · La película persiste' && project.scenes[0].dialogue === 'ELENA: Todavía queda una historia.');
    await page.reload({ waitUntil: 'domcontentloaded' }); await nav('Guion').click();
    await expect(page.getByLabel('Título', { exact: true })).toHaveValue('QA · La película persiste');
    await expect(page.getByLabel('Acción de escena 1')).toHaveValue('La puerta se abre y una franja de luz alcanza la butaca.');
    await expect(page.getByLabel('Diálogo de escena 1')).toHaveValue('ELENA: Todavía queda una historia.');
  });
  await check('Image upload through browser preserves original and links the selected shot', async () => {
    const image = await sharp({ create: { width: 480, height: 270, channels: 3, background: '#8f583d' } }).png().toBuffer();
    const fixture = join(directory, 'qa-reference.png'); await writeFile(fixture, image);
    await nav('Biblioteca').click(); await page.locator('input[type=file][multiple]').setInputFiles(fixture);
    await expect(page.getByRole('heading', { name: 'qa-reference.png', exact: true })).toBeVisible();
    await saved((project) => project.assets.some((asset) => asset.name === 'qa-reference.png') && project.scenes[0].assetId !== 'demo-01');
    const asset = api.store.project.assets.find((item) => item.name === 'qa-reference.png');
    expect(await readFile(join(directory, 'data/media', basename(asset.url)))).toEqual(image);
    return { originalBytes: image.length, assetId: asset.id };
  });
  await check('Selected shot reorders and retains its identity after reload', async () => {
    await nav('Estudio').click();
    const first = api.store.project.scenes[0].id;
    await page.getByRole('button', { name: 'Mover plano después', exact: true }).click();
    await saved((project) => project.scenes[1].id === first);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: /La sala de montaje/ }).waitFor();
    const titles = await page.locator('.shot-card .shot-caption strong').allTextContents();
    expect(titles[0]).toBe('El ritual'); expect(titles[1]).toBe('La marquesina');
    return { order: titles };
  });
  await check('Export button produces a playable MP4 with the expected montage duration', async () => {
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByRole('button', { name: /Película MP4/ }).click();
    await expect(page.getByRole('heading', { name: /El estudio está trabajando/ })).toBeVisible();
    await expect.poll(async () => api.store.jobs.find((job) => job.type === 'export')?.status, { timeout: 90000, intervals: [250, 500, 1000] }).toBe('completed');
    const job = api.store.jobs.find((item) => item.type === 'export');
    const response = await fetch(`${target}${job.result.url}`);
    expect(response.status).toBe(200);
    const output = join(destination, 'qa-montage.mp4'); await writeFile(output, Buffer.from(await response.arrayBuffer()));
    const probe = JSON.parse((await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', output])).stdout);
    expect(Math.abs(Number(probe.format.duration) - 4)).toBeLessThan(0.15);
    const video = probe.streams.find((stream) => stream.codec_type === 'video'); expect(video.codec_name).toBe('h264'); expect(video.width).toBe(1920); expect(video.height).toBe(1080);
    await expect(page.getByRole('link', { name: 'Descargar', exact: true })).toBeVisible({ timeout: 7000 });
    return probe;
  });
  await check('Codex missing executable produces a visible recoverable failure', async () => {
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await page.getByLabel('Mensaje para Codex').fill('Describe el primer plano.');
    await page.getByRole('button', { name: 'Trabajar con Codex', exact: true }).click();
    await expect.poll(async () => api.store.jobs.find((job) => job.type === 'codex')?.status, { timeout: 10000 }).toBe('failed');
    await expect(page.locator('.codex-answer').filter({ hasText: /ENOENT|no pudo|sesión|encontr/i })).toBeVisible({ timeout: 7000 });
    await expect(page.getByLabel('Mensaje para Codex')).toBeEnabled();
    await page.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
    return { status: 'failed', message: api.store.jobs.find((job) => job.type === 'codex').message, fixtureFailure: true };
  });
  await check('Project browser creates another film and restores the prior story', async () => {
    const originalId = api.store.project.id, originalName = api.store.project.name, originalScenes = api.store.project.scenes.length;
    await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
    await page.getByLabel('Título del proyecto').fill('QA · Segunda película');
    await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
    await saved((project) => project.name === 'QA · Segunda película' && project.scenes.length === 0);
    const secondId = api.store.project.id;
    await page.getByRole('button', { name: 'Mis películas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tus películas.', exact: true })).toBeVisible();
    await page.locator('.saved-project-list button').filter({ hasText: originalName }).click();
    await saved((project) => project.id === originalId && project.scenes.length === originalScenes);
    await expect(page.getByRole('heading', { name: /La sala de montaje/ })).toBeVisible();
    const listing = (await (await fetch(`${target}/api/projects`)).json()).projects;
    expect(listing.some((project) => project.id === secondId && !project.current)).toBe(true);
    return { originalId, secondId, originalScenes };
  });
  await check('Structured Codex proposal is reviewed before appending and can be undone', async () => {
    const originalScenes = api.store.project.scenes.length;
    const scene = { ...structuredClone(api.store.project.scenes[0]), id: 'qa-proposal-scene', title: 'QA · El plano propuesto', assetId: undefined, videoAssetId: undefined };
    api.store.jobs.push({ id: 'qa-structured-proposal', type: 'codex', status: 'completed', progress: 100, message: 'Listo.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: { text: 'Propuesta de guion para verificar el flujo de revisión.', proposal: { projectId: api.store.project.id, scenes: [scene] } } });
    await api.store.save();
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await page.getByRole('button', { name: 'Revisar planos', exact: true }).click({ timeout: 7000 });
    await expect(page.getByRole('heading', { name: 'Del guion a los planos.', exact: true })).toBeVisible();
    expect(api.store.project.scenes.length).toBe(originalScenes);
    await page.getByRole('button', { name: 'Incorporar planos al guion', exact: true }).click();
    await saved((project) => project.scenes.length === originalScenes + 1 && project.scenes.at(-1).title === scene.title);
    await expect(page.getByLabel(`Título de escena ${originalScenes + 1}`)).toHaveValue(scene.title);
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    await saved((project) => project.scenes.length === originalScenes);
    await page.getByRole('button', { name: 'Cerrar asistente', exact: true }).click();
    return { reviewRequired: true, appended: 1, undone: true, fixtureProposal: true };
  });
  await check('Editing controls preserve ending frame, look and transition after reload', async () => {
    await nav('Estudio').click(); await page.locator('.shot-card').first().click();
    await page.getByLabel('Modelo para generar').selectOption('minimax-h3');
    await page.getByLabel('Fotograma final (opcional)').selectOption('demo-02');
    await page.locator('details.advanced summary').click();
    await page.getByLabel('Look de montaje').selectOption('noir');
    await page.getByLabel('Transición').selectOption('fade');
    await saved((project) => project.scenes[0].endAssetId === 'demo-02' && project.scenes[0].look === 'noir' && project.scenes[0].transition === 'fade');
    await expect(page.locator('.viewer')).toHaveClass(/look-noir/);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: /La sala de montaje/ }).waitFor();
    await page.getByLabel('Modelo para generar').selectOption('minimax-h3');
    await expect(page.getByLabel('Fotograma final (opcional)')).toHaveValue('demo-02');
    await page.locator('details.advanced summary').click();
    await expect(page.getByLabel('Look de montaje')).toHaveValue('noir'); await expect(page.getByLabel('Transición')).toHaveValue('fade');
  });
  await check('Sequence button creates one bounded job per pending shot without GPU inference', async () => {
    await nav('Estudio').click(); await page.getByLabel('Modelo para generar').selectOption('minimax-h3');
    const before = api.store.jobs.length;
    await page.getByRole('button', { name: 'Generar todos los planos pendientes', exact: true }).click();
    await expect(page.getByRole('heading', { name: /El estudio está trabajando/ })).toBeVisible();
    await expect.poll(() => api.store.jobs.filter((job) => job.type === 'generate').length).toBe(api.store.project.scenes.length);
    await expect.poll(() => api.store.jobs.filter((job) => job.type === 'generate').every((job) => job.status === 'failed')).toBe(true);
    return { jobsAdded: api.store.jobs.length - before, fixtureRuntime: true };
  });
  await check('EDL and SRT links download usable text from the export dialog', async () => {
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    const [edl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Montaje EDL', exact: true }).click()]);
    const [srt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Diálogos SRT', exact: true }).click()]);
    const edlText = await readFile(await edl.path(), 'utf8'), srtText = await readFile(await srt.path(), 'utf8');
    expect(edlText).toContain('TITLE:'); expect(edlText).toContain('FCM: NON-DROP FRAME'); expect(srtText).toContain('-->');
    await edl.saveAs(join(destination, 'qa-montage.edl')); await srt.saveAs(join(destination, 'qa-dialogues.srt'));
    await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
    return { edlName: edl.suggestedFilename(), srtName: srt.suggestedFilename(), edlBytes: Buffer.byteLength(edlText), srtBytes: Buffer.byteLength(srtText) };
  });
  await check('Project archive exports and imports through the browser as a new film', async () => {
    const original = structuredClone(api.store.project);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByRole('button', { name: /Proyecto completo/ }).click();
    await expect.poll(() => api.store.jobs.find((job) => job.type === 'export' && job.result?.filename?.endsWith('.filmma.zip'))?.status, { timeout: 10000 }).toBe('completed');
    const job = api.store.jobs.find((job) => job.type === 'export' && job.result?.filename?.endsWith('.filmma.zip'));
    const zip = join(directory, 'qa-roundtrip.filmma.zip'); await writeFile(zip, Buffer.from(await (await fetch(`${target}${job.result.url}`)).arrayBuffer()));
    await page.getByRole('button', { name: 'Mis películas', exact: true }).click();
    await page.locator('input[type=file][accept*="zip"]').setInputFiles(zip);
    await saved((project) => project.id !== original.id && project.name === original.name && project.scenes.length === original.scenes.length);
    expect(api.store.project.assets.length).toBe(original.assets.length); expect(api.store.project.scenes[0].look).toBe(original.scenes[0].look);
    await expect(page.getByRole('heading', { name: /La sala de montaje/ })).toBeVisible();
    const imported = api.store.project;
    if (original.scenes[0].endAssetId) expect(imported.scenes[0].endAssetId).not.toBe(original.scenes[0].endAssetId);
    return { originalId: original.id, importedId: imported.id, assets: imported.assets.length, scenes: imported.scenes.length };
  });
  await check('Delayed polling cannot overwrite a manually chosen clip before autosave', async () => {
    const videoPath = join(directory, 'race-fixture.mp4');
    await execute('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath]);
    const bytes = await readFile(videoPath);
    for (const key of ['a', 'b', 'c']) {
      await writeFile(join(directory, 'data/media', `race-${key}.mp4`), bytes);
      api.store.project.assets.push({ id: `race-${key}`, name: `QA clip ${key.toUpperCase()}`, type: 'video', url: `/api/media/race-${key}.mp4`, mime: 'video/mp4', size: bytes.length });
    }
    api.store.project.scenes[0].videoAssetId = 'race-a'; await api.store.save();
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: /La sala de montaje/ }).waitFor();
    let release; const gate = new Promise((resolve) => { release = resolve; }); let held = false;
    await page.route('**/api/bootstrap', async (route) => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); });
    try {
      api.store.project.scenes[0].videoAssetId = 'race-c';
      api.store.jobs.push({ id: 'qa-race-completed', type: 'generate', status: 'completed', progress: 100, message: 'Listo.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: { assetId: 'race-c' } }); await api.store.save();
      await expect.poll(() => held, { timeout: 7000 }).toBe(true);
      await nav('Biblioteca').click();
      await page.locator('.asset-card').filter({ has: page.getByRole('heading', { name: 'QA clip B', exact: true }) }).getByRole('button', { name: 'Usar en plano', exact: true }).click();
      release();
      await expect(page.locator('.viewer video')).toHaveAttribute('src', '/api/media/race-b.mp4');
      await saved((project) => project.scenes[0].videoAssetId === 'race-b');
      await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('.viewer video')).toHaveAttribute('src', '/api/media/race-b.mp4');
      return { delayedResponse: true, choicePreserved: 'race-b', generatedAssetRetained: api.store.project.assets.some((asset) => asset.id === 'race-c') };
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  });
} finally {
  const liveAfter = (await (await fetch('http://127.0.0.1:4318/api/bootstrap')).json()).project;
  const report = { date: new Date().toISOString(), isolatedStore: true, browser: 'Google Chrome headless', liveProjectBeforeHash: hash(liveBefore), liveProjectAfterHash: hash(liveAfter), liveProjectUnchanged: hash(liveBefore) === hash(liveAfter), checks, pageErrors, interceptedRequests: forwarded, note: 'An HTTP proxy streamed all browser API traffic, including binary multipart, to a temporary isolated server. No test called Codex inference; its failure fixture used a nonexistent executable.' };
  await writeFile(join(destination, process.env.FILMMA_QA_REPORT || 'functional-report.json'), JSON.stringify(report, null, 2));
  await browser.close(); proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); await api.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true });
  process.exitCode = checks.some((check) => check.status === 'failed') || pageErrors.length || !report.liveProjectUnchanged ? 1 : 0;
}
