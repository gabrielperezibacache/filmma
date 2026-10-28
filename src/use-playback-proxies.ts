import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Job, Project } from './types';
export type PlaybackProxy = {
    assetId: string;
    name: string;
    status: 'ready' | 'missing';
    url?: string;
    key?: string;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
    frames?: number;
    bytes?: number;
};
export function playbackSource(asset: Asset, items: PlaybackProxy[], enabled: boolean, failed: string[] = []) { const p = items.find(x => x.assetId === asset.id && x.status === 'ready' && x.url && x.key && !failed.includes(x.key)); return enabled && asset.type === 'video' && p?.url ? p.url : asset.url; }
export function usePlaybackProxies(project: Project | null, jobs: Job[]) {
    const [enabled, setEnabled] = useState(true), [state, setState] = useState<{
        projectId: string;
        items: PlaybackProxy[];
    }>({ projectId: '', items: [] }), [error, setError] = useState(''), [failed, setFailed] = useState<string[]>([]), [preparing, setPreparing] = useState(false);
    const epoch = useRef(0);
    const sourceKey = JSON.stringify([project?.id, project?.assets.filter(a => a.type === 'video').map(a => [a.id, a.url, a.size]), project?.scenes.map(s => [s.id, s.videoAssetId ?? s.assetId]), project?.tracks?.map(t => t.clips.map(c => c.assetId))]);
    const work = jobs.filter(j => j.type === 'proxy' && j.result?.projectId === project?.id), jobKey = JSON.stringify(work.map(j => [j.id, j.status]));
    const refresh = useCallback(async () => { if (!project)
        return; const version = ++epoch.current; try {
        const r = await fetch('/api/playback/proxies');
        if (!r.ok)
            throw Error('No se pudo consultar la reproducción ligera.');
        const data = await r.json();
        if (version === epoch.current && data.projectId === project.id) {
            setState(data);
            setError('');
        }
    }
    catch (e) {
        if (version === epoch.current)
            setError((e as Error).message);
    } }, [project?.id]);
    useEffect(() => { void refresh(); return () => { epoch.current++; }; }, [sourceKey, jobKey, refresh]);
    useEffect(() => { setFailed([]); setError(''); }, [project?.id]);
    const items = state.projectId === project?.id ? state.items : [];
    const source = useCallback((asset: Asset) => playbackSource(asset, items, enabled, failed), [items, enabled, failed]);
    const onError = useCallback((asset: Asset, url: string) => { if (url !== asset.url) {
        const p = items.find(x => x.url === url);
        if (p?.key) {
            setFailed(old => old.includes(p.key!) ? old : [...old, p.key!]);
            setError('Una copia no pudo reproducirse. Se recuperó el original; vuelve a preparar o usa Original.');
        }
    } }, [items]);
    const prepare = async () => { if (!project || preparing)
        return; setPreparing(true); try {
        const r = await fetch('/api/playback/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filmma-Client': 'filmma' }, body: JSON.stringify({ projectId: project.id }) });
        const body = await r.json();
        if (!r.ok)
            throw Error(body.error ?? 'No se pudo preparar la reproducción.');
        setError('');
        setFailed([]);
        return body.job as Job;
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setPreparing(false);
    } };
    return { enabled, setEnabled, items, source, onError, error, prepare, refresh, preparing, active: work.find(j => j.status === 'queued' || j.status === 'running'), last: work[0] };
}
