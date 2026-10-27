import{buildGenerationInstructions}from'../src/generation-instructions.js';
import { registerDialogueRoutes } from './dialogue.js';
import {registerApplicationRoutes} from './application.js';
import {registerModelManager} from './model-manager.js';
import {registerRecoveryRoutes} from './recovery-routes.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { aiProcessingFields, defaultAiProcessing, validateAiProcessing, projectSchema, sceneSchema, validateEditingReferences, type Asset, type Job, type Project } from './types.js';
import { parseJsonOutput, runProcess } from './process.js';
import { writeZip } from './zip.js';
import { MAX_MANIFEST_BYTES, registerExtensions } from './extensions.js';
import { continuityContext, resolveSceneContinuity } from '../src/continuity.js';
import { renderProject } from './render.js';
import { createWaveformService } from './waveform.js';
import { enhanceVideo, inspectEnhancementMedia, type EnhancedMedia } from './enhance.js';
import { aiTemporalMode, aiTargetDimensions, enhancementSha256, enhanceVideoWithAi, validateAiFrameClock, type AiEnhancementDetails } from './ai-enhance.js';
import { GENERATION_MEMORY_PROFILES, generationFrames, generationSeconds, generationTimeoutMs, isSupervisedGenerationProfile, validateGenerationMemoryProfile } from './generation-limits.js';
import { exportDimensions } from '../src/export-resolution.js';
import { generationDimensions } from '../src/generation-profile.js';
import type { AiProcessingProfile } from '../src/types.js';
import { createVisualContinuityService, visualSettingsSchema } from './visual-continuity.js';
import { assetFamilyId, compatibleAiCopy, finishFilm, filmFinishingPlan, replaceFinishingReference, type FinishingReference, type FinishingSummary } from './film-finishing.js';

const root = resolve(process.env.FILMMA_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const safeFile = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/;
const allowedPorts = new Set(['5173', '4317', '4318', '4320']);
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const now = () => new Date().toISOString();
const projectFingerprint = (project: Project) => createHash('sha256').update(JSON.stringify(project)).digest('hex');

export function isLocalOrigin(origin: string) {
  try { const url = new URL(origin); return url.protocol === 'http:' && allowedHosts.has(url.hostname) && allowedPorts.has(url.port); } catch { return false; }
}

export function detectMedia(buffer: Buffer): { extension: string; mime: string; type: Asset['type'] } | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mime: 'image/png', type: 'image' };
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { extension: 'jpg', mime: 'image/jpeg', type: 'image' };
  if (buffer.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) return { extension: 'gif', mime: 'image/gif', type: 'image' };
  const riff = buffer.toString('ascii', 0, 4) === 'RIFF';
  if (riff && buffer.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp', type: 'image' };
  if (riff && buffer.toString('ascii', 8, 12) === 'WAVE') return { extension: 'wav', mime: 'audio/wav', type: 'audio' };
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (['avif', 'avis'].includes(brand)) return { extension: 'avif', mime: 'image/avif', type: 'image' };
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { extension: 'heic', mime: 'image/heic', type: 'image' };
    if (['M4A ', 'M4B '].includes(brand)) return { extension: 'm4a', mime: 'audio/mp4', type: 'audio' };
    return { extension: 'mp4', mime: 'video/mp4', type: 'video' };
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { extension: 'webm', mime: 'video/webm', type: 'video' };
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 255 && ((buffer[1] ?? 0) & 0xe0) === 0xe0)) return { extension: 'mp3', mime: 'audio/mpeg', type: 'audio' };
  if (buffer.toString('ascii', 0, 4) === 'OggS') return { extension: 'ogg', mime: 'audio/ogg', type: 'audio' };
  return undefined;
}

export type AppOptions = { dataDirectory?: string; publicDirectory?: string; distDirectory?: string; runtimePath?: string; upscalerPath?: string; continuityPath?: string; speechPath?:string; lipSyncPath?:string; qwenPath?:string; credentialsDirectory?:string; providerFetch?:typeof fetch; python?: string; codex?: string; ffmpeg?: string; ffprobe?: string; skipDiagnostics?: boolean };

export async function createApp(options: AppOptions = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.FILMMA_DATA_DIR ?? join(root, 'data'));
  const publicDirectory = resolve(options.publicDirectory ?? process.env.FILMMA_PUBLIC_DIR ?? join(root, 'public'));
  const runtimePath = resolve(options.runtimePath ?? join(root, 'runtime', 'filmma_runtime.py'));
  const upscalerPath = resolve(options.upscalerPath ?? join(root, 'runtime', 'filmma_upscale.py'));
  const continuityPath = resolve(options.continuityPath ?? join(root, 'runtime', 'filmma_continuity.py'));
  const ffmpeg = options.ffmpeg ?? process.env.FILMMA_FFMPEG ?? 'ffmpeg', ffprobe = options.ffprobe ?? process.env.FILMMA_FFPROBE ?? 'ffprobe', codex = options.codex ?? process.env.FILMMA_CODEX ?? 'codex';
  const python = options.python ?? process.env.FILMMA_PYTHON ?? 'python3';
  const store = new Store(dataDirectory);
  await store.init();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!allowedHosts.has(hostname)) return res.status(403).json({ error: 'Filmma sólo acepta conexiones locales.' });
    const origin = req.headers.origin;
    if (origin && !isLocalOrigin(origin)) return res.status(403).json({ error: 'Origen no permitido.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filmma-Client');
      return res.status(204).end();
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-filmma-client'] !== 'filmma') return res.status(403).json({ error: 'Falta la identificación local de Filmma.' });
    next();
  });
  const waveforms = createWaveformService({ getProject: () => store.project, dataDirectory, publicDirectory, ffmpeg, ffprobe });
  app.get('/api/assets/:id/waveform', waveforms.handler);
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const mediaPath = async (asset: Asset) => {
    let path: string;
    if (asset.url.startsWith('/api/media/')) path = join(dataDirectory, 'media', basename(asset.url));
    else if (asset.url.startsWith('/demo/')) path = join(publicDirectory, 'demo', basename(asset.url));
    else throw new Error(`El recurso ${asset.name} no tiene una ruta local válida.`);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('El recurso no es un archivo local regular.');
    return path;
  };

  async function previousProject(id: string): Promise<Project | undefined> {
    const files = (await readdir(join(dataDirectory, 'projects'))).filter((file) => file.startsWith(`${id}-`) && file.endsWith('.json')).sort().reverse();
    for (const file of files) {
      try {
        const path = join(dataDirectory, 'projects', file), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        const project = projectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
        if (project.id === id) return project;
      } catch { /* A damaged snapshot must not hide an older valid project. */ }
    }
    return undefined;
  }
  async function backupProject(project: Project) {
    const destination = join(dataDirectory, 'projects', `${project.id}-${Date.now()}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(project, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  }

  // In-flight generations must not replace a manual selection, including an explicit
  // unlink when the scene was already empty. Interrupted jobs do not resume after restart,
  // so these selection versions only need to live for this server process.
  const clipSelectionVersions = new Map<string, number>();
  const running = new Map<string, AbortController>();
  type QueuedTask = { job: Job; work: (signal: AbortSignal, update: (message: string, progress?: number, result?: Job['result']) => void) => Promise<Job['result']> };
  type QueueLane = 'work' | 'runtime' | 'continuity';
  const queues: Record<QueueLane, QueuedTask[]> = { work: [], runtime: [], continuity: [] };
  const working: Record<QueueLane, boolean> = { work: false, runtime: false, continuity: false };
  let closing = false;
  const flush = () => store.save().catch((error) => console.error('Filmma no pudo guardar el estado:', errorMessage(error)));
  async function drain(lane: QueueLane) {
    if (working[lane] || closing) return;
    working[lane] = true;
    const queue = queues[lane];
    try {
      while (queue.length && !closing) {
        const task = queue.shift()!;
        if (task.job.status === 'cancelled') continue;
        const controller = new AbortController(); running.set(task.job.id, controller);
        task.job.status = 'running'; task.job.progress = 2; task.job.updatedAt = now(); await store.save();
        try {
          const result = await task.work(controller.signal, (message, progress, partialResult) => {
            if (partialResult) task.job.result = { ...task.job.result, ...partialResult };
            if (controller.signal.aborted) return;
            task.job.message = message.slice(0, 2000); task.job.progress = progress == null ? task.job.progress : Math.min(99, Math.max(0, progress)); task.job.updatedAt = now(); void flush();
          });
          if (!controller.signal.aborted) { task.job.result = result; task.job.status = 'completed'; task.job.progress = 100; task.job.message = 'Listo.'; }
        } catch (error) {
          if (!controller.signal.aborted) { task.job.status = 'failed'; task.job.message = errorMessage(error).slice(0, 2500); }
        } finally {
          if (controller.signal.aborted) { task.job.status = 'cancelled'; task.job.message = 'Trabajo cancelado.'; }
          task.job.updatedAt = now(); running.delete(task.job.id); await store.save();
        }
      }
    } finally { working[lane] = false; }
  }
  async function enqueueMany(entries: { type: Job['type']; message: string; work: QueuedTask['work']; result?: Job['result'] }[]) {
    if (closing) throw Object.assign(new Error('Filmma está cerrando. Vuelve a abrirlo antes de crear trabajos.'), { status: 409 });
    if (entries.length + queues.work.length + queues.runtime.length + queues.continuity.length + running.size > 20) throw Object.assign(new Error('La secuencia supera los 20 trabajos disponibles en la cola. Espera a que termine un trabajo o genera menos planos.'), { status: 409 });
    // Reserve all slots synchronously: a batch cannot be partly accepted by another request.
    const jobs = entries.map(({ type, message, work, result }) => {
      const lane: QueueLane = type === 'runtime' ? 'runtime' : type === 'continuity' ? 'continuity' : 'work';
      const job: Job = { id: randomUUID(), type, status: 'queued', progress: 0, message, createdAt: now(), updatedAt: now(), ...(result ? { result } : {}) };
      queues[lane].push({ job, work }); return job;
    });
    store.jobs.push(...jobs); store.jobs = store.jobs.slice(-300); await store.save();
    for (const lane of ['work', 'runtime', 'continuity'] as const) setImmediate(() => void drain(lane).catch((error) => console.error('Error de cola:', errorMessage(error))));
    return jobs;
  }
  async function enqueue(type: Job['type'], message: string, work: QueuedTask['work'], result?: Job['result']) { return (await enqueueMany([{ type, message, work, result }]))[0]!; }

  const visualContinuity = createVisualContinuityService({ dataDirectory, workerPath: continuityPath, python, ffmpeg, ffprobe, mediaPath });
  const continuityProject = (projectId: string) => {
    if (projectId !== store.project.id) throw Object.assign(new Error('Abre el proyecto antes de revisar su continuidad.'), { status: 409 });
    return structuredClone(store.project);
  };
  app.get('/api/continuity', asyncRoute(async (req, res) => {
    const projectId = z.string().max(100).parse(req.query.projectId ?? store.project.id);
    const state = await visualContinuity.state(continuityProject(projectId));
    if(state.report?.status==='running'){const job=store.jobs.find(job=>job.result?.continuityReportId===state.report!.id);if(job&&(job.status==='failed'||job.status==='cancelled'))await visualContinuity.interrupt(projectId,state.report.id,job.status,job.message);}
    res.json(state);
  }));
  const pendingContinuity = new Map<string, Promise<Job>>();
  app.post('/api/continuity/analyze', asyncRoute(async (req, res) => {
    const input = z.object({ projectId: z.string().max(100), settings: visualSettingsSchema.optional() }).parse(req.body);
    const snapshot = continuityProject(input.projectId), settings = input.settings ?? await visualContinuity.settings(snapshot.id);
    const fingerprint = await visualContinuity.fingerprint(snapshot, settings), key = `${snapshot.id}:${fingerprint}`;
    const previous = store.jobs.find(job => job.type === 'continuity' && ['queued','running'].includes(job.status) && job.result?.projectId === snapshot.id && job.result?.continuityFingerprint === fingerprint);
    if (previous) return res.status(202).json({ job: previous });
    if (!pendingContinuity.has(key)) pendingContinuity.set(key, (async () => {
      const report = await visualContinuity.create(snapshot, settings);
      try { return await enqueue('continuity', 'Comparando las apariciones de personajes y objetos…', async (signal, update) => {
        await visualContinuity.execute(snapshot, report, signal, (message, progress) => update(message, progress));
        return { projectId: snapshot.id, continuityReportId: report.id, continuityFingerprint: report.fingerprint };
      }, { projectId: snapshot.id, continuityReportId: report.id, continuityFingerprint: report.fingerprint });
      } catch(error) { await visualContinuity.interrupt(snapshot.id,report.id,'failed',errorMessage(error));throw error; }
    })().finally(() => pendingContinuity.delete(key)));
    res.status(202).json({ job: await pendingContinuity.get(key) });
  }));
  app.put('/api/continuity/review', asyncRoute(async (req, res) => {
    const input = z.object({ projectId:z.string().max(100),reportId:z.string().max(100),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),comparisonId:z.string().max(100).optional(),decision:z.enum(['reviewed','intentional','pending']).optional(),note:z.string().max(2000).default('') }).parse(req.body);
    res.json({ report: await visualContinuity.review(continuityProject(input.projectId), input) });
  }));
  app.get('/api/continuity/media/:projectId/:reportId/:file', asyncRoute(async (req, res) => {
    res.sendFile(await visualContinuity.media(String(req.params.projectId), String(req.params.reportId), String(req.params.file)));
  }));

  let diagnostics: { at: number; value: any } | undefined;
  let diagnosticsPending: Promise<any> | undefined;
  async function system() {
    if (options.skipDiagnostics) return { platform: process.platform, arch: process.arch, memoryGB: Math.round(totalmem() / 2 ** 30), localOnly: false, localServerOnly: true, optionalRemoteVoices: true, ffmpeg: { available: false }, codex: { available: false, authenticated: false }, runtime: { available: false, models: [] } };
    if (diagnostics && Date.now() - diagnostics.at < 15000) return diagnostics.value;
    if (diagnosticsPending) return diagnosticsPending;
    diagnosticsPending = (async () => {
      const results = await Promise.allSettled([
        runProcess(ffmpeg, ['-version'], { timeoutMs: 5000 }),
        runProcess(codex, ['--version'], { timeoutMs: 5000 }),
        runProcess(codex, ['login', 'status'], { timeoutMs: 8000 }),
        runProcess(python, [runtimePath, 'doctor', '--json'], { cwd: root, timeoutMs: 25000 }),
      ]);
      const output = (index: number) => { const value = results[index]; return value?.status === 'fulfilled' ? value.value : undefined; };
      const ff = output(0), cx = output(1), login = output(2), runtime = output(3);
      let runtimeValue: any;
      try { runtimeValue = runtime ? parseJsonOutput(runtime.stdout) : undefined; } catch {}
      const loggedIn = !!login && login.code === 0 && /logged in|authenticated/i.test(login.stdout + login.stderr);
      const value = {
        platform: process.platform, arch: process.arch, memoryGB: Math.round(totalmem() / 2 ** 30), localOnly: false, localServerOnly: true, optionalRemoteVoices: true, dataDirectory,
        ffmpeg: { available: !!ff && ff.code === 0, version: ff?.stdout.split('\n')[0] },
        codex: { available: !!cx && cx.code === 0, authenticated: loggedIn, version: cx?.stdout.trim(), message: loggedIn ? 'Sesión de Codex CLI disponible.' : 'Abre una terminal y ejecuta codex login para conectar tu cuenta.' },
        runtime: runtimeValue ?? { available: false, models: [], message: 'El motor local todavía no está preparado.', detail: runtime?.stderr.slice(-1000) },
      };
      diagnostics = { at: Date.now(), value }; return value;
    })().finally(() => { diagnosticsPending = undefined; });
    return diagnosticsPending;
  }

  const application = await registerApplicationRoutes({app,root,dataDirectory,getJobs:()=>store.jobs});
  registerRecoveryRoutes({app,store,getJobs:()=>store.jobs,mediaPath,onRestore:()=>{clipSelectionVersions.clear()}});
  registerModelManager({app,root,dataDirectory,runtimePath,python,system,ffmpeg,ffprobe,getJobs:()=>store.jobs,enqueue,invalidate:()=>{diagnostics=undefined},savePreferences:patch=>application.preferences.update(patch)});
  app.get('/api/bootstrap', asyncRoute(async (_req, res) => {
    // Bind the hash to the returned snapshot even if diagnostics yield while
    // another request edits or switches the current project.
    const project = structuredClone(store.project), fingerprint = projectFingerprint(project);
    res.json({ project, projectFingerprint: fingerprint, jobs: store.jobs, recovery:store.recoveryStatus??null, system: await system() });
  }));
  app.get('/api/system', asyncRoute(async (_req, res) => res.json(await system())));
  app.get('/api/jobs', (_req, res) => res.json({ jobs: store.jobs }));
  app.get('/api/projects', asyncRoute(async (_req, res) => {
    const projects = new Map<string, Project>([[store.project.id, store.project]]);
    const files = (await readdir(join(dataDirectory, 'projects'))).filter((file) => file.endsWith('.json')).sort().reverse();
    for (const file of files) {
      try {
        const path = join(dataDirectory, 'projects', file), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        const project = projectSchema.parse(JSON.parse(await readFile(path, 'utf8')));
        if (!projects.has(project.id)) projects.set(project.id, project);
      } catch { /* Invalid backups are omitted, never used to overwrite the open project. */ }
    }
    const entries = [...projects.values()].map((project) => ({ id: project.id, name: project.name, logline: project.logline, updatedAt: project.updatedAt, sceneCount: project.scenes.length, assetCount: project.assets.length, current: project.id === store.project.id }));
    entries.sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt));
    res.json({ projects: entries });
  }));
  app.post('/api/projects/:id/open', asyncRoute(async (req, res) => {
    const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).parse(req.params.id);
    if (id === store.project.id) return res.json({ project: store.project });
    const project = await previousProject(id);
    if (!project) return res.status(404).json({ error: 'No se encontró un respaldo válido de ese proyecto.' });
    try { await Promise.all(project.assets.map(mediaPath)); }
    catch { return res.status(409).json({ error: 'El respaldo tiene archivos que ya no están disponibles. Se ha conservado el proyecto abierto.' }); }
    await backupProject(store.project);
    store.project = project; await store.save();
    res.json({ project: store.project });
  }));
  app.put('/api/project', asyncRoute(async (req, res) => {
    const input = projectSchema.parse(req.body);
    if (new Set(input.scenes.map((scene) => scene.id)).size !== input.scenes.length || new Set(input.characters.map((character) => character.id)).size !== input.characters.length || new Set(input.assets.map((asset) => asset.id)).size !== input.assets.length) return res.status(400).json({ error: 'Los identificadores deben ser únicos.' });
    // Asset identity and storage location are server-owned. Keep new uploads even if an older editor snapshot arrives.
    const changingProject = input.id !== store.project.id;
    const previous = changingProject ? await previousProject(input.id) : store.project;
    const known = new Map([...store.project.assets, ...(previous?.assets ?? [])].map((asset) => [asset.id, asset]));
    for (const asset of input.assets) { const existing = known.get(asset.id); if (!existing || existing.url !== asset.url || existing.type !== asset.type) return res.status(400).json({ error: 'El proyecto contiene un recurso desconocido. Importa el archivo primero.' }); }
    input.assets = (previous?.assets ?? input.assets.map((asset) => known.get(asset.id)!)).map((asset) => ({ ...asset, name: input.assets.find((item) => item.id === asset.id)?.name ?? asset.name }));
    const characters = new Set(input.characters.map((item) => item.id));
    const changedClipSelections: string[] = [];
    for (const scene of input.scenes) {
      const storedScene = previous?.scenes.find((item) => item.id === scene.id);
      if (scene.clearVideoAsset || (!scene.preserveVideoAsset && scene.videoAssetId && scene.videoAssetId !== storedScene?.videoAssetId)) changedClipSelections.push(`${input.id}:${scene.id}`);
      if (scene.clearVideoAsset) delete scene.videoAssetId;
      else if (scene.preserveVideoAsset && storedScene) {
        // A stale edit belongs to its old source. Preserve the trim and speed of
        // the newly selected/generated source along with that source identity.
        if (scene.videoAssetId !== storedScene.videoAssetId && assetFamilyId(scene.videoAssetId, [...known.values()]) !== assetFamilyId(storedScene.videoAssetId, [...known.values()])) { scene.trimStart = storedScene.trimStart; scene.speed = storedScene.speed; }
        scene.videoAssetId = storedScene.videoAssetId;
      } else if (!scene.videoAssetId && storedScene?.videoAssetId) {
        scene.videoAssetId = storedScene.videoAssetId; scene.trimStart = storedScene.trimStart; scene.speed = storedScene.speed;
      }
      delete scene.clearVideoAsset; delete scene.preserveVideoAsset;
      if (scene.characterIds.some((id) => !characters.has(id))) return res.status(400).json({ error: 'Un plano hace referencia a un personaje inexistente.' });
      if (scene.assetId && known.get(scene.assetId)?.type !== 'image') return res.status(400).json({ error: 'La referencia de un plano debe ser una imagen importada.' });
      if (scene.endAssetId && known.get(scene.endAssetId)?.type !== 'image') return res.status(400).json({ error: 'El fotograma final de un plano debe ser una imagen importada.' });
      if (scene.videoAssetId && known.get(scene.videoAssetId)?.type !== 'video') return res.status(400).json({ error: 'El clip de un plano debe ser un video importado.' });
      const selectionChanged = storedScene?.videoAssetId !== scene.videoAssetId;
      const remembered = [...(storedScene?.takeAssetIds ?? []), ...(scene.takeAssetIds ?? []), ...(selectionChanged ? [storedScene?.videoAssetId, scene.videoAssetId] : [])].filter((id): id is string => !!id);
      if (remembered.some(id => known.get(id)?.type !== 'video')) return res.status(400).json({ error: 'Una toma conservada hace referencia a un video inexistente.' });
      const takeAssetIds = [...new Set(remembered.map(id => assetFamilyId(id, [...known.values()])!))];
      if (takeAssetIds.length) scene.takeAssetIds = takeAssetIds; else delete scene.takeAssetIds;
    }
    for (const track of input.tracks ?? []) for (const clip of track.clips) {
      const storedClip = previous?.tracks?.find(item => item.id === track.id)?.clips.find(item => item.id === clip.id);
      if (clip.preserveAsset && storedClip) clip.assetId = storedClip.assetId;
      else if (storedClip && clip.assetId !== storedClip.assetId) changedClipSelections.push(`${input.id}:track:${track.id}:${clip.id}`);
      delete clip.preserveAsset;
    }
    for (const track of previous?.tracks ?? []) for (const clip of track.clips) if (!input.tracks?.find(item => item.id === track.id)?.clips.some(item => item.id === clip.id)) changedClipSelections.push(`${input.id}:track:${track.id}:${clip.id}`);
    for (const scene of previous?.scenes ?? []) if (!input.scenes.some(item => item.id === scene.id)) changedClipSelections.push(`${input.id}:${scene.id}`);
    for (const character of input.characters) if (character.assetId && known.get(character.assetId)?.type !== 'image') return res.status(400).json({ error: 'La referencia de un personaje debe ser una imagen.' });
    if (input.audioAssetId && known.get(input.audioAssetId)?.type !== 'audio') return res.status(400).json({ error: 'La banda sonora debe ser un archivo de audio importado.' });
    validateEditingReferences(input);
    if (changingProject) await backupProject(store.project);
    for (const key of changedClipSelections) clipSelectionVersions.set(key, (clipSelectionVersions.get(key) ?? 0) + 1);
    store.project = { ...input, updatedAt: now() }; await store.save(); res.json({ project: store.project });
  }));

  const upload = multer({ dest: join(dataDirectory, 'work'), limits: { fileSize: 512 * 1024 * 1024, files: 12, fields: 2 } });
  // Bind the destination before multipart parsing: switching movies during a
  // large upload must never attach the finished files to the newly opened movie.
  app.post('/api/assets', (_req, res, next) => {res.locals.uploadProjectId=store.project.id;next();}, upload.array('files', 12), asyncRoute(async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ error: 'Selecciona al menos un archivo.' });
    const createdPaths: string[] = [];
    const assets: Asset[] = [];
    const projectId=String(res.locals.uploadProjectId);
    const assertDestination=()=>{if(store.project.id!==projectId||(req.body?.projectId!==undefined&&req.body.projectId!==projectId))throw Object.assign(new Error('La película abierta cambió durante la importación. Tus originales se conservan; vuelve a importar en la película elegida.'),{status:409});};
    try {
      assertDestination();
      for (const file of files) {
        const handle = await open(file.path, 'r'); const buffer = Buffer.alloc(128); await handle.read(buffer, 0, 128, 0); await handle.close();
        const media = detectMedia(buffer);
        if (!media) throw Object.assign(new Error(`Formato no admitido: ${file.originalname}. Usa imágenes, videos o audio; los SVG no se aceptan como archivos subidos.`), { status: 400 });
        const id = randomUUID(); const filename = `${id}.${media.extension}`; const destination = join(dataDirectory, 'media', filename);
        await rename(file.path, destination); createdPaths.push(destination);
        assets.push({ id, name: basename(file.originalname).slice(0, 250), type: media.type, url: `/api/media/${filename}`, mime: media.mime, size: file.size });
      }
      assertDestination();
      const target=store.project,previousUpdatedAt=target.updatedAt;
      target.assets.push(...assets); target.updatedAt = now();
      try{await store.save();}catch(error){const createdIds=new Set(assets.map(asset=>asset.id));target.assets=target.assets.filter(asset=>!createdIds.has(asset.id));target.updatedAt=previousUpdatedAt;throw error;}
      res.status(201).json({ assets });
    } catch (error) {
      await Promise.all(createdPaths.map((path) => rm(path, { force: true })));
      throw error;
    } finally { await Promise.all(files.map((file) => rm(file.path, { force: true }))); }
  }));

  for (const [route, directory, download] of [['/api/media/:filename', 'media', false], ['/api/downloads/:filename', 'exports', true]] as const) {
    app.get(route, asyncRoute(async (req, res) => {
      const filename = String(req.params.filename);
      if (!safeFile.test(filename) || filename.includes('..')) return res.status(400).end();
      const path = join(dataDirectory, directory, filename);
      let info; try { info = await lstat(path); } catch { return res.status(404).json({ error: 'Archivo no encontrado.' }); }
      if (!info.isFile() || info.isSymbolicLink()) return res.status(404).end();
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (download) res.download(path, filename); else res.sendFile(path);
    }));
  }

  app.post('/api/jobs/:id/cancel', asyncRoute(async (req, res) => {
    const job = store.jobs.find((item) => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Trabajo no encontrado.' });
    if (job.status === 'queued' || job.status === 'running') { job.status = 'cancelled'; job.message = 'Cancelando…'; job.updatedAt = now(); running.get(job.id)?.abort(); if(job.type==='continuity'&&job.result?.projectId&&job.result.continuityReportId)await visualContinuity.interrupt(job.result.projectId,job.result.continuityReportId,'cancelled','Revisión cancelada. Las comparaciones terminadas se conservan.'); await store.save(); }
    res.json({ job });
  }));

  const modelSchema = z.enum(['minimax-h3', 'ltx-2b']);
  const modelDirectorySchema = z.string().max(1000).refine((value) => isAbsolute(value) && resolve(value) !== '/' && !value.includes('\0'), 'Indica una carpeta absoluta para los pesos.').optional();
  app.get('/api/runtime/plan', asyncRoute(async (req, res) => {
    const input = z.object({ model: modelSchema, modelDirectory: modelDirectorySchema, withReferences: z.enum(['true', 'false']).optional() }).parse(req.query);
    const args = [runtimePath, 'download-plan', '--model', input.model, '--json'];
    if (input.modelDirectory) args.push('--model-dir', input.modelDirectory);
    if (input.withReferences === 'true') args.push('--with-references');
    const result = await runProcess(python, args, { timeoutMs: 25000, cwd: root });
    const output = parseJsonOutput(result.stdout);
    if (result.code !== 0) return res.status(400).json({ error: output.message ?? 'No se pudo calcular la descarga.' });
    res.json(output);
  }));
  for (const operation of ['install', 'download'] as const) app.post(`/api/runtime/${operation}`, asyncRoute(async (req, res) => {
    const input = z.object({ model: modelSchema, modelDirectory: modelDirectorySchema, withReferences: z.boolean().default(false), acceptLicense: z.boolean().optional(), confirmDownload: z.boolean().optional() }).parse(req.body);
    if (operation === 'download' && (!input.acceptLicense || !input.confirmDownload)) return res.status(400).json({ error: 'Revisa el tamaño y la licencia del modelo y confirma la descarga.' });
    const job = await enqueue('runtime', operation === 'install' ? 'Instalando el motor local…' : 'Preparando la descarga de pesos…', async (signal, update) => {
      const args = [runtimePath, operation === 'install' ? 'install-runtime' : 'download', '--model', input.model];
      if (input.modelDirectory) args.push('--model-dir', input.modelDirectory);
      if (input.withReferences) args.push('--with-references');
      if (operation === 'download') args.push('--accept-license');
      let failure: string | undefined, final: any;
      const result = await runProcess(python, args, { cwd: root, signal, timeoutMs: 24 * 60 * 60 * 1000, onLine(line) {
        try { const event = JSON.parse(line); if (event.type === 'error') failure = event.message; if (event.type === 'result') final = event; if (event.type === 'progress') update(String(event.message ?? event.stage ?? 'Preparando…'), typeof event.progress === 'number' ? event.progress : undefined); } catch {}
      } });
      diagnostics = undefined;
      if (result.code !== 0) throw new Error(failure ?? (result.stderr.slice(-1800) || 'No se pudo preparar el modelo local.'));
      if (!final?.installed) throw new Error('El motor no confirmó la instalación. Revisa el diagnóstico local.');
      return { text: operation === 'install' ? 'Motor instalado. La descarga de los pesos se realiza por separado.' : `Pesos descargados y verificados en ${final.directory}.` };
    });
    res.status(202).json({ job });
  }));

  const generateSchema = z.object({ sceneId: z.string().max(100), model: modelSchema, memoryProfile: z.enum(GENERATION_MEMORY_PROFILES).optional(), conditioningMode: z.enum(['image', 'references', 'text']).optional(), duration: z.number().min(1).max(15).optional(), prompt: z.string().max(12000).optional(), negativePrompt: z.string().max(12000).optional(), seed: z.number().int().min(0).max(2147483647).optional(), steps: z.number().int().min(1).max(100).optional(), width: z.number().int().min(256).max(1344).multipleOf(32).optional(), height: z.number().int().min(256).max(1344).multipleOf(32).optional() });
  const guardedGenerateSchema = generateSchema.extend({ expectedProjectId: z.string().min(1).max(100).optional(), expectedProjectFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), clientRequestId: z.string().uuid().optional() });
  const unsupportedGenerationBindings = { expectedProjectId: z.never().optional(), expectedProjectFingerprint: z.never().optional(), clientRequestId: z.never().optional() };
  type GenerationInput = z.infer<typeof guardedGenerateSchema>;
  function assertExpectedGenerationProject(input: GenerationInput, project: Project) {
    const hasId = input.expectedProjectId !== undefined, hasFingerprint = input.expectedProjectFingerprint !== undefined;
    if (hasId !== hasFingerprint) throw Object.assign(new Error('Envía juntos el proyecto esperado y su huella para vincular la generación.'), { status: 400 });
    if (hasId && (input.expectedProjectId !== project.id || input.expectedProjectFingerprint !== projectFingerprint(project))) throw Object.assign(new Error('El proyecto o sus ajustes cambiaron antes de iniciar la generación. Actualiza el estado y revisa la solicitud; no se creó ningún trabajo.'), { status: 409 });
  }
  function effectiveGenerationPrompt(input: GenerationInput, snapshot: Project, scene: Project['scenes'][number], referenceCharacterIds: string[]) {
    return buildGenerationInstructions(snapshot,scene,{prompt:input.prompt,negativePrompt:input.negativePrompt,referenceCharacterIds});
  }
  async function validateGeneration(input: GenerationInput, snapshot: Project, scene: Project['scenes'][number]) {
    const invalid = (message: string) => Object.assign(new Error(`«${scene.title}»: ${message}`), { status: 400 });
    generationSeconds(input.duration, scene.duration);
    if (!(input.prompt ?? scene.prompt).trim()) throw invalid('escribe un prompt antes de generar.');
    const asset = snapshot.assets.find((item) => item.id === scene.assetId), mode = input.conditioningMode ?? (asset ? 'image' : 'text');
    const dimensions = generationDimensions(snapshot.format, input.memoryProfile === 'h3-long-ssd', 'quality', input.memoryProfile === 'h3-hd-ssd' ? 'hd720' : input.memoryProfile === 'h3-native-ssd' ? 'detail' : 'standard');
    validateGenerationMemoryProfile({ memoryProfile: input.memoryProfile, model: input.model, width: input.width ?? dimensions.width, height: input.height ?? dimensions.height, numFrames: generationFrames(generationSeconds(input.duration, scene.duration), input.model), steps: input.steps ?? (input.model === 'ltx-2b' ? 4 : 20), conditioningMode: mode, hasImageReferences: Boolean(scene.assetId || scene.endAssetId || snapshot.characters.some(item => scene.characterIds.includes(item.id) && item.locked && item.assetId)) });
    if ((input.width ?? dimensions.width) * (input.height ?? dimensions.height) > 768 * 1344) throw invalid('la resolución supera la superficie admitida de 1344 × 768.');
    const referenceIds = mode === 'references' ? snapshot.characters.filter(item => scene.characterIds.includes(item.id) && item.locked && item.assetId).map(item => item.id) : [];
    if ([...effectiveGenerationPrompt(input, snapshot, scene, referenceIds)].length > 32000) throw invalid('el prompt completo, con dirección y continuidad, supera 32.000 caracteres. Acorta las descripciones antes de generar.');
    const checkImage = async (id: string | undefined) => { const asset = snapshot.assets.find((item) => item.id === id); if (!asset || asset.type !== 'image') throw invalid('la referencia debe ser una imagen importada.'); try { await mediaPath(asset); } catch { throw invalid('no se encuentra el archivo de referencia.'); } };
    if (mode === 'image') {
      await checkImage(scene.assetId);
      if (scene.endAssetId) { if (input.model !== 'minimax-h3') throw invalid('el fotograma final requiere MiniMax H3.'); await checkImage(scene.endAssetId); }
    }
    if (mode === 'references') {
      if (input.model !== 'minimax-h3') throw invalid('las referencias de identidad requieren MiniMax H3.');
      const references = snapshot.characters.filter((item) => scene.characterIds.includes(item.id) && item.locked && item.assetId);
      if (!references.length) throw invalid('añade una imagen a un personaje u objeto fijo.');
      for (const entity of references) await checkImage(entity.assetId);
    }
  }
  function generationWork(input: GenerationInput, snapshot: Project, scene: Project['scenes'][number], takeOptions: { applySelection?: boolean; variantIndex?: number; variantCount?: number } = {}): QueuedTask['work'] {
    const selectionKey = `${snapshot.id}:${scene.id}`, selectionVersion = clipSelectionVersions.get(selectionKey) ?? 0;
    return async (signal, update) => {
      const id = randomUUID(), filename = `${id}.mp4`, outputPath = join(dataDirectory, 'media', filename);
      const workDirectory = join(dataDirectory, 'work', id); await mkdir(workDirectory, { recursive: true });
      let originalSaved = false;
      let generationLog: WriteStream | undefined, logError: Error | undefined;
      try {
        const asset = snapshot.assets.find((item) => item.id === scene.assetId);
        const dimensions = generationDimensions(snapshot.format, input.memoryProfile === 'h3-long-ssd', 'quality', input.memoryProfile === 'h3-hd-ssd' ? 'hd720' : input.memoryProfile === 'h3-native-ssd' ? 'detail' : 'standard');
        const entities = snapshot.characters.filter((item) => scene.characterIds.includes(item.id));
        const mode = input.conditioningMode ?? (asset ? 'image' : 'text');
        const references = [], referenceCharacterIds: string[] = [], referenceAssetIds: string[] = [];
        if (mode === 'references') for (const entity of entities.filter((item) => item.locked && item.assetId)) {
          const ref = snapshot.assets.find((item) => item.id === entity.assetId);
          if (ref) {
            references.push({ type: 'image', path: await mediaPath(ref) });
            // H3 assigns Picture tokens by array position; filenames carry no identity.
            referenceCharacterIds.push(entity.id); referenceAssetIds.push(ref.id);
          }
        }
        if (mode === 'image' && !asset) throw new Error('Añade una imagen de referencia al plano o selecciona generación desde texto.');
        if (mode === 'references' && input.model !== 'minimax-h3') throw new Error('Las referencias de identidad visual requieren MiniMax H3. LTX conserva las descripciones en el prompt.');
        if (mode === 'references' && !references.length) throw new Error('Añade una imagen a un personaje u objeto fijo de este plano.');
        const duration = generationSeconds(input.duration, scene.duration);
        const constraints = input.negativePrompt ?? scene.negativePrompt;
        const finalPrompt = effectiveGenerationPrompt(input, snapshot, scene, referenceCharacterIds);
        const endAsset = mode === 'image' && input.model === 'minimax-h3' ? snapshot.assets.find((item) => item.id === scene.endAssetId) : undefined;
        const request = { model: input.model, ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}), ...(input.memoryProfile ? {memoryProfile: input.memoryProfile} : {}), prompt: finalPrompt, negativePrompt: constraints, inputImage: mode === 'image' && asset ? await mediaPath(asset) : undefined, lastFrame: endAsset ? await mediaPath(endAsset) : undefined, references: mode === 'references' ? references : [], outputPath, width: input.width ?? dimensions.width, height: input.height ?? dimensions.height, numFrames: generationFrames(duration, input.model), fps: 24, seed: input.seed ?? scene.seed, steps: input.steps ?? (input.model === 'ltx-2b' ? 4 : 20) };
        if (mode === 'image' && asset) referenceAssetIds.push(asset.id);
        if (endAsset) referenceAssetIds.push(endAsset.id);
        const requestPath = join(workDirectory, 'request.json'); await writeFile(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 });
        if (isSupervisedGenerationProfile(input.memoryProfile)) {
          generationLog = createWriteStream(join(workDirectory, 'generation.jsonl'), { flags: 'ax', mode: 0o600 });
          generationLog.on('error', error => { logError = error; });
          await writeFile(join(workDirectory, 'status.json'), JSON.stringify({ status: 'running', startedAt: now(), originalAssetId: id, projectId: snapshot.id, sceneId: scene.id, maximumAdditionalRetries: 0 }), { mode: 0o600 });
        }
        let runtimeError: string | undefined;
        update(`Preparando ${request.numFrames} fotogramas continuos: ${(request.numFrames / 24).toLocaleString('es-CL', { maximumFractionDigits: 3 })} s nativos. La duración de montaje se conserva.`, 5);
        const result = await runProcess(python, [runtimePath, 'generate', '--request', requestPath], { cwd: root, signal, timeoutMs: generationTimeoutMs(input.memoryProfile), terminationGraceMs: input.memoryProfile === 'h3-hd-ssd' ? 12000 : undefined, onLine(line) {
          if (generationLog && !logError) generationLog.write(line + '\n');
          try { const event = JSON.parse(line); if (event.type === 'error') runtimeError = event.message; if (event.type === 'progress') update(String(event.message ?? event.stage ?? 'Generando…'), typeof event.progress === 'number' ? event.progress * (snapshot.aiFinishing?.enabled ? .6 : 1) : undefined); } catch {}
        } });
        if (isSupervisedGenerationProfile(input.memoryProfile)) await writeFile(join(workDirectory, 'process-result.json'), JSON.stringify({ exitCode: result.code, endedAt: now(), stderr: result.stderr, ...(logError ? { logError: logError.message } : {}) }, null, 2), { mode: 0o600 });
        if (result.code !== 0) throw new Error(runtimeError ?? (result.stderr.slice(-1800) || 'La generación local no pudo completarse.'));
        const file = await stat(outputPath).catch(() => undefined);
        if (!file?.isFile() || file.size < 100) throw new Error('El motor terminó sin producir un video válido. No se ha añadido un clip.');
        const probe = await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type,width,height,duration,avg_frame_rate,nb_frames:format=duration', '-of', 'json', outputPath], { signal, timeoutMs: 15000 });
        const verified = probe.code === 0 ? parseJsonOutput(probe.stdout) : undefined, video = verified?.streams?.[0];
        if (!video) throw new Error('El archivo producido no contiene un flujo de video verificable.');
        const actualDuration = Number(video.duration ?? verified.format?.duration), containerDuration = Number(verified.format?.duration);
        if (!Number.isFinite(actualDuration) || actualDuration <= 0 || actualDuration > 15.001 || !Number.isFinite(containerDuration) || containerDuration > 15.001) throw new Error('El motor produjo un clip fuera del límite de 15 segundos. No se ha añadido a la biblioteca.');
        if (isSupervisedGenerationProfile(request.memoryProfile)) {
          const [rateNumerator, rateDenominator = 1] = String(video.avg_frame_rate ?? '').split('/').map(Number);
          const actualFps = rateNumerator! / rateDenominator;
          if (video.width !== request.width || video.height !== request.height || Number(video.nb_frames) !== request.numFrames || !Number.isFinite(actualFps) || Math.abs(actualFps - 24) > .00001 || Math.abs(actualDuration - request.numFrames / 24) > .002) throw new Error('La toma supervisada no coincide con los fotogramas, la duración o la resolución solicitados. No se sustituye por un clip corto ni se añade al montaje.');
        }
        if (signal.aborted) throw new Error('Trabajo cancelado.');
        const generated: Asset = { id, name: `${scene.title} · ${input.model}${takeOptions.variantIndex ? ` · toma ${takeOptions.variantIndex}` : ''}`, type: 'video', url: `/api/media/${filename}`, mime: 'video/mp4', size: file.size,
          generation: { projectId: snapshot.id, sceneId: scene.id, model: request.model, seed: request.seed, prompt: request.prompt, negativePrompt: request.negativePrompt, createdAt: now(), width: request.width, height: request.height, numFrames: request.numFrames, fps: request.fps, steps: request.steps, ...(input.memoryProfile ? {memoryProfile: input.memoryProfile} : {}), conditioningMode: mode, referenceAssetIds,
            ...(scene.cinematography ? { cinematography: structuredClone(scene.cinematography) } : {}), camera: scene.camera, characterIds: [...scene.characterIds],
            continuity: Object.fromEntries(resolveSceneContinuity(snapshot, scene.id).map(({ character, state }) => [character.id, { ...state.values, intentionalChange: state.intentionalChange, changeReason: state.changeReason }])) } };
        const targetProject = await currentTarget(snapshot);
        targetProject.assets.push(generated);
        const currentScene = targetProject.scenes.find((item) => item.id === scene.id);
        if (takeOptions.applySelection !== false && currentScene && !currentScene.clearVideoAsset && currentScene.videoAssetId === scene.videoAssetId && (clipSelectionVersions.get(selectionKey) ?? 0) === selectionVersion) {
          if (currentScene.videoAssetId) currentScene.takeAssetIds = [...new Set([...(currentScene.takeAssetIds ?? []), assetFamilyId(currentScene.videoAssetId, targetProject.assets)!])];
          currentScene.videoAssetId = id; currentScene.trimStart = 0; currentScene.speed = 1;
        }
        targetProject.updatedAt = now();
        if (targetProject === store.project) await store.save(); else await backupProject(targetProject);
        originalSaved = true;
        if (isSupervisedGenerationProfile(input.memoryProfile)) await writeFile(join(workDirectory, 'status.json'), JSON.stringify({ status: 'media-verified', completedAt: now(), originalAssetId: id, outputPath, video, maximumAdditionalRetries: 0 }), { mode: 0o600 });
        const originalResult = { projectId: snapshot.id, sceneId: scene.id, seed: request.seed, ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}), ...(takeOptions.variantIndex ? { variantIndex: takeOptions.variantIndex, variantCount: takeOptions.variantCount } : {}), assetId: id, originalAssetId: id, url: generated.url };
        update('Toma original guardada.', snapshot.aiFinishing?.enabled ? 60 : 99, originalResult);
        if (snapshot.aiFinishing?.enabled) {
          const finishingSnapshot = structuredClone(targetProject);
          finishingSnapshot.scenes = [{ ...scene, videoAssetId: id, clearVideoAsset: false }]; finishingSnapshot.tracks = [];
          const selections = takeOptions.applySelection === false ? undefined : captureFinishingSelections(finishingSnapshot);
          const finishing = await prepareFilm(finishingSnapshot, snapshot.aiFinishing.strength, snapshot.aiFinishing.processingProfile ?? 'conservative', signal, (message, progress, details) => update(message, 60 + (progress ?? 0) * .39, { ...originalResult, ...details }), selections);
          if (finishing.errors) throw new Error(`La toma original está guardada, pero no se completó su mejora con IA: ${finishing.items.find(item => item.status === 'error')?.message ?? 'Reintenta el acabado de la película.'}`);
          const derivative = finishingSnapshot.assets.find(item => item.id === finishing.items.find(item => item.assetId)?.assetId);
          return { ...originalResult, assetId: derivative?.id ?? id, url: derivative?.url ?? generated.url, finishing, text: 'Toma original y versión con IA conservadas.' };
        }
        return originalResult;
      } catch (error) {
        if (isSupervisedGenerationProfile(input.memoryProfile)) {
          await writeFile(join(workDirectory, 'status.json'), JSON.stringify({ status: 'failed', completedAt: now(), error: errorMessage(error), originalSaved, maximumAdditionalRetries: 0 }), { mode: 0o600 }).catch(() => {});
          if (!originalSaved) await rename(outputPath, join(workDirectory, 'unverified-output.mp4')).catch(() => {});
        } else if (!originalSaved) await rm(outputPath, { force: true });
        throw error;
      }
      finally {
        if (generationLog && !generationLog.destroyed) await new Promise<void>(done => generationLog!.end(done));
        if (!isSupervisedGenerationProfile(input.memoryProfile)) await rm(workDirectory, { force: true, recursive: true });
      }
    };
  }
  app.post('/api/generate', asyncRoute(async (req, res) => {
    const input = guardedGenerateSchema.parse(req.body), snapshot = structuredClone(store.project);
    assertExpectedGenerationProject(input, snapshot);
    const scene = snapshot.scenes.find((item) => item.id === input.sceneId);
    if (!scene) return res.status(404).json({ error: 'Plano no encontrado.' });
    await validateGeneration(input, snapshot, scene);
    if (snapshot.aiFinishing?.enabled) await requireUpscaler(snapshot.aiFinishing.processingProfile);
    // No await between this check and enqueue's synchronous queue reservation.
    assertExpectedGenerationProject(input, store.project);
    // clientRequestId correlates an uncertain response with its job/evidence;
    // it is not an idempotency key and does not deduplicate requests.
    const job = await enqueue('generate', `Preparando «${scene.title}»…`, generationWork(input, snapshot, scene), { projectId: snapshot.id, sceneId: scene.id, seed: input.seed ?? scene.seed, ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}) });
    res.status(202).json({ job });
  }));
  const variantsSchema = generateSchema.extend({ ...unsupportedGenerationBindings, count: z.number().int().min(1).max(4) });
  app.post('/api/generate-variants', asyncRoute(async (req, res) => {
    const { count, ...params } = variantsSchema.parse(req.body), snapshot = structuredClone(store.project);
    const scene = snapshot.scenes.find(item => item.id === params.sceneId);
    if (!scene) return res.status(404).json({ error: 'Plano no encontrado.' });
    const firstSeed = params.seed ?? scene.seed;
    if (firstSeed + count - 1 > 2147483647) return res.status(400).json({ error: 'La semilla inicial no deja espacio para todas las tomas. Elige una semilla menor.' });
    if (snapshot.assets.length + count * (snapshot.aiFinishing?.enabled ? 2 : 1) > 2000) return res.status(400).json({ error: 'La biblioteca no tiene espacio para todas las tomas. Organiza el proyecto antes de continuar.' });
    const seeds = Array.from({ length: count }, (_, index) => firstSeed + index);
    // Finish all validation before reserving or starting any work in the serial lane.
    for (const seed of seeds) await validateGeneration({ ...params, seed }, snapshot, scene);
    if (snapshot.aiFinishing?.enabled) await requireUpscaler(snapshot.aiFinishing.processingProfile);
    // Retain the imported/legacy baseline as an explicit association, without
    // inventing generation metadata or changing any montage source.
    if (scene.videoAssetId) {
      const target = await currentTarget(snapshot), targetScene = target.scenes.find(item => item.id === scene.id);
      if (targetScene) {
        const baselineId = assetFamilyId(scene.videoAssetId, snapshot.assets)!;
        targetScene.takeAssetIds = [...new Set([...(targetScene.takeAssetIds ?? []), baselineId])];
        await saveTarget(target);
      }
    }
    const jobs = await enqueueMany(seeds.map((seed, index) => ({ type: 'generate' as const,
      message: `Toma ${index + 1} de ${count} · «${scene.title}»…`,
      work: generationWork({ ...params, seed }, snapshot, scene, { applySelection: false, variantIndex: index + 1, variantCount: count }),
      result: { projectId: snapshot.id, sceneId: scene.id, seed, variantIndex: index + 1, variantCount: count },
    })));
    res.status(202).json({ jobs, count, seeds });
  }));
  const sequenceSchema = generateSchema.omit({ sceneId: true, prompt: true, negativePrompt: true, seed: true }).extend({ ...unsupportedGenerationBindings, onlyMissing: z.boolean().default(true) });
  app.post('/api/generate-sequence', asyncRoute(async (req, res) => {
    const input = sequenceSchema.parse(req.body), snapshot = structuredClone(store.project);
    const scenes = snapshot.scenes.filter((scene) => !input.onlyMissing || !scene.videoAssetId);
    if (!snapshot.scenes.length) return res.status(400).json({ error: 'Añade planos al proyecto antes de generar una secuencia.' });
    if (scenes.length > 20) return res.status(400).json({ error: 'La secuencia requiere más de 20 trabajos. Genera algunos planos por separado antes de continuar.' });
    if (snapshot.aiFinishing?.enabled && scenes.length) await requireUpscaler(snapshot.aiFinishing.processingProfile);
    const entries = [];
    for (const scene of scenes) {
      const params = { ...input, sceneId: scene.id }; await validateGeneration(params, snapshot, scene);
      entries.push({ type: 'generate' as const, message: `Preparando «${scene.title}»…`, work: generationWork(params, snapshot, scene), result: { projectId: snapshot.id, sceneId: scene.id, seed: scene.seed } });
    }
    const jobs = entries.length ? await enqueueMany(entries) : [];
    res.status(jobs.length ? 202 : 200).json({ jobs, total: snapshot.scenes.length, skipped: snapshot.scenes.length - scenes.length });
  }));

  let upscalerSetup: Promise<Job> | undefined;
  let upscalerSetupJob: Job | undefined;
  const upscalerDoctor = async () => {
    const result = await runProcess(python, [upscalerPath, 'doctor', '--json'], { cwd: root, timeoutMs: 30000 });
    const status = parseJsonOutput(result.stdout);
    if (result.code !== 0 && !status.errors) throw new Error(result.stderr.slice(-1200) || 'No se pudo comprobar el motor de mejora con IA.');
    return status;
  };
  async function requireUpscaler(processingProfile: AiProcessingProfile = 'conservative') {
    const status = await upscalerDoctor();
    if (!status.ready) throw Object.assign(new Error('Prepara primero el motor de IA local desde Acabado. Los originales se conservan.'), { status: 409 });
    if (processingProfile === 'temporal' && !status.temporalAvailable) throw Object.assign(new Error('Prepara el acabado estable desde Acabado antes de procesar la película. Los otros tratamientos siguen disponibles.'), { status: 409 });
    return { ...status, profile: processingProfile, temporalMode: aiTemporalMode(processingProfile) };
  }
  const finishingSelectionKey = (projectId: string, reference: FinishingReference) => reference.kind === 'scene' ? `${projectId}:${reference.sceneId}` : `${projectId}:track:${reference.trackId}:${reference.clipId}`;
  function captureFinishingSelections(snapshot: Project) {
    return new Map(filmFinishingPlan(snapshot).sources.flatMap(entry => entry.references).map(reference => { const key = finishingSelectionKey(snapshot.id, reference); return [key, clipSelectionVersions.get(key) ?? 0]; }));
  }
  async function currentTarget(snapshot: Project) {
    const archived = store.project.id === snapshot.id ? undefined : await previousProject(snapshot.id);
    // Opening a project while its archived copy is being read must win over that
    // now-stale copy. No await occurs between this check and the caller's edits.
    return store.project.id === snapshot.id ? store.project : (archived ?? structuredClone(snapshot));
  }
  async function saveTarget(target: Project) { target.updatedAt = now(); if (target === store.project) await store.save(); else await backupProject(target); }
  registerDialogueRoutes({app,store,root,dataDirectory,python,qwenPath:resolve(options.qwenPath??join(root,'runtime','filmma_qwen_tts.py')),credentialsDirectory:options.credentialsDirectory,providerFetch:options.providerFetch,speechPath:resolve(options.speechPath??join(root,'runtime','filmma_speech.py')),lipSyncPath:resolve(options.lipSyncPath??join(root,'runtime','filmma_lipsync.py')),ffmpeg,ffprobe,mediaPath,enqueue,currentTarget,saveTarget});
  async function prepareFilm(snapshot: Project, strength: number, processingProfile: AiProcessingProfile, signal: AbortSignal, update: Parameters<QueuedTask['work']>[1], selections?: Map<string, number>) {
    const identity = await requireUpscaler(processingProfile);
    if (!identity.model || !identity.version || !/^[a-f0-9]{64}$/i.test(identity.modelSha256 ?? '')) throw new Error('El motor no confirmó la identidad del modelo de IA.');
    const summary = await finishFilm(snapshot, { identity, strength, signal,
      latestAssets: async () => (await currentTarget(snapshot)).assets,
      usableCopy: async (candidate, source) => {
        try {
          const path = await mediaPath(candidate), originalPath = await mediaPath(source);
          if ((await stat(path)).size !== candidate.size) return false;
          const output = await inspectEnhancementMedia(path, ffprobe, signal), original = await inspectEnhancementMedia(originalPath, ffprobe, signal);
          const [width, height] = aiTargetDimensions(original.width, original.height);
          if (!(output.width === width && output.height === height && output.frames === original.frames && Math.abs(output.fps - original.fps) < .00001 && Math.abs(output.duration - original.duration) < .002 && output.audio.length === original.audio.length && candidate.enhancement?.width === width && candidate.enhancement?.height === height)) return false;
          await validateAiFrameClock(originalPath, ffprobe, signal, original.frames, original.fps);
          await validateAiFrameClock(path, ffprobe, signal, output.frames, output.fps);
          for (const [index, before] of original.audio.entries()) {
            const after = output.audio[index];
            if (Number(before.channels) !== Number(after.channels) || Math.abs(Number(before.duration ?? original.duration) - Number(after.duration ?? output.duration)) > .1 || Math.abs(Number(before.start_time ?? 0) - Number(after.start_time ?? 0)) > .1) return false;
          }
          if (candidate.enhancement.sourceSha256 && candidate.enhancement.sourceSha256 !== await enhancementSha256(originalPath)) return false;
          if (candidate.enhancement.outputSha256 && candidate.enhancement.outputSha256 !== await enhancementSha256(path)) return false;
          return true;
        } catch { return false; }
      },
      create: async (source, progress) => {
        const id = randomUUID(), destination = join(dataDirectory, 'media', `${id}.mp4`);
        let saved = false;
        try {
          const metadata = await enhanceVideoWithAi({ source: await mediaPath(source), destination, workDirectory: join(dataDirectory, 'work', `ai-${id}`), strength, processingProfile, python, workerPath: upscalerPath, ffmpeg, ffprobe, signal, update: progress });
          const asset: Asset = { id, name: `${source.name} · IA 4K`, type: 'video', url: `/api/media/${id}.mp4`, mime: 'video/mp4', size: (await stat(destination)).size,
            enhancement: { sourceAssetId: source.id, preset: 'ai-4k', method: 'realesrgan-ncnn', createdAt: now(), width: metadata.width, height: metadata.height, duration: metadata.duration, fps: metadata.fps, ...metadata.ai } };
          const target = await currentTarget(snapshot);
          if (target.assets.length >= 2000) throw new Error('La biblioteca alcanzó 2000 recursos. Organiza el proyecto antes de reintentar.');
          target.assets.push(asset); await saveTarget(target); saved = true;
          return asset;
        } catch (error) { if (!saved) await rm(destination, { force: true }); throw error; }
      },
      ...(selections ? { apply: async (references: FinishingReference[], derivative: Asset) => {
        if (signal.aborted) return 0;
        const target = await currentTarget(snapshot); let applied = 0;
        for (const reference of references) {
          const key = finishingSelectionKey(snapshot.id, reference);
          if ((clipSelectionVersions.get(key) ?? 0) === selections.get(key) && replaceFinishingReference(target, reference, derivative)) applied++;
        }
        if (applied) await saveTarget(target);
        return applied;
      } } : {}),
      update: (message, progress, finishing) => update(message, progress, { projectId: snapshot.id, finishing }),
    });
    return summary;
  }
  const sequenceEnhancements = new Map<string, Promise<Job>>();
  app.post('/api/enhance-sequence', asyncRoute(async (req, res) => {
    const input = z.object({ projectId: z.string().min(1).max(100), ...aiProcessingFields }).strict().superRefine(validateAiProcessing).transform(defaultAiProcessing).parse(req.body);
    if (input.projectId !== store.project.id) return res.status(409).json({ error: 'El proyecto abierto cambió. Actualiza Filmma antes de preparar la película.' });
    const key = `${input.projectId}:${input.processingProfile}:${input.strength}`, active = sequenceEnhancements.get(key);
    if (active) { const job = await active; if (['queued', 'running'].includes(job.status)) return res.status(202).json({ job }); }
    const snapshot = structuredClone(store.project), selections = captureFinishingSelections(snapshot), plan = filmFinishingPlan(snapshot);
    const initial: FinishingSummary = { total: plan.sources.length, created: 0, reused: 0, skipped: plan.skipped.length, errors: 0, applied: 0, items: plan.skipped };
    const pending = (async () => {
      if (plan.sources.length) await requireUpscaler(input.processingProfile);
      return enqueue('enhance', 'Preparando las versiones con IA de la película…', async (signal, update) => {
        const finishing = plan.sources.length ? await prepareFilm(snapshot, input.strength, input.processingProfile, signal, update, selections) : initial;
        if (finishing.errors) throw new Error(`${finishing.errors} video(s) no pudieron mejorarse. Los originales y las copias terminadas se conservan. Reintenta para continuar.`);
        return { projectId: snapshot.id, finishing, text: `${finishing.created} versiones creadas; ${finishing.reused} reutilizadas; ${finishing.skipped} imágenes fijas conservadas.` };
      }, { projectId: snapshot.id, finishing: initial });
    })();
    sequenceEnhancements.set(key, pending);
    try { res.status(202).json({ job: await pending }); } catch (error) { if (sequenceEnhancements.get(key) === pending) sequenceEnhancements.delete(key); throw error; }
  }));
  app.get('/api/upscaler', asyncRoute(async (_req, res) => { res.json(await upscalerDoctor()); }));
  app.post('/api/upscaler/setup', asyncRoute(async (req, res) => {
    const input = z.object({temporal:z.boolean().default(false)}).strict().parse(req.body ?? {});
    if (upscalerSetup) return res.status(202).json({ job: await upscalerSetup });
    if (upscalerSetupJob && ['queued', 'running'].includes(upscalerSetupJob.status)) return res.status(202).json({ job: upscalerSetupJob });
    upscalerSetup = enqueue('enhance', 'Preparando el motor de reescalado con IA local…', async (signal, update) => {
      let setupError: string | undefined;
      const installed = await runProcess(python, [upscalerPath, 'setup', '--json', ...(input.temporal ? ['--temporal'] : [])], { cwd: root, signal, timeoutMs: 20 * 60 * 1000, onLine(line) {
        try { const event = JSON.parse(line), kind = event.event ?? event.type; if (kind === 'error') setupError = String(event.message ?? event.error); if (kind === 'progress') update(String(event.message ?? 'Preparando la IA local…'), typeof event.progress === 'number' ? event.progress : undefined); } catch {}
      } });
      if (installed.code !== 0) throw new Error(setupError || installed.stderr.slice(-1500) || 'No se pudo preparar el motor de mejora con IA.');
      const status = await upscalerDoctor();
      if (!status.ready) throw new Error(`El motor de IA todavía no está listo. ${(status.errors ?? status.missing ?? []).join(' ')}`);
      if (input.temporal && !status.temporalAvailable) throw new Error('La estabilización de detalle todavía no está preparada. Los tratamientos anteriores siguen disponibles.');
      return { text: 'Reescalado con IA local listo. Los originales se conservarán al crear cada copia.' };
    });
    try { upscalerSetupJob = await upscalerSetup; res.status(202).json({ job: upscalerSetupJob }); }
    finally { upscalerSetup = undefined; }
  }));

  app.post('/api/assets/:id/enhance', asyncRoute(async (req, res) => {
    const input = z.object({ projectId: z.string().min(1).max(100), preset: z.enum(['clean', 'upscale', 'ai-4k']), ...aiProcessingFields }).strict().superRefine(validateAiProcessing).transform(defaultAiProcessing).parse(req.body);
    if (input.projectId !== store.project.id) return res.status(409).json({ error: 'El proyecto abierto cambió. Actualiza Filmma antes de mejorar el video.' });
    const snapshot = structuredClone(store.project), requestedSource = snapshot.assets.find((asset) => asset.id === req.params.id);
    if (!requestedSource) return res.status(404).json({ error: 'El recurso no pertenece al proyecto abierto.' });
    const source = input.preset === 'ai-4k' ? snapshot.assets.find(asset => asset.id === assetFamilyId(requestedSource.id, snapshot.assets))! : requestedSource;
    if (source.type !== 'video') return res.status(415).json({ error: 'Selecciona un clip de video para mejorar su imagen.' });
    const path = await mediaPath(source);
    if (input.preset === 'ai-4k') {
      await requireUpscaler(input.processingProfile);
    }
    const job = await enqueue('enhance', `Preparando una copia mejorada de «${source.name}»…`, async (signal, update) => {
      const id = randomUUID(), filename = `${id}.mp4`, destination = join(dataDirectory, 'media', filename);
      try {
        const metadata: EnhancedMedia & { ai?: AiEnhancementDetails } = input.preset === 'ai-4k'
          ? await enhanceVideoWithAi({ source: path, destination, workDirectory: join(dataDirectory, 'work', `ai-${id}`), strength: input.strength, processingProfile: input.processingProfile, python, workerPath: upscalerPath, ffmpeg, ffprobe, signal, update })
          : await enhanceVideo({ source: path, destination, preset: input.preset, ffmpeg, ffprobe, signal, update });
        if (signal.aborted) throw new Error('Trabajo cancelado.');
        const derivative: Asset = { id, name: `${source.name} · ${input.preset === 'ai-4k' ? 'IA 4K' : input.preset === 'upscale' ? 'Ampliado' : 'Limpio'}`, type: 'video', url: `/api/media/${filename}`, mime: 'video/mp4', size: (await stat(destination)).size,
          enhancement: { sourceAssetId: source.id, preset: input.preset, method: input.preset === 'ai-4k' ? 'realesrgan-ncnn' : 'ffmpeg-lanczos', createdAt: now(), width: metadata.width, height: metadata.height, duration: metadata.duration, fps: metadata.fps, ...(metadata.ai ?? {}) } };
        const target = store.project.id === snapshot.id ? store.project : (await previousProject(snapshot.id) ?? snapshot);
        if (target.assets.length >= 2000) throw new Error('La biblioteca alcanzó 2000 recursos. Conserva la copia original y organiza el proyecto antes de reintentar.');
        target.assets.push(derivative); target.updatedAt = now();
        if (target === store.project) await store.save(); else await backupProject(target);
        return { assetId: id, url: derivative.url, text: `Copia verificada: ${metadata.width} × ${metadata.height}, ${metadata.frames} fotogramas, ${metadata.duration.toFixed(3)} s. Original conservado. ${input.preset === 'ai-4k' ? `Detalle con IA local, perfil ${input.processingProfile === 'restore' ? 'restauración con color conservado' : 'conservador'}; revisa rostro y vestuario antes de aplicar la versión.` : 'Reescalado y filtros locales; no reconstrucción mediante IA.'}` };
      } catch (error) { await rm(destination, { force: true }); throw error; }
    });
    res.status(202).json({ job });
  }));

  app.post('/api/codex', asyncRoute(async (req, res) => {
    const input = z.object({ task: z.enum(['script', 'improve-prompt', 'continuity']), prompt: z.string().max(16000), sceneId: z.string().max(100).optional() }).parse(req.body);
    const snapshot = structuredClone(store.project);
    const scene = snapshot.scenes.find((item) => item.id === input.sceneId);
    if (input.sceneId && !scene) return res.status(404).json({ error: 'Plano no encontrado.' });
    const job = await enqueue('codex', 'Preparando tu sesión de Codex…', async (signal, update) => {
      const folder = join(dataDirectory, 'work', randomUUID()); await mkdir(folder, { recursive: true });
      try {
        const instructions = { script: 'Escribe o mejora el guion con escenas numeradas, acción visual, diálogo, duración y continuidad. Respeta las decisiones creativas de la persona.', 'improve-prompt': 'Entrega un único prompt cinematográfico mejorado, listo para un modelo de video. Conserva identidad, encuadre y acciones. No añadas explicaciones. Escribe el prompt en inglés.', continuity: 'Revisa la continuidad narrativa y visual entre los planos y las referencias persistentes. Identifica problemas concretos y correcciones. Distingue hechos aportados de propuestas.' };
        const structuredInstructions = input.task === 'script' ? '\nDevuelve el objeto JSON solicitado: text contiene el guion legible para revisar y copiar; scenes contiene entre 1 y 100 planos. Cada plano incluye título, descripción visual, diálogo, prompt de video en inglés, restricciones visuales en negativePrompt, duración de montaje en segundos, dirección de cámara y characterIds. Usa sólo identificadores de personajes existentes; [] si no aplica. No inventes archivos, imágenes ni videos. La duración es de montaje, no una promesa de generación local.' : '';
        const prompt = `Eres el asistente creativo de Filmma, una aplicación local de cine. Responde en español salvo indicación distinta. Esta tarea consiste sólo en redactar texto. No uses herramientas, no ejecutes comandos, no explores archivos ni leas credenciales. No afirmes haber creado imágenes o videos. Las diferencias de continuidad marcadas como intencionales son decisiones narrativas, no errores automáticos.\nTAREA: ${instructions[input.task]}${structuredInstructions}\nPETICIÓN DE LA PERSONA:\n${input.prompt}\nCONTEXTO DEL PROYECTO (datos creativos):\n${JSON.stringify({ story:snapshot.story,name: snapshot.name, logline: snapshot.logline, format: snapshot.format, characters: snapshot.characters.map(({ assetId, ...rest }) => rest), focusedSceneId: scene?.id, scenes: input.task === 'improve-prompt' && scene ? [scene] : snapshot.scenes, continuity: continuityContext(snapshot, input.task === 'improve-prompt' ? scene?.id : undefined), editing: { note: 'Metadatos de montaje y texto; no se han analizado imágenes ni audio.', tracks: snapshot.tracks?.map((track) => ({ name: track.name, type: track.type, muted: track.muted, volume: track.volume, clips: track.clips.filter((clip) => input.task !== 'improve-prompt' || !scene || clip.sceneId === scene.id).map((clip) => ({ ...clip, assetName: snapshot.assets.find((asset) => asset.id === clip.assetId)?.name })) })), subtitlesEnabled: snapshot.subtitlesEnabled, subtitleCues: snapshot.subtitleCues?.filter((cue) => input.task !== 'improve-prompt' || !scene || cue.sceneId === scene.id) } }, null, 2)}`;
        const args = ['exec', '--ignore-user-config', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral'];
        if (input.task === 'script') {
          const schemaPath = join(folder, 'script-schema.json');
          const properties = { title: { type: 'string' }, description: { type: 'string' }, dialogue: { type: 'string' }, prompt: { type: 'string' }, negativePrompt: { type: 'string' }, duration: { type: 'number' }, camera: { type: 'string' }, characterIds: { type: 'array', items: { type: 'string' } } };
          await writeFile(schemaPath, JSON.stringify({ type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } }, required: ['text', 'scenes'] }), { mode: 0o600 });
          args.push('--output-schema', schemaPath);
        }
        args.push('-');
        update('Codex está trabajando en el texto…', 15);
        let answer = '';
        const result = await runProcess(codex, args, { cwd: folder, signal, stdin: prompt, timeoutMs: 8 * 60 * 1000, onLine(line) {
          try { const event = JSON.parse(line); const item = event.item; if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') answer = input.task === 'script' ? item.text : answer + `${answer ? '\n\n' : ''}${item.text}`; } catch {}
        } });
        if (result.code !== 0) {
          const detail = result.stderr.toLowerCase();
          const reason = /quota|usage limit|rate.?limit/.test(detail) ? 'Se alcanzó un límite de uso de la cuenta. Revisa tu cuota e inténtalo más tarde.' : /unauthorized|not logged|authentication|401/.test(detail) ? 'Revisa tu sesión de Codex e inicia sesión de nuevo si es necesario.' : 'Comprueba tu conexión, tu sesión y la disponibilidad de la cuenta.';
          throw new Error(`Codex no pudo completar la tarea. ${reason}`);
        }
        if (!answer.trim()) throw new Error('Codex terminó sin devolver texto. Comprueba la sesión de la CLI.');
        if (input.task === 'script') {
          const proposedScene = sceneSchema.omit({ id: true, seed: true, assetId: true, endAssetId: true, videoAssetId: true, clearVideoAsset: true, trimStart: true });
          const output = z.object({ text: z.string().min(1).max(100000), scenes: z.array(proposedScene).min(1).max(100) }).parse(JSON.parse(answer));
          const knownCharacters = new Set(snapshot.characters.map((character) => character.id));
          if (output.scenes.some((item) => item.characterIds.some((id) => !knownCharacters.has(id)))) throw new Error('La propuesta de Codex menciona un elemento inexistente. Reintenta indicando los elementos del proyecto.');
          return { text: output.text, proposal: { projectId: snapshot.id, scenes: output.scenes.map((item) => ({ ...item, id: randomUUID(), seed: 0 })) } };
        }
        return { text: answer.trim() };
      } catch (error) {
        if (errorMessage(error).includes('ENOENT')) throw new Error('No se encontró Codex CLI. Instálalo e inicia sesión para usar el asistente.');
        if (error instanceof SyntaxError || error instanceof z.ZodError) throw new Error('Codex devolvió una propuesta incompleta o con formato inválido. El guion actual se conserva; puedes volver a intentarlo.');
        throw error;
      } finally { await rm(folder, { recursive: true, force: true }); }
    });
    res.status(202).json({ job });
  }));

  app.post('/api/export', asyncRoute(async (req, res) => {
    const input = z.object({ format: z.enum(['mp4', 'project']), resolution: z.enum(['720p', '1080p', '2160p']).default('1080p'), aiEnhance: z.boolean().default(false), ...aiProcessingFields, requireContinuityReview:z.boolean().default(false), continuityReportId:z.string().max(100).optional(),continuityFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional() }).superRefine(validateAiProcessing).transform(defaultAiProcessing).parse(req.body);
    const snapshot = structuredClone(store.project);
    let reviewedAiAlreadyPrepared = false;
    if (input.requireContinuityReview && input.format === 'mp4' && input.resolution === '2160p') {
      await visualContinuity.requireReview(snapshot, input.continuityReportId, input.continuityFingerprint);
      if (input.aiEnhance) {
        const identity = await requireUpscaler(input.processingProfile);
        const plan = filmFinishingPlan(snapshot);
        reviewedAiAlreadyPrepared = plan.sources.every(entry => entry.references.every(reference => {
          const asset = snapshot.assets.find(item => item.id === reference.assetId);
          return asset && compatibleAiCopy(asset, entry.source, snapshot.assets, identity, input.strength);
        }));
        if (!reviewedAiAlreadyPrepared) return res.status(409).json({ error:'Prepara y usa primero las versiones IA de toda la película; después analiza esas copias. La revisión debe corresponder a las imágenes que se exportarán.' });
      }
    }
    if (input.format === 'mp4' && !snapshot.scenes.length) return res.status(400).json({ error: 'Añade al menos un plano antes de exportar.' });
    if (input.aiEnhance && (input.format !== 'mp4' || input.resolution !== '2160p')) return res.status(400).json({ error: 'La preparación con IA para exportar requiere una película MP4 en 4K UHD.' });
    if (input.aiEnhance && filmFinishingPlan(snapshot).sources.length) await requireUpscaler(input.processingProfile);
    const job = await enqueue('export', input.format === 'project' ? 'Preparando el proyecto y sus originales…' : 'Preparando el montaje…', async (signal, update) => {
      if (input.requireContinuityReview && input.format === 'mp4' && input.resolution === '2160p') {
        await visualContinuity.requireReview(await currentTarget(snapshot), input.continuityReportId, input.continuityFingerprint);
        await visualContinuity.requireReview(snapshot, input.continuityReportId, input.continuityFingerprint);
      }
      const id = randomUUID(); const filename = `${id}.${input.format === 'project' ? 'filmma.zip' : 'mp4'}`;
      const destination = join(dataDirectory, 'exports', filename);
      const workDirectory = join(dataDirectory, 'work', id); await mkdir(workDirectory, { recursive: true });
      let finishing: FinishingSummary | undefined;
      try {
        if (input.format === 'project') {
          const archiveProject = structuredClone(snapshot);
          const entries: { name: string; path?: string; data?: Buffer }[] = [];
          for (const [index, asset] of archiveProject.assets.entries()) {
            const path = await mediaPath(asset); const name = `assets/${asset.id}${extname(path)}`;
            entries.push({ name, path }); asset.url = name;
            update(`Incluyendo originales (${index + 1}/${archiveProject.assets.length})…`, 10 + index / Math.max(archiveProject.assets.length, 1) * 70);
          }
          const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, exportedAt: now(), project: archiveProject }, null, 2));
          if (manifest.length > MAX_MANIFEST_BYTES) throw new Error('El registro del proyecto supera los 64 MiB admitidos por los paquetes Filmma. El proyecto y sus originales siguen guardados localmente.');
          entries.push({ name: 'project.json', data: manifest });
          entries.push({ name: 'README.txt', data: Buffer.from('FILMMA — Proyecto y originales\nproject.json conserva guion, planos, referencias y parámetros. assets/ contiene originales sin recomprimir. Usa Importar proyecto para abrir este paquete como un proyecto nuevo.\n') });
          await writeZip(destination, entries, signal);
        } else {
          if (input.aiEnhance && !reviewedAiAlreadyPrepared) {
            const plan = filmFinishingPlan(snapshot);
            finishing = plan.sources.length ? await prepareFilm(snapshot, input.strength, input.processingProfile, signal, (message, progress, details) => update(message, (progress ?? 0) * .7, details)) : { total: 0, created: 0, reused: 0, skipped: plan.skipped.length, errors: 0, applied: 0, items: plan.skipped };
            if (finishing.errors) throw new Error(`${finishing.errors} video(s) no pudieron prepararse con IA. No se exportó la película. Las copias terminadas están guardadas para reintentar.`);
          }
          await renderProject(snapshot, { destination, workDirectory, mediaPath, ffmpeg, ffprobe, signal, update: (message, progress) => update(message, input.aiEnhance ? 70 + (progress ?? 0) * .29 : progress), resolution: input.resolution });
        }
        if (signal.aborted) throw new Error('Trabajo cancelado.');
        if (input.requireContinuityReview && input.format === 'mp4' && input.resolution === '2160p') await visualContinuity.requireReview(snapshot, input.continuityReportId, input.continuityFingerprint);
        const [width, height] = exportDimensions(snapshot.format, input.resolution);
        return { projectId: snapshot.id, url: `/api/downloads/${filename}`, filename, ...(finishing ? { finishing } : {}), ...(input.format === 'mp4' ? { resolution: input.resolution, width, height } : {}), ...(input.requireContinuityReview && input.format === 'mp4' && input.resolution === '2160p' ? { continuityReportId: input.continuityReportId, continuityFingerprint: input.continuityFingerprint } : {}) };
      } catch (error) { await rm(destination, { force: true }); throw error; }
      finally { await rm(workDirectory, { recursive: true, force: true }); }
    }, { projectId: snapshot.id });
    res.status(202).json({ job });
  }));

  registerExtensions({ app, store, dataDirectory, backupProject, detectMedia });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use('/demo', express.static(join(publicDirectory, 'demo'), { dotfiles: 'deny' }));
  const dist = resolve(options.distDirectory ?? process.env.FILMMA_DIST_DIR ?? join(root, 'dist'));
  try {
    await access(join(dist, 'index.html'));
    app.use(express.static(dist, { dotfiles: 'deny' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  } catch {}
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Revisa los datos enviados.', details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo puede tener hasta 512 MB.' : `No se pudo importar: ${error.message}` });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'JSON inválido.' });
    res.status(Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: errorMessage(error).slice(0, 2000) });
  });

  return { app, store, close: async () => {
    closing = true;
    await waveforms.close();
    for (const controller of running.values()) controller.abort();
    for (const task of [...queues.work, ...queues.runtime, ...queues.continuity]) { task.job.status = 'cancelled'; task.job.message = 'Filmma se cerró antes de iniciar este trabajo.'; }
    const deadline = Date.now() + 5000;
    while ((working.work || working.runtime || working.continuity) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    await store.save();
  } };
}
