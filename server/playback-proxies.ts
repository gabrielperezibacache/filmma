import type { Express } from 'express';
import type { Asset, Project, Job } from './types.js';
import { z } from 'zod';
import { lstat, mkdir, readFile, writeFile, rename, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectEnhancementMedia } from './enhance.js';
import { enhancementSha256 } from './ai-enhance.js';
import { runProcess } from './process.js';
const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
const stamp = (s: {
    size: number;
    mtimeMs: number;
    ino: number;
}) => `${s.size}:${s.mtimeMs}:${s.ino}`;
const metaSchema = z.object({ version: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/), sourceAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), sourceUrl: z.string(), sourceStamp: z.string(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), outputSha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().min(2).max(1280), height: z.number().int().min(2).max(1280), fps: z.number().positive(), frames: z.number().int().positive(), duration: z.number().positive(), bytes: z.number().positive(), audioTracks: z.number().int().nonnegative(), createdAt: z.string() });
type Meta = z.infer<typeof metaSchema>;
type Work = (signal: AbortSignal, update: (message: string, progress?: number) => void) => Promise<Job['result']>;
export function usedPlaybackVideos(project: Project) { const ids = new Set([...project.scenes.map(s => s.videoAssetId ?? s.assetId), ...(project.tracks ?? []).filter(t => t.type === 'video').flatMap(t => t.clips.map(c => c.assetId))]); return project.assets.filter(a => a.type === 'video' && ids.has(a.id)); }
export async function registerPlaybackProxies(o: {
    app: Express;
    dataDirectory: string;
    getProject: () => Project;
    getJobs: () => Job[];
    mediaPath: (a: Asset) => Promise<string>;
    ffmpeg: string;
    ffprobe: string;
    enqueue: (type: Job['type'], message: string, work: Work, result?: Job['result']) => Promise<Job>;
}) {
    const directory = join(o.dataDirectory, 'playback-proxies');
    await mkdir(directory, { recursive: true });
    const route = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
    const pending = new Map<string, Promise<Job>>();
    async function ready(asset: Asset): Promise<Meta | undefined> {
        try {
            const path = join(directory, `${asset.id}.json`), info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 16000)
                return;
            const m = metaSchema.parse(JSON.parse(await readFile(path, 'utf8')));
            if (m.sourceAssetId !== asset.id || m.sourceUrl !== asset.url)
                return;
            const source = await o.mediaPath(asset), original = await lstat(source), copy = await lstat(join(directory, m.key + '.mp4'));
            if (m.sourceStamp !== stamp(original) || !copy.isFile() || copy.isSymbolicLink() || copy.size !== m.bytes)
                return;
            return m;
        }
        catch {
            return;
        }
    }
    async function prepare(asset: Asset, signal: AbortSignal, update: (m: string, p?: number) => void) {
        const cached = await ready(asset);
        if (cached)
            return cached;
        const source = await o.mediaPath(asset), before = await lstat(source);
        if (before.size > 2 * 1024 ** 3)
            throw fail('La reproducción ligera admite fuentes de hasta 2 GiB. El original sigue disponible.');
        const input = await inspectEnhancementMedia(source, o.ffprobe, signal, false);
        if (input.duration > 120 || input.fps > 60.1 || input.width * input.height > 4096 * 2160 || Math.max(input.width, input.height) > 4096)
            throw fail('Prepara copias de clips de hasta 2 minutos, 60 fps y 4K. Divide el material largo; el original se conserva.');
        if (['smpte2084', 'arib-std-b67'].includes(input.video.color_transfer))
            throw fail('Esta fuente es HDR. Usa Original para mantener su color; no se aplica una conversión implícita.');
        if (input.audio.length > 8 || input.audio.some((a: any) => Number(a.channels) > 8))
            throw fail('Esta fuente tiene demasiadas pistas o canales para la copia ligera. Usa Original.');
        const disk = await statfs(directory);
        if (Number(disk.bavail) * Number(disk.bsize) < Math.max(1024 ** 3, before.size * 2))
            throw fail('Se necesita espacio para la copia y una reserva de 1 GiB. No se borró ningún original.');
        const original = await inspectEnhancementMedia(source, o.ffprobe, signal), sourceSha256 = await enhancementSha256(source);
        // New derivatives never overwrite another file. The index is updated atomically.
        const key = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''), destination = join(directory, key + '.mp4');
        try {
            const audioCopy = original.audio.every((a: any) => ['aac', 'mp3', 'alac', 'ac3', 'eac3'].includes(a.codec_name));
            const process = await runProcess(o.ffmpeg, ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-threads', '2', '-filter_threads', '1', '-i', source, '-map', `0:${original.video.index}`, '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '-1', '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear", '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2', '-g', '24', '-c:a', audioCopy ? 'copy' : 'aac', ...(audioCopy ? [] : ['-b:a', '192k']), '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-progress', 'pipe:1', destination], { signal, timeoutMs: 20 * 60 * 1000, onLine(line) { if (line.startsWith('out_time_us=')) {
                    const progress = Math.min(1, Number(line.slice(12)) / 1e6 / original.duration);
                    if (Number.isFinite(progress))
                        update(`${asset.name} · ${Math.round(progress * 100)} %`, 10 + progress * 75);
                } } });
            if (process.code !== 0)
                throw fail(`No se pudo preparar la copia ligera: ${process.stderr.slice(-700)}`);
            update('Verificando fotogramas, duración, proporción y audio de la copia…', 90);
            const result = await inspectEnhancementMedia(destination, o.ffprobe, signal);
            if (Math.max(result.width, result.height) > 1280 || result.frames !== original.frames || Math.abs(result.fps - original.fps) > .001 || Math.abs(result.duration - original.duration) > 1 / original.fps + .002 || Math.abs(result.aspect - original.aspect) > .002 || result.audio.length !== original.audio.length || Math.abs(Number(result.video.start_time ?? 0) - Number(original.video.start_time ?? 0)) > 1 / original.fps + .002)
                throw fail('La copia no conservó el reloj, proporción o pistas de la fuente. Se seguirá usando Original.');
            for (let i = 0; i < original.audio.length; i++) {
                const a = original.audio[i], b = result.audio[i];
                if (Number(a.channels) !== Number(b.channels) || Math.abs(Number(a.start_time ?? 0) - Number(b.start_time ?? 0)) > .1 || Math.abs(Number(a.duration ?? original.duration) - Number(b.duration ?? result.duration)) > .1)
                    throw fail('La copia no conservó los tiempos o canales de audio. Usa Original.');
            }
            const decode = await runProcess(o.ffmpeg, ['-v', 'error', '-nostdin', '-threads', '2', '-i', destination, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], { signal, timeoutMs: 120000 });
            if (decode.code !== 0)
                throw fail('La copia no superó la decodificación completa.');
            if (stamp(await lstat(source)) !== stamp(before) || await enhancementSha256(source) !== sourceSha256)
                throw fail('La fuente cambió durante la preparación. Se mantiene el original.');
            if (signal.aborted)
                throw fail('Trabajo cancelado.', 499);
            const info = await lstat(destination), meta: Meta = { version: 1, key, sourceAssetId: asset.id, sourceUrl: asset.url, sourceStamp: stamp(before), sourceSha256, outputSha256: await enhancementSha256(destination), width: result.width, height: result.height, frames: result.frames, fps: result.fps, duration: result.duration, bytes: info.size, audioTracks: result.audio.length, createdAt: new Date().toISOString() };
            const temporary = join(directory, `${asset.id}.${randomUUID()}.tmp`);
            await writeFile(temporary, JSON.stringify(meta), { flag: 'wx', mode: 0o600 });
            await rename(temporary, join(directory, asset.id + '.json'));
            return meta;
        }
        catch (error) {
            await rm(destination, { force: true });
            throw error;
        }
    }
    o.app.get('/api/playback/proxies', route(async (_req: any, res: any) => { const p = o.getProject(); const items = await Promise.all(usedPlaybackVideos(p).map(async (a) => { const m = await ready(a); return m ? { assetId: a.id, name: a.name, status: 'ready', ...m, url: `/api/playback/media/${m.key}.mp4` } : { assetId: a.id, name: a.name, status: 'missing' }; })); res.json({ projectId: p.id, items }); }));
    o.app.post('/api/playback/prepare', route(async (req: any, res: any) => {
        const input = z.object({ projectId: z.string().max(100) }).strict().parse(req.body), snapshot = structuredClone(o.getProject());
        if (input.projectId !== snapshot.id)
            throw fail('La película cambió. Vuelve a preparar la reproducción.', 409);
        const previous = o.getJobs().find(j => j.type === 'proxy' && j.result?.projectId === snapshot.id && ['queued', 'running'].includes(j.status));
        if (previous)
            return res.status(202).json({ job: previous });
        if (!pending.has(snapshot.id))
            pending.set(snapshot.id, (async () => { const assets = usedPlaybackVideos(snapshot); if (!assets.length)
                throw fail('La película no tiene videos que preparar.'); const missing = (await Promise.all(assets.map(async (a) => ({ asset: a, cached: await ready(a) })))).filter(x => !x.cached).map(x => x.asset); return o.enqueue('proxy', 'Preparando copias ligeras de reproducción…', async (signal, update) => { for (const [index, a] of missing.entries()) {
                update(`Copia ${index + 1} de ${missing.length} · ${a.name}`, index / missing.length * 100);
                await prepare(a, signal, (message, p = 0) => update(message, (index + p / 100) / missing.length * 100));
            } return { projectId: snapshot.id, text: `${missing.length} copias verificadas. Los originales y la exportación se conservan.` }; }, { projectId: snapshot.id }); })().finally(() => pending.delete(snapshot.id)));
        res.status(202).json({ job: await pending.get(snapshot.id) });
    }));
    o.app.get('/api/playback/media/:key', route(async (req: any, res: any) => { const key = String(req.params.key).replace(/\.mp4$/, ''); if (!/^[a-f0-9]{64}$/.test(key))
        throw fail('Copia no disponible.', 404); const p = o.getProject(); const available = await Promise.all(usedPlaybackVideos(p).map(a => ready(a))); if (!available.some(m => m?.key === key))
        throw fail('La copia ya no corresponde a esta fuente. Se conserva el original.', 404); res.sendFile(join(directory, key + '.mp4')); }));
}
