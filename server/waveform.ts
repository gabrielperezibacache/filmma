import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RequestHandler } from 'express';
import type { Asset, Project } from './types.js';
import { parseJsonOutput, runProcess } from './process.js';

const VERSION = 1;
const BINS = 2048;
const MAX_DURATION = 2 * 60 * 60;
const MAX_CHANNELS = 8;
const MAX_RATE = 192000;
const MAX_PCM_BYTES = 8 * 1024 ** 3;
const MAX_CACHE_BYTES = 128 * 1024;
const MAX_PENDING = 24;
const cacheName = /^wave-[a-f0-9]{64}\.json$/;
const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
const abortError = () => fail('La lectura de la forma de onda se canceló.', 499);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Uniform source-time bins of max(abs(decoded PCM)) across ALL channels.
 * Values use digital full scale, never per-file loudness normalization. */
export type Waveform = {
  assetId: string; duration: number; sampleRate: number; channels: number;
  hasAudio: boolean; peaks: number[]; sourceVersion: string; cached: boolean;
};
export type WaveformOptions = {
  getProject: () => Pick<Project, 'assets'>;
  dataDirectory: string; publicDirectory: string;
  ffmpeg?: string; ffprobe?: string; timeoutMs?: number;
};
type Source = { asset: Asset; path: string; version: string; cachePath: string };
type Task = { key: string; controller: AbortController; promise: Promise<Waveform>; resolve: (value: Waveform) => void; reject: (error: unknown) => void; source: Source; subscribers: number };

/** Streaming PCM extraction keeps only one small pipe chunk and the peak array.
 * Channel preservation avoids hiding anti-phase stereo content through downmix. */
async function decodePeaks(command: string, source: string, duration: number, sampleRate: number, channels: number, signal: AbortSignal, timeoutMs: number) {
  const sampleFrames = Math.ceil(duration * sampleRate), peaks = new Float64Array(Math.min(BINS, sampleFrames));
  return new Promise<number[]>((resolveResult, reject) => {
    if (signal.aborted) return reject(abortError());
    const child = spawn(command, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-max_alloc', '134217728', '-threads', '1', '-filter_threads', '1', '-i', source, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', `aresample=${sampleRate}:async=1:first_pts=0`, '-ar', String(sampleRate), '-ac', String(channels), '-t', String(duration), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], { shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', carry = Buffer.alloc(0), frame = 0, bytes = 0, failure: Error | undefined, settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
      if (!killTimer) killTimer = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 2500);
      killTimer.unref();
    };
    const abort = () => { failure = abortError(); terminate(); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = fail(`El análisis de audio superó los ${Math.ceil(timeoutMs / 1000)} segundos. Prueba con un fragmento más corto.`, 504); terminate(); }, timeoutMs); timer.unref();
    const finish = (error?: Error, code?: number | null) => {
      if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', abort);
      if (error || failure) return reject(error ?? failure);
      if (code !== 0) return reject(fail(`No se pudo analizar el audio original: ${stderr.slice(-1000) || 'FFmpeg terminó sin completar la lectura.'}`));
      if (!frame || carry.length) return reject(fail('El recurso declara audio, pero no contiene muestras de audio válidas.'));
      resolveResult(Array.from(peaks, (peak) => Math.round(Math.min(1, peak) * 1e6) / 1e6));
    };
    child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT' ? fail('No se encontró FFmpeg para analizar el audio.', 503) : error));
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > MAX_PCM_BYTES || bytes > (sampleFrames + sampleRate) * channels * 4) { failure = fail('La cantidad de audio decodificado supera el límite de análisis.'); terminate(); return; }
      const buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk, stride = channels * 4, usable = buffer.length - buffer.length % stride;
      for (let offset = 0; offset < usable; offset += stride, frame++) {
        let peak = 0;
        for (let channel = 0; channel < channels; channel++) {
          const value = Math.abs(buffer.readFloatLE(offset + channel * 4));
          if (!Number.isFinite(value)) { failure = fail('El audio contiene muestras no válidas.'); terminate(); return; }
          if (value > peak) peak = value;
        }
        if (frame < sampleFrames) { const bin = Math.min(peaks.length - 1, Math.floor(frame * peaks.length / sampleFrames)); if (peak > peaks[bin]!) peaks[bin] = peak; }
      }
      carry = Buffer.from(buffer.subarray(usable));
    });
    child.on('close', (code) => finish(undefined, code));
  });
}

/** Register after the application's loopback/origin guard:
 * app.get('/api/assets/:id/waveform', service.handler); await service.close() on shutdown.
 * Reads are authorized against the CURRENT project before and after extraction. */
export function createWaveformService(options: WaveformOptions) {
  const cacheDirectory = join(resolve(options.dataDirectory), 'waveforms');
  const ffmpeg = options.ffmpeg ?? 'ffmpeg', ffprobe = options.ffprobe ?? 'ffprobe', timeoutMs = Math.min(90000, Math.max(100, options.timeoutMs ?? 90000));
  const pending = new Map<string, Task>(), queue: Task[] = [];
  let working = false, closed = false, lastPruned = 0;

  const currentAsset = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw fail('Identificador de recurso inválido.', 400);
    const asset = options.getProject().assets.find((item) => item.id === id);
    if (!asset) throw fail('El recurso no pertenece al proyecto abierto.', 404);
    if (!['audio', 'video'].includes(asset.type)) throw fail('Las formas de onda se calculan sólo para audio o video.', 415);
    return asset;
  };
  async function sourceFor(asset: Asset): Promise<Source> {
    const match = asset.url.match(/^\/(api\/media|demo)\/([a-zA-Z0-9][a-zA-Z0-9_.-]{0,180})$/);
    if (!match || match[2]!.includes('..')) throw fail('El recurso no tiene una ruta local permitida.', 400);
    const path = join(match[1] === 'demo' ? resolve(options.publicDirectory, 'demo') : resolve(options.dataDirectory, 'media'), match[2]!);
    let info;
    try { info = await lstat(path, { bigint: true }); }
    catch (error: any) { if (error.code === 'ENOENT') throw fail('No se encuentra el archivo original de este recurso.', 404); throw error; }
    if (!info.isFile() || info.isSymbolicLink()) throw fail('El original debe ser un archivo local regular; no se admiten enlaces.', 400);
    const version = hash([VERSION, path, info.size, info.mtimeNs, info.ctimeNs, info.ino, info.dev].join(':'));
    return { asset: { ...asset }, path, version, cachePath: join(cacheDirectory, `wave-${hash(`${asset.id}:${asset.url}`)}.json`) };
  }
  function stillAuthorized(source: Source) {
    const current = currentAsset(source.asset.id);
    if (current.url !== source.asset.url || current.type !== source.asset.type) throw fail('El recurso cambió durante el análisis. Vuelve a seleccionarlo.', 409);
  }
  async function cached(source: Source): Promise<Waveform | undefined> {
    try {
      const info = await lstat(source.cachePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CACHE_BYTES) return;
      const value = JSON.parse(await readFile(source.cachePath, 'utf8'));
      if (value.version !== VERSION || value.sourceVersion !== source.version || value.assetId !== source.asset.id || typeof value.hasAudio !== 'boolean' || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_DURATION || !Array.isArray(value.peaks) || value.peaks.length > BINS || value.peaks.some((peak: unknown) => typeof peak !== 'number' || !Number.isFinite(peak) || peak < 0 || peak > 1)) return;
      if (value.hasAudio ? !Number.isInteger(value.sampleRate) || value.sampleRate < 1 || value.sampleRate > MAX_RATE || !Number.isInteger(value.channels) || value.channels < 1 || value.channels > MAX_CHANNELS || value.peaks.length !== Math.min(BINS, Math.ceil(value.duration * value.sampleRate)) : value.sampleRate !== 0 || value.channels !== 0 || value.peaks.length !== 0) return;
      return { assetId: value.assetId, duration: value.duration, sampleRate: value.sampleRate, channels: value.channels, hasAudio: value.hasAudio, peaks: value.peaks, sourceVersion: value.sourceVersion, cached: true };
    } catch { /* A partial or obsolete cache is recomputed from the original. */ }
  }
  async function pruneCache() {
    if (Date.now() - lastPruned < 30000) return; lastPruned = Date.now();
    const files = (await readdir(cacheDirectory)).filter((name) => cacheName.test(name));
    if (files.length <= 2000) return;
    const entries = await Promise.all(files.map(async (name) => ({ name, info: await lstat(join(cacheDirectory, name)) })));
    entries.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    await Promise.all(entries.slice(2000).map((entry) => rm(join(cacheDirectory, entry.name), { force: true })));
  }
  async function calculate(source: Source, signal: AbortSignal): Promise<Waveform> {
    stillAuthorized(source);
    let probe;
    try { probe = await runProcess(ffprobe, ['-v', 'error', '-max_alloc', '134217728', '-show_entries', 'stream=codec_type,duration,start_time,sample_rate,channels:format=duration,start_time', '-of', 'json', source.path], { signal, timeoutMs: Math.min(timeoutMs, 15000) }); }
    catch (error: any) {
      if (signal.aborted) throw abortError();
      if (error.code === 'ENOENT') throw fail('No se encontró FFprobe para leer el audio.', 503);
      if (error.message?.includes('tiempo máximo')) throw fail('La lectura del archivo superó el tiempo máximo. Prueba con un fragmento más corto.', 504);
      throw error;
    }
    if (probe.code !== 0) throw fail('No se pudo leer el archivo original como audio o video.');
    let metadata;
    try { metadata = parseJsonOutput(probe.stdout); } catch { throw fail('El analizador no devolvió datos válidos del archivo.'); }
    const streams: any[] = Array.isArray(metadata.streams) ? metadata.streams : [], audio = streams.find((stream) => stream.codec_type === 'audio');
    const formatStart = Number(metadata.format?.start_time) || 0;
    const candidates = [Number(metadata.format?.duration), ...streams.map((stream) => Number(stream.duration) + Math.max(0, (Number(stream.start_time) || 0) - formatStart))].filter((value) => Number.isFinite(value) && value > 0);
    const duration = Math.max(...candidates);
    if (!Number.isFinite(duration) || duration <= 0) throw fail('No se pudo determinar la duración del original.');
    if (duration > MAX_DURATION) throw fail('Las formas de onda admiten originales de hasta dos horas. Usa un fragmento más corto.');
    const sampleRate = audio ? Number(audio.sample_rate) : 0, channels = audio ? Number(audio.channels) : 0;
    if (audio && (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > MAX_RATE || !Number.isInteger(channels) || channels < 1 || channels > MAX_CHANNELS || Math.ceil(duration * sampleRate) * channels * 4 > MAX_PCM_BYTES)) throw fail('El formato de audio supera los límites del análisis: hasta 8 canales, 192 kHz y 8 GB de muestras decodificadas.');
    const peaks = audio ? await decodePeaks(ffmpeg, source.path, duration, sampleRate, channels, signal, timeoutMs) : [];
    if (signal.aborted) throw abortError();
    stillAuthorized(source);
    if ((await sourceFor(source.asset)).version !== source.version) throw fail('El original cambió durante el análisis. La forma de onda no se guardó; vuelve a intentarlo.', 409);
    const waveform: Waveform = { assetId: source.asset.id, duration, sampleRate, channels, hasAudio: !!audio, peaks, sourceVersion: source.version, cached: false };
    const temporary = `${source.cachePath}.${randomUUID()}.tmp`;
    try {
      await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify({ version: VERSION, ...waveform }), { mode: 0o600, flag: 'wx' });
      await rename(temporary, source.cachePath); await pruneCache();
    } catch { /* Caching is optional; a decoded waveform is still valid. */ }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
    return waveform;
  }
  async function drain() {
    if (working) return; working = true;
    try {
      while (queue.length) {
        const task = queue.shift()!;
        try {
          if (closed || task.controller.signal.aborted) throw abortError();
          task.resolve(await calculate(task.source, task.controller.signal));
        } catch (error) { task.reject(error); }
        finally { if (pending.get(task.key) === task) pending.delete(task.key); }
      }
    } finally { working = false; }
  }
  async function get(assetId: string, request: { signal?: AbortSignal } = {}): Promise<Waveform> {
    if (closed) throw fail('Filmma está cerrando.', 503);
    if (request.signal?.aborted) throw abortError();
    const source = await sourceFor(currentAsset(assetId)), saved = await cached(source);
    if (closed) throw fail('Filmma está cerrando.', 503);
    stillAuthorized(source);
    if (request.signal?.aborted) throw abortError();
    if (saved) return saved;
    const key = `${assetId}:${source.version}`;
    let task = pending.get(key);
    if (task?.controller.signal.aborted) task = undefined;
    if (!task) {
      if (pending.size >= MAX_PENDING) throw fail('Hay demasiadas formas de onda pendientes. Inténtalo de nuevo en unos segundos.', 429);
      let resolveTask!: Task['resolve'], rejectTask!: Task['reject'];
      const promise = new Promise<Waveform>((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
      void promise.catch(() => {});
      task = { key, controller: new AbortController(), promise, resolve: resolveTask, reject: rejectTask, source, subscribers: 0 };
      pending.set(key, task); queue.push(task); setImmediate(() => void drain());
    }
    const shared = task; shared.subscribers++;
    return new Promise<Waveform>((resolveResult, reject) => {
      let done = false;
      const release = () => { if (done) return false; done = true; request.signal?.removeEventListener('abort', abort); shared.subscribers--; return true; };
      const abort = () => { if (release()) { if (!shared.subscribers) shared.controller.abort(); reject(abortError()); } };
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) return abort();
      shared.promise.then((value) => { if (release()) { try { stillAuthorized(source); resolveResult(value); } catch (error) { reject(error); } } }, (error) => { if (release()) reject(error); });
    });
  }
  const handler: RequestHandler = (req, res, next) => {
    const controller = new AbortController(), abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    void get(String(req.params.id ?? ''), { signal: controller.signal }).then((waveform) => {
      if (!res.destroyed) { res.setHeader('Cache-Control', 'no-store'); res.json(waveform); }
    }).catch((error) => { if (!res.destroyed && !controller.signal.aborted) next(error); }).finally(() => { req.off('aborted', abort); res.off('close', abort); });
  };
  async function close() {
    closed = true;
    const tasks = [...pending.values()]; tasks.forEach((task) => task.controller.abort());
    await Promise.allSettled(tasks.map((task) => task.promise));
  }
  return { get, handler, close };
}
