import { basename, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import sharp, { type OutputInfo } from 'sharp';
import type { Asset, Project } from './types.js';
import type { ClipAudio, ColorAdjustments, TimelineClip, LayerTransform } from '../src/types.js';
import { buildTimeline } from '../src/timeline.js';
import { audioGainAt, resolveTimelineClips } from '../src/multitrack.js';
import { resolveSubtitleCues } from '../src/subtitles.js';
import { resolveSceneTransitions } from '../src/transitions.js';
import { baseLayerTransform, colorMatrix, normalizedLayerKeyframes, playbackSpeed, sourceTime } from '../src/visual-effects.js';
import { parseJsonOutput, runProcess } from './process.js';
import { exportDimensions, type ExportResolution } from '../src/export-resolution.js';

type RenderOptions = {
  destination: string; workDirectory: string; mediaPath: (asset: Asset) => Promise<string>;
  ffmpeg?: string; ffprobe?: string; signal: AbortSignal; update: (message: string, progress?: number) => void;
  resolution?: ExportResolution;
  /** Small output sizes are useful for exact renderer tests; the API uses resolution. */
  dimensions?: [number, number];
};
type AudioSource = { path: string; startFrame: number };
type VisualSource = { path: string; startFrame: number; endFrame: number; opacity: number; clip?: TimelineClip };
type MediaInfo = { videoDuration: number; audioDuration: number; frameDuration: number; hasAudio: boolean };
const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
const number = (value: number) => Number(value.toFixed(9)).toString();
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Keep each atempo stage in [.5,2] so speeding up never skips input samples. */
function speedAudioFilters(value?: number) {
  let speed = playbackSpeed(value); const result: string[] = [];
  while (speed > 2) { result.push('atempo=2'); speed /= 2; }
  while (speed < .5) { result.push('atempo=0.5'); speed *= 2; }
  if (speed !== 1) result.push(`atempo=${number(speed)}`);
  return result;
}

function colorFilters(color?: ColorAdjustments) {
  const matrix = colorMatrix(color), identity = colorMatrix();
  if (matrix.every((coefficient, index) => coefficient === identity[index])) return [];
  const channels = ['r', 'g', 'b'];
  const expressions = channels.map((channel, row) => `${channel}='clip(${channels.map((source, col) => `${number(matrix[row * 5 + col]!)}*${source}(X,Y)`).join('+')}+${number(matrix[row * 5 + 4]! * 255)},0,255)'`);
  return ['format=gbrap', `geq=${expressions.join(':')}:a='alpha(X,Y)'`];
}

/** Equivalent to evaluateLayerTransform, expressed in FFmpeg's frame clock. */
function transformExpression(clip: TimelineClip, field: keyof LayerTransform, clock: string, fps: number) {
  const keys = normalizedLayerKeyframes(clip, fps);
  if (!keys.length) return number(baseLayerTransform(clip)[field]);
  if (keys.every((key) => key[field] === keys[0]![field])) return number(keys[0]![field]);
  const interval = (index: number) => {
    const left = keys[index]!, right = keys[index + 1];
    if (!right) return number(left[field]);
    if (right.time <= left.time) return number(right[field]);
    const p = `((${clock}-${number(left.time * fps)})/${number((right.time - left.time) * fps)})`;
    const amount = left.easing === 'hold' ? '0' : left.easing === 'ease-in-out' ? `(${p}*${p}*(3-2*${p}))` : p;
    return left[field] === right[field] ? number(left[field]) : `(${number(left[field])}+${number(right[field] - left[field])}*${amount})`;
  };
  // A balanced tree stays below FFmpeg's expression recursion limit even at the
  // full 100-key project limit; a linear chain of nested ifs cannot be parsed.
  const tree = (start: number, end: number): string => {
    if (start === end) return interval(start);
    const middle = Math.floor((start + end) / 2);
    return `if(lt(${clock},${number(keys[middle + 1]!.time * fps)}),${tree(start, middle)},${tree(middle + 1, end)})`;
  };
  return `if(lt(${clock},${number(keys[0]!.time * fps)}),${number(keys[0]![field])},${tree(0, keys.length - 1)})`;
}

/** Same linear gain as the preview. Fades retain the logical clip duration when
 * the movie end cuts an extra clip short. Muting never hides video. */
export function audioFilters(settings: ClipAudio | undefined, duration: number, trackGain = 1, fps = 24) {
  const audio = settings ?? {}, gain = audio.muted ? 0 : clamp(audio.volume ?? 1) * trackGain;
  const filters = ['aresample=48000', 'aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=stereo', `volume=${number(gain)}`];
  for (const [kind, raw] of [['in', audio.fadeIn], ['out', audio.fadeOut]] as const) {
    const fade = Math.min(duration, Math.max(0, Math.round((raw ?? 0) * fps) / fps));
    if (fade) filters.push(`afade=t=${kind}:st=${number(kind === 'in' ? 0 : duration - fade)}:d=${number(fade)}:curve=tri`);
  }
  return filters;
}

/** Text is passed only through escaped Pango markup, never a command or filter.
 * All words remain visible: unusually dense cues reduce font size to fit. */
export async function subtitleCard(text: string, width: number, height: number) {
  const plateWidth = Math.floor(width * .86), padding = Math.max(4, Math.round(width * .008));
  let fontSize = Math.max(8, Math.round(width * .025));
  let rendered: { data: Buffer; info: OutputInfo } | undefined;
  if (text.length > 20000) throw new Error('Hay demasiados subtítulos superpuestos para mostrarlos. Separa sus tiempos antes de exportar.');
  while (fontSize >= 6) {
    rendered = await sharp({ text: { text: `<span foreground="white">${xml(text)}</span>`, font: `Arial Bold ${fontSize}`, width: plateWidth - padding * 2, align: 'centre', rgba: true, spacing: Math.max(0, Math.round(fontSize * .25)), wrap: 'word-char' } }).png().toBuffer({ resolveWithObject: true });
    if (rendered.info.height + padding * 2 <= height * .85) break;
    fontSize -= 1;
  }
  if (!rendered || rendered.info.height + padding * 2 > height * .85) throw new Error('El texto superpuesto no cabe en pantalla. Divide el subtítulo o separa sus tiempos.');
  const plateHeight = rendered.info.height + padding * 2, top = height - Math.round(height * .06) - plateHeight;
  const plate = await sharp({ create: { width: plateWidth, height: plateHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: .72 } } }).composite([{ input: rendered.data, left: Math.floor((plateWidth - rendered.info.width) / 2), top: padding }]).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: plate, left: Math.floor((width - plateWidth) / 2), top }]).png().toBuffer();
}

export async function renderProject(project: Project, options: RenderOptions) {
  const { workDirectory: work, destination, mediaPath, signal, update } = options;
  const ffmpeg = options.ffmpeg ?? 'ffmpeg', ffprobe = options.ffprobe ?? 'ffprobe';
  const layout = buildTimeline(project), fps = layout.fps, total = layout.totalSeconds;
  const transitions = resolveSceneTransitions(project);
  // MOV preserves a rational frame clock and sample-accurate float PCM. A 1 ms
  // container time base would accumulate rounding across many 24 fps cuts.
  // Preserve decoded picture samples between montage, transitions and layer
  // batches. Apply the sole lossy export encode after all compositing.
  // QP 0 is lossless for the existing YUV420 working representation; it does
  // not undo source compression or chroma conversion made by filters.
  const movieClock = ['-video_track_timescale', String(fps * 1024), '-movie_timescale', String(fps * 1024)];
  const [width, height] = options.dimensions ?? exportDimensions(project.format, options.resolution);
  const assets = new Map(project.assets.map((asset) => [asset.id, asset])), probes = new Map<string, MediaInfo>();
  let serial = 0;
  const file = (label: string, extension: string) => join(work, `${label}-${++serial}.${extension}`);
  const check = () => { if (signal.aborted) throw new Error('Trabajo cancelado.'); };
  const encode = async (args: string[], message: string) => {
    check();
    const result = await runProcess(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-filter_complex_threads', '2', ...args], { signal, cwd: work, timeoutMs: 60 * 60 * 1000 });
    if (result.code !== 0) throw new Error(`${message}: ${result.stderr.slice(-1800)}`);
  };
  const graphFile = async (filters: string[]) => { const path = file('filters', 'txt'); await writeFile(path, filters.join(';\n')); return path; };
  const probe = async (path: string): Promise<MediaInfo> => {
    if (probes.has(path)) return probes.get(path)!;
    const result = await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration,avg_frame_rate:format=duration', '-of', 'json', path], { signal, timeoutMs: 15000 });
    if (result.code !== 0) throw new Error('No se pudo leer la duración del original.');
    const data = parseJsonOutput(result.stdout), video = data.streams?.find((stream: any) => stream.codec_type === 'video'), audio = data.streams?.find((stream: any) => stream.codec_type === 'audio');
    const rate = String(video?.avg_frame_rate ?? '0/1').split('/').map(Number), sourceFps = rate[0]! / rate[1]!;
    const duration = (stream: any) => { const value = Number(stream?.duration ?? data.format?.duration); return Number.isFinite(value) && value > 0 ? value : 0; };
    const info = { videoDuration: duration(video), audioDuration: duration(audio), frameDuration: Number.isFinite(sourceFps) && sourceFps > 0 ? 1 / sourceFps : 1 / fps, hasAudio: !!audio };
    probes.set(path, info); return info;
  };
  const soundInput = (path: string, info: MediaInfo, trim: number, gain: number) => info.hasAudio && gain > 0 && trim < info.audioDuration
    ? ['-ss', number(trim), '-i', path]
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];

  async function visualClip(asset: Asset, frames: number, trim: number, logicalDuration: number, audio: ClipAudio | undefined, gain: number, look = 'original', transition = 'cut', envelope: { video?: string[]; audio?: string[] } = {}, effects: { color?: ColorAdjustments; speed?: number; alpha?: boolean } = {}) {
    const original = await mediaPath(asset), duration = frames / fps, speed = playbackSpeed(effects.speed);
    let source = original, still = asset.type === 'image';
    const info = still ? { videoDuration: 0, audioDuration: 0, frameDuration: 1 / fps, hasAudio: false } : await probe(original);
    if (still) {
      source = file('still', 'png');
      const image = sharp(original, { limitInputPixels: 120000000 }).rotate().resize(width, height, { fit: 'inside', kernel: 'lanczos3' });
      await (effects.alpha ? image : image.flatten({ background: '#000000' })).png().toFile(source);
    } else if (trim >= Math.max(0, info.videoDuration - info.frameDuration)) {
      // Seeking beyond EOF otherwise yields no frame. Decode the tail and retain
      // its actual last picture, while sound still uses the requested source trim.
      source = file('last-frame', 'png');
      await encode(['-sseof', number(-Math.min(2, info.videoDuration || 2)), '-i', original, '-map', '0:v:0', '-an', '-update', '1', source], `No se pudo recuperar el último fotograma de «${asset.name}»`);
      still = true;
    }
    const args = still ? ['-loop', '1', '-framerate', String(fps), '-i', source] : ['-ss', number(trim), '-i', source];
    args.push(...soundInput(original, info, trim, audio?.muted ? 0 : (audio?.volume ?? 1) * gain));
    const video = [`setpts=(PTS-STARTPTS)/${number(still ? 1 : speed)}`, `fps=${fps}`, `tpad=stop_mode=clone:stop_duration=${number(duration)}`, `trim=end_frame=${frames}`, 'setpts=PTS-STARTPTS', `scale=${width}:${height}:force_original_aspect_ratio=decrease:reset_sar=1:flags=lanczos`];
    if (look === 'noir') video.push('hue=s=0', 'eq=contrast=1.08');
    if (look === 'warm') video.push('eq=saturation=0.85', 'colorbalance=rs=0.03:bs=-0.03');
    video.push(...colorFilters(effects.color), `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1');
    if (transition === 'fade') { const fade = Math.min(.5, duration / 3); video.push(`fade=t=in:st=0:d=${number(fade)}`, `fade=t=out:st=${number(duration - fade)}:d=${number(fade)}`); }
    video.push(...envelope.video ?? []);
    const sound = [...speedAudioFilters(speed), ...audioFilters(audio, logicalDuration, gain, fps), ...envelope.audio ?? [], 'apad', `atrim=end_sample=${Math.round(duration * 48000)}`, 'asetpts=PTS-STARTPTS'];
    const output = file('clip', 'mov');
    await encode([...args, '-map', '0:v:0', '-map', '1:a:0', '-vf', video.join(','), '-af', sound.join(','), '-t', number(duration), ...(effects.alpha ? ['-c:v', 'qtrle', '-pix_fmt', 'argb'] : ['-c:v', 'libx264', '-preset', 'fast', '-qp', '0', '-pix_fmt', 'yuv420p']), '-c:a', 'pcm_f32le', ...movieClock, output], `No se pudo montar «${asset.name}»`);
    return output;
  }

  // New transitions belong to the incoming scene. Their envelopes occupy existing
  // frame intervals; no xfade/concat overlap can move later scenes or subtitles.
  function transitionEnvelope(sceneId: string, frames: number) {
    const video: string[] = [], audio: string[] = [];
    const zeroFor = (expression: string) => `aeval=exprs='val(0)*(${expression})|val(1)*(${expression})'`;
    for (const transition of transitions) {
      if (transition.incoming.id === sceneId) {
        const count = transition.incomingFrames;
        if (transition.kind === 'dissolve') {
          if (count > 1) audio.push(`afade=t=in:st=0:d=${number((count - 1) / fps)}:curve=tri`);
        } else if (count === 1) {
          video.push("drawbox=color=black:t=fill:enable='eq(n,0)'");
          audio.push(zeroFor(`gte(t,${number(1 / fps)})`));
        } else if (count > 1) {
          video.push(`fade=t=in:start_frame=0:nb_frames=${count - 1}`);
          audio.push(`afade=t=in:st=0:d=${number((count - 1) / fps)}:curve=tri`);
        }
      }
      if (transition.kind === 'dip' && transition.outgoing.id === sceneId) {
        const count = transition.outgoingFrames, start = frames - count;
        if (count === 1) {
          video.push(`drawbox=color=black:t=fill:enable='eq(n,${frames - 1})'`);
          audio.push(zeroFor(`lt(t,${number((frames - 1) / fps)})`));
        } else if (count > 1) {
          video.push(`fade=t=out:start_frame=${start}:nb_frames=${count - 1}`);
          audio.push(`afade=t=out:st=${number(start / fps)}:d=${number((count - 1) / fps)}:curve=tri`);
        }
      }
    }
    return { video, audio };
  }

  const baseClips: string[] = [];
  for (const [index, segment] of layout.segments.entries()) {
    check(); const scene = segment.scene, asset = assets.get(scene.videoAssetId ?? scene.assetId ?? '');
    if (!asset || !['image', 'video'].includes(asset.type)) throw new Error(`«${scene.title}» no tiene una imagen o un video para el montaje.`);
    update(`Montando ${index + 1} de ${layout.segments.length}: ${scene.title}`, 5 + index / layout.segments.length * 35);
    let path = await visualClip(asset, segment.durationFrames, (scene.trimStart ?? 0), segment.durationFrames / fps, scene.audio, 1, scene.look, scene.transition, transitionEnvelope(scene.id, segment.durationFrames), scene);
    const dissolve = transitions.find((transition) => transition.kind === 'dissolve' && transition.incoming.id === scene.id && transition.durationFrames > 1);
    if (dissolve) {
      const outgoing = dissolve.outgoing, previous = layout.segments[index - 1]!, source = assets.get(outgoing.videoAssetId ?? outgoing.assetId ?? '')!;
      const duration = previous.durationFrames / fps, frames = dissolve.durationFrames;
      // A user fade-out has already reached silence. Do not revive it in a
      // continuation; otherwise preserve the last base gain before crossfading.
      const gain = (outgoing.audio?.fadeOut ?? 0) > 0 ? 0 : audioGainAt(Math.max(0, duration - 1 / fps), duration, outgoing.audio);
      const handle = await visualClip(source, frames, sourceTime(outgoing.trimStart ?? 0, duration, outgoing.speed), frames / fps, { volume: gain }, 1, outgoing.look, 'cut', { audio: [`afade=t=out:st=0:d=${number((frames - 1) / fps)}:curve=tri`] }, outgoing);
      const output = file('dissolve', 'mov');
      const graph = [
        '[0:v:0]setpts=PTS-STARTPTS[base]',
        `[1:v:0]setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:start_frame=0:nb_frames=${frames - 1}:alpha=1[handle]`,
        `[base][handle]overlay=eof_action=pass:repeatlast=0:enable='lt(n,${frames})'[picture]`,
        '[0:a:0]asetpts=PTS-STARTPTS[base-audio]',
        '[1:a:0]asetpts=PTS-STARTPTS[handle-audio]',
        '[base-audio][handle-audio]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[sound]',
      ];
      await encode(['-i', path, '-i', handle, '-filter_complex_script', await graphFile(graph), '-map', '[picture]', '-map', '[sound]', '-frames:v', String(segment.durationFrames), '-t', number(segment.durationFrames / fps), '-c:v', 'libx264', '-preset', 'fast', '-qp', '0', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_f32le', ...movieClock, output], `No se pudo fundir la entrada de «${scene.title}»`);
      path = output;
    }
    baseClips.push(path);
  }
  if (!baseClips.length) throw new Error('Añade al menos un plano antes de exportar.');
  const concatList = file('base', 'txt'), assembled = file('assembled', 'mov');
  await writeFile(concatList, baseClips.map((path) => `file '${basename(path)}'`).join('\n'));
  await encode(['-f', 'concat', '-safe', '1', '-i', concatList, '-c', 'copy', ...movieClock, assembled], 'No se pudo unir el montaje');

  const visual: VisualSource[] = [], audio: AudioSource[] = [];
  const extras = resolveTimelineClips(project);
  async function audioClip(asset: Asset, frames: number, trimFrames: number, logicalDuration: number, settings: ClipAudio | undefined, gain: number, speed = 1) {
    const path = await mediaPath(asset), info = await probe(path), output = file('sound', 'w64');
    await encode([...soundInput(path, info, trimFrames / fps, settings?.muted ? 0 : (settings?.volume ?? 1) * gain), '-map', '0:a:0', '-af', [...speedAudioFilters(speed), ...audioFilters(settings, logicalDuration, gain, fps), 'apad', `atrim=end_sample=${frames * 48000 / fps}`, 'asetpts=PTS-STARTPTS'].join(','), '-t', number(frames / fps), '-c:a', 'pcm_f32le', '-f', 'w64', output], `No se pudo preparar el audio de «${asset.name}»`);
    return output;
  }
  for (const [index, item] of extras.entries()) {
    update(`Preparando pista «${item.track.name}», clip ${index + 1} de ${extras.length}…`, 42 + index / Math.max(1, extras.length) * 23);
    const { clip, track, asset, startFrame, endFrame, sourceStartFrame, durationFrames } = item;
    const gain = track.muted ? 0 : clamp(track.volume), audible = !clip.muted && (clip.volume ?? 1) > 0 && gain > 0 && asset.type !== 'image';
    const visible = track.type === 'video' && ((clip.keyframes?.length ?? 0) > 0 || baseLayerTransform(clip).opacity > 0), logicalDuration = Math.round(clip.duration * fps) / fps;
    if (visible) {
      const path = await visualClip(asset, durationFrames, sourceStartFrame / fps, logicalDuration, clip, gain, 'original', 'cut', {}, { color: clip.color, speed: clip.speed, alpha: true });
      visual.push({ path, startFrame, endFrame, opacity: clip.opacity ?? 1, clip });
      if (audible) audio.push({ path, startFrame });
    } else if (audible) audio.push({ path: await audioClip(asset, durationFrames, sourceStartFrame, logicalDuration, clip, gain, clip.speed), startFrame });
  }
  const soundtrack = project.audioAssetId && assets.get(project.audioAssetId);
  if (soundtrack && (project.audioVolume ?? .5) > 0) audio.push({ path: await audioClip(soundtrack, layout.totalFrames, 0, total, undefined, clamp(project.audioVolume ?? .5, 2)), startFrame: 0 });

  // Process a bounded number of streams at once, including projects with hundreds
  // of clips. Float PCM intermediates retain headroom until the final limiter.
  let mixedAudio = assembled;
  for (let offset = 0; offset < audio.length; offset += 12) {
    const batch = audio.slice(offset, offset + 12), output = file('mix', 'w64'), args = ['-i', mixedAudio];
    const filters = [`[0:a:0]aresample=48000,apad,atrim=end_sample=${layout.totalFrames * 48000 / fps},asetpts=PTS-STARTPTS[a0]`];
    batch.forEach((source, index) => {
      args.push('-i', source.path);
      filters.push(`[${index + 1}:a:0]aresample=48000,asetpts=PTS-STARTPTS,adelay=delays=${source.startFrame * 48000 / fps}S:all=1[a${index + 1}]`);
    });
    filters.push(`${Array.from({ length: batch.length + 1 }, (_, index) => `[a${index}]`).join('')}amix=inputs=${batch.length + 1}:duration=first:dropout_transition=0:normalize=0[mix]`);
    update('Mezclando voces, ambientes y música…', 70);
    await encode([...args, '-filter_complex_script', await graphFile(filters), '-map', '[mix]', '-t', number(total), '-c:a', 'pcm_f32le', '-f', 'w64', output], 'No se pudieron mezclar las pistas de audio');
    mixedAudio = output;
  }

  const cues = resolveSubtitleCues(project);
  if (cues.length) {
    update('Componiendo los subtítulos editados…', 78);
    const boundaries = [...new Set([0, layout.totalFrames, ...cues.flatMap((cue) => [cue.startFrame, cue.endFrame])])].sort((a, b) => a - b);
    const cards = new Map<string, string>(), entries: string[] = [];
    const blank = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    for (let index = 0; index < boundaries.length - 1; index++) {
      check(); const start = boundaries[index]!, end = boundaries[index + 1]!;
      const text = cues.filter((cue) => cue.startFrame <= start && cue.endFrame > start).map((cue) => cue.cue.text).join('\n');
      let path = cards.get(text);
      if (!path) { path = file('subtitle', 'png'); await writeFile(path, text ? await subtitleCard(text, width, height) : blank); cards.set(text, path); }
      entries.push(`file '${basename(path)}'\noption framerate ${fps}\nduration ${number((end - start) / fps)}`);
    }
    const lastText = cues.filter((cue) => cue.startFrame < layout.totalFrames && cue.endFrame === layout.totalFrames).map((cue) => cue.cue.text).join('\n');
    entries.push(`file '${basename(cards.get(lastText) ?? cards.values().next().value!)}'\noption framerate ${fps}`);
    const list = file('subtitles', 'txt'), movie = file('subtitles', 'mov'); await writeFile(list, entries.join('\n'));
    await encode(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps}`, '-frames:v', String(layout.totalFrames), '-c:v', 'qtrle', '-pix_fmt', 'argb', ...movieClock, movie], 'No se pudieron componer los subtítulos');
    visual.push({ path: movie, startFrame: 0, endFrame: layout.totalFrames, opacity: 1 });
  }

  let picture = assembled;
  // UHD has four times the pixels. Compose fewer simultaneous layers to bound
  // decoder/filter buffers on the 36 GB Mac without changing their timing or order.
  const visualBatchSize = width * height > 1920 * 1080 ? 2 : 8;
  for (let offset = 0; offset < visual.length; offset += visualBatchSize) {
    const batch = visual.slice(offset, offset + visualBatchSize), args = ['-i', picture], filters = ['[0:v:0]setpts=PTS-STARTPTS[v0]'];
    batch.forEach((source, index) => {
      args.push('-i', source.path);
      const layer: string[] = ['setpts=PTS-STARTPTS'];
      let x = '0', y = '0';
      if (source.clip) {
        const clip = source.clip, keys = normalizedLayerKeyframes(clip, fps);
        if (keys.length > 1 && keys.some((key) => key.opacity !== keys[0]!.opacity)) {
          layer.push('format=yuva444p', `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*(${transformExpression(clip, 'opacity', 'N', fps)})'`);
        } else layer.push('format=rgba', `colorchannelmixer=aa=${number(keys[0]?.opacity ?? baseLayerTransform(clip).opacity)}`);
        const scale = transformExpression(clip, 'scale', 'n', fps);
        layer.push(`scale=w='max(2,round(iw*(${scale})/2)*2)':h='max(2,round(ih*(${scale})/2)*2)':eval=frame:flags=lanczos`);
        const clock = `(floor(t*${fps}+0.5)-${source.startFrame})`;
        x = `(main_w-overlay_w)/2+main_w*(${transformExpression(clip, 'x', clock, fps)})/100`;
        y = `(main_h-overlay_h)/2+main_h*(${transformExpression(clip, 'y', clock, fps)})/100`;
      } else layer.push('format=rgba', `colorchannelmixer=aa=${number(source.opacity)}`);
      layer.push(`setpts=PTS-STARTPTS+${source.startFrame}/${fps}/TB`);
      filters.push(`[${index + 1}:v:0]${layer.join(',')}[layer${index}]`);
      filters.push(`[v${index}][layer${index}]overlay=x='${x}':y='${y}':eof_action=pass:repeatlast=0:enable='gte(n,${source.startFrame})*lt(n,${source.endFrame})'[v${index + 1}]`);
    });
    const output = file('picture', 'mov'); update('Componiendo las capas de imagen…', 85 + offset / Math.max(1, visual.length) * 9);
    await encode([...args, '-filter_complex_script', await graphFile(filters), '-map', `[v${batch.length}]`, '-an', '-frames:v', String(layout.totalFrames), '-c:v', 'libx264', '-preset', 'fast', '-qp', '0', '-pix_fmt', 'yuv420p', ...movieClock, output], 'No se pudieron componer las capas de video');
    picture = output;
  }
  update('Guardando la película y verificando resolución y duración…', 96);
  await encode(['-i', picture, '-i', mixedAudio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-af', `alimiter=limit=0.95:level=false:latency=true,apad,atrim=end_sample=${layout.totalFrames * 48000 / fps}`, '-t', number(total), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', ...movieClock, '-movflags', '+faststart', destination], 'No se pudo guardar la película');
  const verified = await runProcess(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height,avg_frame_rate:format=duration', '-of', 'json', destination], { signal, timeoutMs: 5 * 60 * 1000 });
  const data = verified.code === 0 ? parseJsonOutput(verified.stdout) : {}, frames = Number(data.streams?.[0]?.nb_read_frames), duration = Number(data.format?.duration);
  if (Number(data.streams?.[0]?.width) !== width || Number(data.streams?.[0]?.height) !== height) throw new Error('La resolución exportada no coincide con la elegida. El archivo no se entregó.');
  const [rateNumerator, rateDenominator = 1] = String(data.streams?.[0]?.avg_frame_rate ?? '').split('/').map(Number);
  if (!Number.isFinite(rateNumerator) || !rateDenominator || Math.abs(rateNumerator! / rateDenominator - fps) > .00001) throw new Error('Los fps exportados no coinciden con los elegidos. El archivo no se entregó.');
  if (frames !== layout.totalFrames || !Number.isFinite(duration) || Math.abs(duration - total) > .12) throw new Error('La duración exportada no coincide con los fotogramas del montaje. El archivo no se entregó.');
}
