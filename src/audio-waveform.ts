import type { Asset, ClipAudio } from './types';
import { audioGainAt } from './multitrack';

export type WaveformData = { assetId: string; duration: number; sampleRate: number; channels: number; peaks: number[]; hasAudio: boolean; cached?: boolean; sourceVersion?: string };
export type WaveformLease = { promise: Promise<WaveformData>; release: () => void };
type FetchWaveform = (input: string, init?: RequestInit) => Promise<Response>;

export function parseWaveform(value: unknown, assetId: string): WaveformData {
  const data = value as WaveformData;
  if (!data || data.assetId !== assetId || typeof data.hasAudio !== 'boolean' || !Number.isFinite(data.duration) || data.duration < 0 || !Array.isArray(data.peaks) || data.peaks.length > 2048 || data.peaks.some((peak) => !Number.isFinite(peak) || peak < 0 || peak > 1) || (data.hasAudio && (!data.peaks.length || data.duration <= 0))) throw new Error('La forma de onda recibida no es válida. Vuelve a intentarlo.');
  return data;
}

/** Bounded shared requests: repeated clips reuse one analysis; abandoned work
 * aborts when its last viewer leaves. Successful results use a small LRU cache. */
export function createWaveformCache(fetcher: FetchWaveform = (input, init) => fetch(input, init), concurrency = 3, capacity = 64) {
  type Entry = { promise: Promise<WaveformData>; controller: AbortController; users: number; complete: boolean };
  const entries = new Map<string, Entry>(), queue: (() => void)[] = []; let active = 0;
  const drain = () => { while (active < concurrency && queue.length) { active++; queue.shift()!(); } };
  const trim = () => { for (const [key, entry] of entries) { if (entries.size <= capacity) break; if (entry.complete && !entry.users) entries.delete(key); } };
  return {
    acquire(asset: Pick<Asset, 'id' | 'url'>): WaveformLease {
      const key = `${asset.id}:${asset.url}`;
      let entry = entries.get(key);
      if (entry) { entries.delete(key); entries.set(key, entry); }
      else {
        const controller = new AbortController();
        let resolve!: (data: WaveformData) => void, reject!: (error: unknown) => void;
        const promise = new Promise<WaveformData>((yes, no) => { resolve = yes; reject = no; });
        entry = { promise, controller, users: 0, complete: false }; entries.set(key, entry);
        const created = entry;
        queue.push(() => {
          (async () => {
            try {
              if (controller.signal.aborted) throw new DOMException('Análisis cancelado', 'AbortError');
              const response = await fetcher(`/api/assets/${encodeURIComponent(asset.id)}/waveform`, { signal: controller.signal });
              if (!response.ok) { let detail = ''; try { const body = await response.json(); detail = typeof body.error === 'string' ? body.error : ''; } catch { /* HTTP status remains meaningful when the response is not JSON. */ } throw new Error(detail || `No se pudo analizar el audio (${response.status}).`); }
              const data = parseWaveform(await response.json(), asset.id); created.complete = true; resolve(data); trim();
            } catch (error) { if (entries.get(key) === created) entries.delete(key); reject(error); }
            finally { active--; drain(); }
          })();
        });
        drain();
      }
      entry.users++; const lease = entry; let released = false;
      return { promise: entry.promise, release() { if (released) return; released = true; lease.users--; if (!lease.users && !lease.complete) { lease.controller.abort(); if (entries.get(key) === lease) entries.delete(key); } trim(); } };
    },
  };
}
export const waveformCache = createWaveformCache();

/** Peak bars are sampled from the actual source interval. No per-file
 * normalization: silence stays silent and gain/fades match the audible mix. */
export function sampleWaveform(data: WaveformData, trimStart: number, visibleDuration: number, bars: number, settings: ClipAudio = {}, trackGain = 1, logicalDuration = visibleDuration, speed = 1) {
  const count = Math.max(1, Math.min(1024, Math.round(bars))), result = new Array<number>(count).fill(0);
  if (!data.hasAudio || !data.peaks.length || data.duration <= 0 || visibleDuration <= 0) return result;
  const binsPerSecond = data.peaks.length / data.duration, gain = Math.max(0, Math.min(1, trackGain));
  const rate = Number.isFinite(speed) ? Math.max(.25, Math.min(4, speed)) : 1;
  for (let index = 0; index < count; index++) {
    const localStart = index / count * visibleDuration, localEnd = (index + 1) / count * visibleDuration;
    const start = trimStart + localStart * rate, end = trimStart + localEnd * rate;
    if (start >= data.duration || end <= 0) continue;
    const first = Math.max(0, Math.floor(start * binsPerSecond)), last = Math.min(data.peaks.length - 1, Math.ceil(end * binsPerSecond) - 1);
    let peak = 0; for (let bin = first; bin <= last; bin++) peak = Math.max(peak, data.peaks[bin]!);
    result[index] = peak * gain * audioGainAt((localStart + localEnd) / 2, logicalDuration, settings);
  }
  return result;
}
