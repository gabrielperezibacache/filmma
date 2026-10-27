import{storyContextText}from'./story-structure';
import type { Asset, Project, Scene } from './types';
import { buildTimeline, frameToTimecode } from './timeline';
import { continuityFields, continuityLabels, resolveSceneContinuity } from './continuity';
import { colorMatrix, playbackSpeed } from './visual-effects';
import { CINEMA_FIELDS, cinemaFieldIsActive, historicalDirectionLabel } from './cinematography';

export type StoryboardShot = {
  scene: Scene; index: number; start: string; end: string; duration: number; fps: number;
  source?: Asset; sourceId?: string; sourceLabel: string;
  characters: string[]; continuity: string[];storyContext:string;
};
export type StoryboardThumbnail = { status: 'ready' | 'failed' | 'cancelled'; dataUrl?: string; sourceTime?: number; message?: string };
export type StoryboardThumbnails = Record<string, StoryboardThumbnail>;

/** A missing selected take must remain missing, rather than silently show its reference. */
export function storyboardSource(project: Project, scene: Scene): Asset | undefined {
  const id = scene.videoAssetId || scene.assetId;
  return project.assets.find(asset => asset.id === id && (asset.type === 'video' || asset.type === 'image'));
}

export function storyboardSampleTime(scene: Scene, fps: number, sourceDuration?: number, sourceFps = fps) {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 24;
  const frames = Math.max(1, Math.round((Number.isFinite(scene.duration) ? scene.duration : 1) * rate));
  const editedTime = Math.min(frames - 1, Math.round(frames / 2)) / rate;
  const trim = Math.max(0, Number.isFinite(scene.trimStart) ? scene.trimStart! : 0);
  const time = trim + editedTime * playbackSpeed(scene.speed);
  const frameRate = Number.isFinite(sourceFps) && sourceFps > 0 ? sourceFps : rate;
  return sourceDuration !== undefined && Number.isFinite(sourceDuration)
    ? Math.min(time, Math.max(0, sourceDuration - 1 / frameRate)) : time;
}

export function buildStoryboard(project: Project): StoryboardShot[] {
  const layout = buildTimeline(project);
  return layout.segments.map(({ scene, index, startFrame, endFrame, durationFrames }) => {
    const source = storyboardSource(project, scene);
    const appearances = resolveSceneContinuity(project, scene.id);
    const known = new Map(appearances.map(({ character }) => [character.id, character.name]));
    return {
      scene, index, storyContext:storyContextText(project,scene.id),start: frameToTimecode(startFrame, layout.fps), end: frameToTimecode(endFrame, layout.fps),
      duration: durationFrames / layout.fps, fps: layout.fps, source, sourceId: scene.videoAssetId || scene.assetId,
      sourceLabel: !source ? scene.videoAssetId || scene.assetId ? 'Fuente seleccionada no disponible' : 'Sin imagen ni toma asignada'
        : source.type === 'image' ? 'Imagen de referencia en montaje'
          : source.enhancement?.preset === 'ai-4k' ? 'Versión IA seleccionada' : source.enhancement ? 'Versión mejorada seleccionada' : 'Toma seleccionada',
      characters: scene.characterIds.map(id => known.get(id) ?? 'Elemento no disponible'),
      continuity: appearances.flatMap(({ character, state }) => {
        const notes = continuityFields.filter(field => state.values[field].trim()).map(field => `${continuityLabels[field]}: ${state.values[field]}`);
        if (state.intentionalChange) notes.push(`Cambio intencional: ${state.changeReason || 'Sin motivo anotado'}`);
        return notes.length ? [`${character.name}\n${notes.join('\n')}`] : [];
      }),
    };
  });
}

export function storyboardLook(scene: Scene) {
  return scene.look === 'noir' ? 'grayscale(1) contrast(1.08) ' : scene.look === 'warm' ? 'sepia(.15) saturate(.85) ' : '';
}

export const storyboardEscapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/** Quotes preserve cells/newlines; the prefix prevents spreadsheet formula execution. */
export function storyboardCsvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}

export function storyboardCinematography(scene: Scene) {
  const values = scene.cinematography;
  return CINEMA_FIELDS.flatMap(field => {
    if (field.key === 'era') {
      const label = historicalDirectionLabel(values);
      return label ? [label, ...(values?.historicalContext?.notes?.trim() ? [`Notas de época: ${values.historicalContext.notes.trim()}`] : [])] : [];
    }
    if (!cinemaFieldIsActive(values, field.key)) return [];
    const option = field.options.find(option => option.value === values?.[field.key]);
    return option ? [`${field.label}: ${option.label}`] : [];
  });
}

export function storyboardDirection(scene: Scene) {
  return [...(!scene.cinematography?.framing && !scene.cinematography?.movement && scene.camera ? [`Dirección libre: ${scene.camera}`] : []), ...storyboardCinematography(scene)];
}

export function storyboardCsv(project: Project, thumbnails: StoryboardThumbnails = {}) {
  const headings = ['Plano', 'Título', 'Entrada', 'Salida', 'Duración (s)', 'FPS', 'Fuente', 'Archivo seleccionado', 'Instante de fuente (s)', 'Miniatura', 'Dirección libre vigente', 'Cinematografía', 'Acción', 'Diálogo / voz', 'Personajes y objetos', 'Continuidad', 'Intención del plano','Escena y secuencia'];
  const rows = buildStoryboard(project).map(shot => {
    const thumbnail = thumbnails[shot.scene.id];
    return [shot.index + 1, shot.scene.title, shot.start, shot.end, Number(shot.duration.toFixed(6)), shot.fps, shot.sourceLabel, shot.source?.name ?? '', thumbnail?.sourceTime?.toFixed(3) ?? '', thumbnail?.status === 'ready' ? 'Disponible' : thumbnail?.message ?? 'No calculada', !shot.scene.cinematography?.framing && !shot.scene.cinematography?.movement ? shot.scene.camera : '', storyboardCinematography(shot.scene).join('\n'), shot.scene.description, shot.scene.dialogue, shot.characters.join('; '), shot.continuity.join('\n\n'), shot.scene.prompt,shot.storyContext];
  });
  return '\uFEFF' + [headings, ...rows].map(row => row.map(storyboardCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function storyboardImageData(thumbnail?: StoryboardThumbnail) {
  return thumbnail?.status === 'ready' && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*$/.test(thumbnail.dataUrl ?? '') ? thumbnail.dataUrl : undefined;
}

export function storyboardHtml(project: Project, thumbnails: StoryboardThumbnails) {
  const e = storyboardEscapeHtml, shots = buildStoryboard(project), total = buildTimeline(project);
  const paragraph = (title: string, text: string) => text.trim() ? `<section><h3>${e(title)}</h3><p>${e(text)}</p></section>` : '';
  const cards = shots.map(shot => {
    const thumbnail = thumbnails[shot.scene.id], data = storyboardImageData(thumbnail), filterId = `shot-color-${shot.index}`;
    const source = `${shot.sourceLabel}${shot.source?.name ? ` · ${shot.source.name}` : ''}${thumbnail?.sourceTime !== undefined ? ` · fuente ${thumbnail.sourceTime.toFixed(3)} s` : ''}`;
    return `<article><header><span>Plano ${String(shot.index + 1).padStart(2, '0')}</span><span>${e(shot.start)} — ${e(shot.end)} · ${shot.duration.toFixed(2)} s</span></header><h2>${e(shot.scene.title || 'Plano sin título')}</h2>
      <figure>${data ? `<svg width="0" height="0" aria-hidden="true"><defs><filter id="${filterId}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${colorMatrix(shot.scene.color).join(' ')}"/></filter></defs></svg><img src="${data}" alt="${e(`Muestra de ${shot.scene.title}`)}" style="filter:${storyboardLook(shot.scene)}url(#${filterId})">` : `<div class="missing">${e(thumbnail?.message || 'Sin miniatura disponible')}</div>`}<figcaption>${e(source)}</figcaption></figure>
      ${paragraph('Escena y secuencia',shot.storyContext)}${paragraph('Dirección', storyboardDirection(shot.scene).join('\n'))}
      ${paragraph('Acción', shot.scene.description)}${paragraph('Diálogo / voz', shot.scene.dialogue)}${paragraph('Personajes y objetos', shot.characters.join(' · '))}
      ${paragraph('Continuidad prevista', shot.continuity.join('\n\n'))}${paragraph('Intención del plano', shot.scene.prompt)}</article>`;
  }).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(project.name)} · Storyboard</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eeeede;color:#202421;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px}h1{font:400 42px/1.15 Georgia,serif;letter-spacing:-.025em;margin:0 0 12px}h2{font:400 26px/1.2 Georgia,serif;margin:14px 0}h3{font-size:12px;margin:18px 0 5px}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.intro{max-width:75ch}.facts{margin:16px 0;color:#4d574d}.notice{margin:20px 0 32px;max-width:80ch;font-size:13px}.shots{display:grid;grid-template-columns:1fr 1fr;gap:34px 28px}article{min-width:0;border-top:1px solid #8a9585;padding:16px 0;break-inside:avoid}header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font:11px/1.5 monospace;color:#4d574d}figure{margin:0;position:relative}figure>svg{position:absolute}img{display:block;width:100%;height:260px;object-fit:contain;background:#171a19}figcaption{font-size:11px;line-height:1.6;margin:9px 0 18px;overflow-wrap:anywhere}.missing{height:180px;display:grid;place-items:center;padding:20px;background:#e2e5d9;color:#4d574d}.footer{border-top:1px solid #8a9585;margin-top:32px;padding-top:16px;font-size:12px}@media(max-width:700px){main{padding:24px 18px}.shots{grid-template-columns:1fr}h1{font-size:34px}}@media print{@page{size:A4;margin:14mm}body{background:white;font-size:10pt}main{padding:0;max-width:none}h1{font-size:26pt}h2{font-size:17pt}.shots{display:block}article{margin-bottom:8mm}figure{float:left;width:48%;margin:0 5% 3mm 0}img{height:auto;max-height:65mm}article:after{content:'';display:block;clear:both}.notice{font-size:9pt}h3{font-size:9pt}p{orphans:3;widows:3}.footer{font-size:9pt}}
  </style></head><body><main><h1>${e(project.name)}</h1><p class="intro">${e(project.logline)}</p><p class="facts">Storyboard · ${shots.length} planos · ${e(frameToTimecode(total.totalFrames, total.fps))} · ${total.fps} fps · ${e(project.format)}</p><p class="notice">Muestras de las fuentes seleccionadas, con look y color de previsualización. No incluye capas, transiciones ni subtítulos. Las imágenes de referencia se identifican expresamente. Este documento conserva el guion y la continuidad previstos; no certifica identidad visual. Para guardarlo como PDF, abre Imprimir en tu navegador.</p><div class="shots">${cards || '<p>No hay planos en este proyecto.</p>'}</div><p class="footer">Filmma · Copia de consulta independiente. Miniaturas de hasta 720 px por lado; originales sin modificar. Cambios posteriores en Filmma no actualizan esta hoja.</p></main></body></html>`;
}

/** Serial decoding bounds working memory to one source; failures never substitute another asset. */
export async function collectStoryboardThumbnails(shots: StoryboardShot[], load: (shot: StoryboardShot, signal: AbortSignal) => Promise<StoryboardThumbnail>, signal: AbortSignal, onItem?: (id: string, value: StoryboardThumbnail, completed: number) => void) {
  const result: StoryboardThumbnails = {};
  for (const [index, shot] of shots.entries()) {
    if (signal.aborted) break;
    let value: StoryboardThumbnail;
    try { value = shot.source ? await load(shot, signal) : { status: 'failed', message: shot.sourceLabel }; }
    catch (error) {
      if (signal.aborted) break;
      value = { status: 'failed', message: error instanceof Error ? error.message : 'No se pudo leer la fuente seleccionada.' };
    }
    if (signal.aborted) break;
    result[shot.scene.id] = value; onItem?.(shot.scene.id, value, index + 1);
  }
  return result;
}

function waitForMedia(target: HTMLMediaElement | HTMLImageElement, event: string, signal: AbortSignal, ready: () => boolean) {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelado', 'AbortError'));
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, success); target.removeEventListener('error', failure); signal.removeEventListener('abort', abort); };
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error('No se pudo leer la fuente seleccionada. Ábrela en el editor y vuelve a intentarlo.')); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelado', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('La fuente tardó demasiado en responder. Puedes reintentar las miniaturas.')); }, 20000);
    target.addEventListener(event, success, { once: true }); target.addEventListener('error', failure, { once: true }); signal.addEventListener('abort', abort, { once: true });
  });
}

/** Native browser decoding only reads the local media. Nothing is uploaded or written to the original. */
export async function captureStoryboardThumbnail(shot: StoryboardShot, signal: AbortSignal): Promise<StoryboardThumbnail> {
  if (!shot.source) return { status: 'failed', message: shot.sourceLabel };
  const url = new URL(shot.source.url, window.location.href);
  if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('La miniatura necesita una fuente importada en la biblioteca local.');
  const canvas = document.createElement('canvas');
  const draw = (source: CanvasImageSource, width: number, height: number, sourceTime?: number) => {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
    if (!(width > 0 && height > 0)) throw new Error('La fuente seleccionada no contiene una imagen legible.');
    const scale = Math.min(1, 720 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no pudo preparar la miniatura.');
    context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { status: 'ready' as const, dataUrl: canvas.toDataURL('image/jpeg', .88), sourceTime };
  };
  if (shot.source.type === 'image') {
    const image = new Image();
    try {
      const loaded = waitForMedia(image, 'load', signal, () => image.complete && image.naturalWidth > 0);
      image.src = url.href; await loaded;
      return draw(image, image.naturalWidth, image.naturalHeight);
    } finally { image.removeAttribute('src'); canvas.width = canvas.height = 1; }
  }
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    const metadata = waitForMedia(video, 'loadedmetadata', signal, () => video.readyState >= 1);
    video.src = url.href; video.load(); await metadata;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('No se pudo determinar la duración de la toma seleccionada.');
    const target = storyboardSampleTime(shot.scene, shot.fps, video.duration, shot.source.enhancement?.fps);
    if (Math.abs(video.currentTime - target) > .00001) {
      const seek = waitForMedia(video, 'seeked', signal, () => false); video.currentTime = target; await seek;
    }
    await waitForMedia(video, 'loadeddata', signal, () => video.readyState >= 2);
    return draw(video, video.videoWidth, video.videoHeight, video.currentTime);
  } finally { video.pause(); video.removeAttribute('src'); video.load(); canvas.width = canvas.height = 1; }
}
