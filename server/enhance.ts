import { lstat, rm, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseJsonOutput, runProcess } from './process.js';

export type EnhancementPreset = 'clean' | 'upscale';
export type EnhancedMedia = { width: number; height: number; duration: number; fps: number; frames: number; audioTracks: number };
const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
const rational = (value: unknown) => { const [a, b = '1'] = String(value).split('/'); return Number(a) / Number(b); };
const readableDuration = (stream: any, fallback: unknown) => Number(stream.duration ?? fallback);

export async function inspectEnhancementMedia(path: string, ffprobe: string, signal: AbortSignal, countFrames = true) {
  const result = await runProcess(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', ...(countFrames ? ['-count_frames'] : []), '-show_streams', '-show_format', '-of', 'json', path], { signal, timeoutMs: 120000 });
  if (result.code !== 0) throw fail('No se pudo verificar el video original.');
  const data = parseJsonOutput(result.stdout), video = data.streams?.find((stream: any) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw fail('El archivo no contiene una pista de video.');
  const rotation = Number(video.side_data_list?.find((side: any) => side.rotation != null)?.rotation ?? video.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const width = Number(rotated ? video.height : video.width), height = Number(rotated ? video.width : video.height);
  const duration = readableDuration(video, data.format?.duration), fps = rational(video.avg_frame_rate), frames = Number(video.nb_read_frames ?? video.nb_frames);
  const audio = data.streams.filter((stream: any) => stream.codec_type === 'audio');
  if (![width, height, duration, fps].every(Number.isFinite) || width < 2 || height < 2 || duration <= 0 || (countFrames && (!Number.isFinite(frames) || frames < 1)) || fps <= 0) throw fail('El video no tiene dimensiones, duración o fotogramas verificables.');
  const rawSar = rational(video.sample_aspect_ratio?.replace(':', '/') ?? '1/1');
  const sar = Number.isFinite(rawSar) && rawSar > 0 ? rawSar : 1;
  return { width, height, duration, fps, frames, audio, video, sar, aspect: width / height * (rotated ? 1 / sar : sar), containerDuration: Number(data.format?.duration) };
}

const inspect = inspectEnhancementMedia;

/** A CPU-only derivative. Temporal denoise is deliberately mild; no generative
 * restoration is claimed. Originals and screenplay references are never edited. */
export async function enhanceVideo(options: { source: string; destination: string; preset: EnhancementPreset; ffmpeg: string; ffprobe: string; signal: AbortSignal; update: (message: string, progress?: number) => void }): Promise<EnhancedMedia> {
  const { source, destination, preset, ffmpeg, ffprobe, signal, update } = options;
  const file = await lstat(source);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 2 * 1024 ** 3) throw fail('La mejora admite archivos locales regulares de hasta 2 GiB.');
  if (await lstat(destination).catch(() => undefined)) throw fail('La copia de salida ya existe; elige un destino nuevo.');
  update('Analizando fotogramas, proporción y audio originales…', 3);
  let original = await inspect(source, ffprobe, signal, false);
  if (original.duration > 120 || original.containerDuration > 121 || original.fps > 60.1 || Math.max(original.width, original.height) > 3840 || original.width * original.height > 3840 * 2160 || original.frames > 7201) throw fail('La mejora local admite clips de hasta 2 minutos, 60 fps y 4K. Divide el material largo en tomas.');
  if (original.width % 2 || original.height % 2) throw fail('La mejora MP4 requiere dimensiones pares. El original se conserva sin recortar.');
  if (['smpte2084', 'arib-std-b67'].includes(original.video.color_transfer)) throw fail('Este video es HDR. La mejora local admite SDR para conservar el color sin una conversión implícita.');
  if (original.audio.length > 8 || original.audio.some((stream: any) => Number(stream.channels) > 8)) throw fail('La mejora admite hasta ocho pistas de audio y ocho canales por pista.');
  original = await inspect(source, ffprobe, signal);
  if (original.frames > 7201) throw fail('El video contiene demasiados fotogramas para la mejora local.');
  const scale = preset === 'upscale' ? Math.min(2, 3840 / Math.max(original.width, original.height), Math.sqrt(3840 * 2160 / (original.width * original.height))) : 1;
  const width = Math.floor(original.width * scale / 2) * 2, height = Math.floor(original.height * scale / 2) * 2;
  if (preset === 'upscale' && width === original.width && height === original.height) throw fail('El video ya alcanza el límite 4K. Usa Limpiar para mejorar ruido y enfoque sin ampliarlo.');
  const disk = await statfs(dirname(destination));
  if (Number(disk.bavail) * Number(disk.bsize) < Math.max(1024 ** 3, file.size * 2)) throw fail('No hay suficiente espacio para una copia mejorada y una reserva de 1 GiB.');
  const filters = ['hqdn3d=0.7:0.5:1.0:0.7', ...(preset === 'upscale' ? [`scale=${width}:${height}:flags=lanczos`] : []), 'unsharp=5:5:0.25:5:5:0'];
  const audioCopy = original.audio.every((stream: any) => ['aac', 'mp3', 'alac', 'ac3', 'eac3'].includes(stream.codec_name));
  try {
    update(preset === 'upscale' ? `Ampliando con Lanczos a ${width} × ${height}…` : 'Reduciendo ruido y afinando detalle con suavidad…', 8);
    const result = await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-threads', '2', '-filter_threads', '1', '-i', source,
      '-map', `0:${original.video.index}`, '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '-1', '-vf', filters.join(','), '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-c:a', audioCopy ? 'copy' : 'aac', ...(audioCopy ? [] : ['-b:a', '256k']), '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-progress', 'pipe:1', destination], {
      signal, timeoutMs: 20 * 60 * 1000, onLine(line) { if (line.startsWith('out_time_us=')) { const elapsed = Number(line.slice(12)) / 1e6; if (Number.isFinite(elapsed)) update(`Mejorando imagen · ${Math.round(Math.min(1, elapsed / original.duration) * 100)} %`, 8 + 80 * Math.min(1, elapsed / original.duration)); } },
    });
    if (result.code !== 0) throw fail(`No se pudo mejorar el video: ${result.stderr.slice(-1000) || 'FFmpeg no completó la copia.'}`);
    update('Verificando la copia mejorada, sus fotogramas y su audio…', 92);
    const output = await inspect(destination, ffprobe, signal);
    if (output.width !== width || output.height !== height || output.frames !== original.frames || Math.abs(output.fps - original.fps) > 0.001 || Math.abs(output.duration - original.duration) > 1 / original.fps + 0.002 || output.audio.length !== original.audio.length) throw fail('La copia no conservó las dimensiones previstas, duración, fotogramas o pistas de audio. No se añadió a la biblioteca.');
    if (Math.abs(original.aspect - output.aspect) > 0.002) throw fail('La copia alteró la proporción de la imagen; se conserva el original.');
    for (let i = 0; i < original.audio.length; i++) {
      const before = original.audio[i], after = output.audio[i];
      if (Number(before.channels) !== Number(after.channels) || Math.abs(readableDuration(before, original.duration) - readableDuration(after, output.duration)) > 0.1 || Math.abs(Number(before.start_time ?? 0) - Number(after.start_time ?? 0)) > 0.1) throw fail('La copia no conservó el tiempo o los canales de audio.');
    }
    const unchanged = await lstat(source);
    if (unchanged.size !== file.size || unchanged.mtimeMs !== file.mtimeMs || unchanged.ino !== file.ino) throw fail('El archivo original cambió durante la mejora. Vuelve a intentarlo cuando termine de guardarse.');
    if (signal.aborted) throw fail('Trabajo cancelado.', 499);
    return { width, height, duration: output.duration, fps: output.fps, frames: output.frames, audioTracks: output.audio.length };
  } catch (error) { await rm(destination, { force: true }); throw error; }
}
