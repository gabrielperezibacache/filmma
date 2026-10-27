import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, rm, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { inspectEnhancementMedia, type EnhancedMedia } from './enhance.js';
import { parseJsonOutput, runProcess } from './process.js';
import type { AiProcessingProfile, TemporalEnhancementMetrics } from '../src/types.js';
import { temporalEnhancementMetricsSchema } from './types.js';

const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
export type AiEnhancementDetails = {
  model: string; version: string; modelSha256: string; strength: number; tile: number; temporalMode: string;
  profile?: AiProcessingProfile;
  sourceSha256?: string; outputSha256?: string;
  metrics?: { wallSeconds?: number; secondsPerFrame?: number; peakChildRssBytes?: number; peakWorkerRssBytes?: number; memoryNote?: string; qualityNote?: string; maxRgbDifferenceBeforeEncoding?: number; meanRgbDifferenceBeforeEncoding?: number; temporal?: TemporalEnhancementMetrics };
};
export const aiTemporalMode = (profile: AiProcessingProfile = 'conservative') => profile === 'temporal' ? 'motion-compensated-residual-v1' : profile === 'restore' ? 'frame-independent-color-preserving-v1' : 'frame-independent-conservative';
export function aiTargetDimensions(width: number, height: number): [number, number] {
  const scale = Math.min(3840 / Math.max(width, height), Math.sqrt(3840 * 2160 / (width * height)));
  return [Math.floor(width * scale / 2) * 2, Math.floor(height * scale / 2) * 2];
}
export async function enhancementSha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const sha256 = enhancementSha256;

/** Frame-sequence inference requires proven constant timestamps. Metadata averages
 * alone cannot distinguish variable frame rate from a stable rational clock. */
export async function validateAiFrameClock(source: string, ffprobe: string, signal: AbortSignal, frames: number, fps: number) {
  const result = await runProcess(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', source], { signal, timeoutMs: 120000 });
  if (result.code !== 0) throw fail('No se pudieron verificar los tiempos originales del video.');
  const timestamps = parseJsonOutput(result.stdout).frames?.map((frame: any) => Number(frame.best_effort_timestamp_time));
  if (!Array.isArray(timestamps) || timestamps.length !== frames || timestamps.some((value: number) => !Number.isFinite(value))) throw fail('El video no tiene una secuencia de tiempos verificable. El original se conserva.');
  if (Math.abs(timestamps[0]) > .001) throw fail('La mejora con IA requiere un clip cuyo video empiece en cero. Exporta primero la toma para conservar la sincronización de audio.');
  if (timestamps.some((value: number, index: number) => Math.abs(value - index / fps) > .001)) throw fail('La mejora con IA requiere fotogramas por segundo constantes. Este clip tiene velocidad variable; exporta primero la toma. El original se conserva.');
}

export async function enhanceVideoWithAi(options: {
  source: string; destination: string; workDirectory: string; strength: number; processingProfile?: AiProcessingProfile;
  python: string; workerPath: string; ffmpeg: string; ffprobe: string; signal: AbortSignal;
  update: (message: string, progress?: number) => void;
}): Promise<EnhancedMedia & { ai: AiEnhancementDetails }> {
  const { source, destination, workDirectory, strength, processingProfile = 'conservative', python, workerPath, ffmpeg, ffprobe, signal, update } = options;
  if (!['conservative','restore','temporal'].includes(processingProfile)) throw fail('El perfil de mejora con IA no es válido.');
  const maxStrength = processingProfile === 'conservative' ? .7 : .85;
  if (!Number.isFinite(strength) || strength < .15 || strength > maxStrength) throw fail(`La intensidad de IA debe estar entre 15 % y ${maxStrength * 100} %.`);
  const file = await lstat(source);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 2 * 1024 ** 3) throw fail('La mejora admite archivos locales regulares de hasta 2 GiB.');
  if (await lstat(destination).catch(() => undefined)) throw fail('La copia de salida ya existe; elige un destino nuevo.');
  update('Comprobando la toma original, sus tiempos y su audio…', 2);
  let original = await inspectEnhancementMedia(source, ffprobe, signal, false);
  if (original.duration > 15.001 || original.containerDuration > 15.101 || original.fps > 60.001 || Math.max(original.width, original.height) > 1920 || original.width * original.height > 1920 * 1080) throw fail('La mejora con IA admite tomas de hasta 15 segundos, 60 fps y resolución de entrada Full HD. Divide o exporta primero el material largo.');
  if (original.width % 2 || original.height % 2 || Math.abs(original.sar - 1) > .00001) throw fail('La mejora con IA necesita dimensiones pares y píxeles cuadrados. Exporta primero la toma para conservar el encuadre.');
  if (['smpte2084', 'arib-std-b67'].includes(original.video.color_transfer)) throw fail('La mejora con IA admite SDR. El original HDR se conserva sin convertir su color.');
  if (original.audio.length > 8 || original.audio.some((stream: any) => Number(stream.channels) > 8)) throw fail('La mejora admite hasta ocho pistas de audio y ocho canales por pista.');
  original = await inspectEnhancementMedia(source, ffprobe, signal);
  if (original.frames > 900 || Math.abs(original.duration - original.frames / original.fps) > .002) throw fail('La duración no coincide con una secuencia de fotogramas constante de hasta 15 segundos. Exporta primero la toma.');
  await validateAiFrameClock(source, ffprobe, signal, original.frames, original.fps);
  const [width, height] = aiTargetDimensions(original.width, original.height);
  const disk = await statfs(dirname(destination));
  if (Number(disk.bavail) * Number(disk.bsize) < Math.max(4 * 1024 ** 3, file.size * 3)) throw fail('La mejora con IA necesita al menos 4 GiB libres para el trabajo temporal y la copia 4K.');
  const fingerprint = await sha256(source);
  await mkdir(workDirectory, { recursive: true });
  const silentVideo = join(workDirectory, 'ai-silent.mp4'), requestPath = join(workDirectory, 'request.json');
  const [fpsNumerator, fpsDenominator = 1] = String(original.video.avg_frame_rate).split('/').map(Number);
  await writeFile(requestPath, JSON.stringify({ source, destination: silentVideo, workDirectory: join(workDirectory, 'frames'), strength, processingProfile, targetLongEdge: 3840, targetWidth: width, targetHeight: height, width: original.width, height: original.height, frames: original.frames, fpsNumerator, fpsDenominator, ffmpeg, ffprobe }), { mode: 0o600, flag: 'wx' });
  let workerError: string | undefined;
  try {
    const inferred = await runProcess(python, [workerPath, 'upscale', '--request', requestPath], { signal, timeoutMs: 6 * 60 * 60 * 1000, onLine(line) {
      try {
        const event = JSON.parse(line), kind = event.event ?? event.type;
        if (kind === 'error') workerError = String(event.message ?? event.error);
        if (kind === 'progress') update(String(event.message ?? 'Mejorando detalle con IA local…'), typeof event.progress === 'number' ? 5 + .8 * event.progress : undefined);
      } catch { /* Non-JSON engine diagnostics are retained by the process result. */ }
    } });
    if (inferred.code !== 0) throw fail(workerError || inferred.stderr.slice(-1800) || 'La IA local no pudo completar la toma.');
    const result = parseJsonOutput(inferred.stdout);
    if (result.ok !== true || result.model !== 'realesrgan-x4plus' || result.engine !== 'realesrgan-ncnn-vulkan' || !/^[a-f0-9]{64}$/i.test(result.modelSha256 ?? '') || typeof result.version !== 'string' || !Number.isInteger(result.tile) || typeof result.temporalMode !== 'string') throw fail('El motor no devolvió una verificación válida del modelo de IA. No se añadió una copia.');
    if ((result.processingProfile ?? 'conservative') !== processingProfile || (processingProfile !== 'conservative' && result.processingProfile !== processingProfile) || result.temporalMode !== aiTemporalMode(processingProfile)) throw fail('El motor no confirmó el perfil de acabado solicitado. El original se conserva y no se añadió una copia.');
    if (processingProfile === 'temporal') {
      const verified = temporalEnhancementMetricsSchema.safeParse(result.metrics?.temporal);
      if (!verified.success || verified.data.frames !== original.frames || verified.data.stabilizedFrames + verified.data.resets > original.frames - 1) throw fail('El motor no confirmó una estabilización válida para todos los fotogramas. Se conserva el original.');
    }
    const intermediate = await inspectEnhancementMedia(silentVideo, ffprobe, signal);
    if (intermediate.width !== width || intermediate.height !== height || intermediate.frames !== original.frames || Math.abs(intermediate.fps - original.fps) > .00001 || Math.abs(intermediate.duration - original.duration) > .002 || intermediate.audio.length) throw fail('La copia de IA no conservó las dimensiones, fotogramas o tiempos de la toma.');
    update('Conservando las pistas de audio originales…', 88);
    const audioCopy = original.audio.every((stream: any) => ['aac', 'mp3', 'alac', 'ac3', 'eac3'].includes(stream.codec_name));
    const remuxed = await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', silentVideo, '-i', source,
      '-map', '0:v:0', '-map', '1:a?', '-map_metadata', '1', '-map_chapters', '-1', '-c:v', 'copy', '-c:a', audioCopy ? 'copy' : 'aac', ...(audioCopy ? [] : ['-b:a', '256k']), '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', destination], { signal, timeoutMs: 5 * 60 * 1000 });
    if (remuxed.code !== 0) throw fail(`No se pudo conservar el audio: ${remuxed.stderr.slice(-1000)}`);
    update('Verificando 4K, audio y conservación del original…', 94);
    const output = await inspectEnhancementMedia(destination, ffprobe, signal);
    if (output.width !== width || output.height !== height || output.frames !== original.frames || Math.abs(output.fps - original.fps) > .00001 || Math.abs(output.duration - original.duration) > .002 || output.audio.length !== original.audio.length || Math.abs(original.aspect - output.aspect) > .002) throw fail('La copia no conservó los fotogramas, tiempos, audio o proporción originales.');
    for (let i = 0; i < original.audio.length; i++) {
      const before = original.audio[i], after = output.audio[i];
      if (Number(before.channels) !== Number(after.channels) || Math.abs(Number(before.duration ?? original.duration) - Number(after.duration ?? output.duration)) > .1 || Math.abs(Number(before.start_time ?? 0) - Number(after.start_time ?? 0)) > .1) throw fail('La copia no conservó la sincronización o los canales de audio.');
    }
    await validateAiFrameClock(destination, ffprobe, signal, output.frames, output.fps);
    if (await sha256(source) !== fingerprint) throw fail('El original cambió durante la mejora. No se añadió la copia.');
    if (signal.aborted) throw fail('Trabajo cancelado.', 499);
    return { width, height, duration: output.duration, fps: output.fps, frames: output.frames, audioTracks: output.audio.length, ai: {
      model: result.model, version: result.version, modelSha256: result.modelSha256, sourceSha256: fingerprint, outputSha256: await sha256(destination), strength, profile: processingProfile, tile: result.tile, temporalMode: result.temporalMode, metrics: result.metrics,
    } };
  } catch (error) { await rm(destination, { force: true }); throw error; }
  finally { await rm(workDirectory, { recursive: true, force: true }); }
}
