import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, RotateCcw } from 'lucide-react';
import type { Asset, ClipAudio } from '../types';
import { sampleWaveform, waveformCache } from '../audio-waveform';
import type { WaveformData } from '../audio-waveform';
import './audio-waveform.css';

export type AudioWaveformProps = { asset: Asset; trimStart: number; duration: number; logicalDuration?: number; audio?: ClipAudio; trackGain?: number; fps: number; speed?: number; compact?: boolean };
function AudioWaveform({ asset, trimStart, duration, logicalDuration = duration, audio = {}, trackGain = 1, fps, speed = 1, compact = false }: AudioWaveformProps) {
  const [data, setData] = useState<WaveformData | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [width, setWidth] = useState(250);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return; const node = container.current;
    const resize = () => setWidth(Math.max(1, node.clientWidth)); resize(); const observer = new ResizeObserver(resize); observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setData(null); setError(''); let cancelled = false;
    const lease = waveformCache.acquire(asset);
    lease.promise.then((result) => { if (!cancelled) setData(result); }).catch((reason) => { if (!cancelled && reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'No se pudo analizar el audio.'); });
    return () => { cancelled = true; lease.release(); };
  }, [asset.id, asset.url, retry]);
  const bars = useMemo(() => data ? sampleWaveform(data, trimStart, duration, width / 3, { ...audio, fadeIn: Math.round((audio.fadeIn ?? 0) * fps) / fps, fadeOut: Math.round((audio.fadeOut ?? 0) * fps) / fps }, trackGain, logicalDuration, speed) : [], [data, trimStart, duration, width, audio, trackGain, logicalDuration, fps, speed]);
  const silent = data?.hasAudio && !data.peaks.some((peak) => peak > 0), muted = !!audio.muted || !trackGain || audio.volume === 0;
  const description = error ? 'Forma de onda no disponible' : !data ? 'Analizando audio…' : !data.hasAudio ? 'Sin pista de audio' : silent ? 'Audio en silencio' : muted ? 'Audio silenciado' : 'Forma de onda del audio original';
  const shape = bars.map((peak, index) => { const x = (index + .5) / bars.length * 1000, size = peak * 44; return `M${x.toFixed(2)},${(50 - size).toFixed(2)}V${(50 + size).toFixed(2)}`; }).join('');
  return <div className={`audio-waveform ${compact ? 'is-compact' : ''} ${muted ? 'is-muted' : ''}`} ref={container} title={error || description}>
    {data?.hasAudio && <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={description}><path className="waveform-baseline" d="M0,50H1000" /><path d={shape} strokeWidth={Math.max(1, 1000 / Math.max(1, bars.length) * .65)} /></svg>}
    {(!data || !data.hasAudio || silent || error || muted) && <span className="waveform-state" role={compact ? undefined : 'status'}><AudioLines size={compact ? 11 : 15} />{description}{error && !compact && <button type="button" onClick={() => setRetry((value) => value + 1)} aria-label="Volver a analizar el audio"><RotateCcw size={14} />Reintentar</button>}</span>}
    {!compact && data?.hasAudio && !silent && !muted && <span className="waveform-caption">Audio original · entrada {trimStart.toFixed(2)} s · {duration.toFixed(2)} s visibles{speed !== 1 ? ` · ${speed}×` : ''}</span>}
  </div>;
}

export default memo(AudioWaveform);
