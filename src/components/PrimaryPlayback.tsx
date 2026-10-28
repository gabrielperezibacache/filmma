import { useEffect, useId, useRef, useState } from 'react';
import type { Asset, Project, Scene } from '../types';
import { buildTimeline } from '../timeline';
import { audioGainAt } from '../multitrack';
import { audioOnFrameGrid, syncMediaClock } from '../playback';
import { playbackSpeed, sourceTime } from '../visual-effects';
import { resolveSceneTransitions, sceneTransitionGain } from '../transitions';
import ColorFilter from './ColorFilter';
export type PlaybackStats = {
    sceneId: string;
    source: 'copy' | 'original';
    counted: number;
    dropped: number;
    seconds: number;
    available: boolean;
};
type SourceProps = {
    project: Project;
    scene: Scene;
    asset: Asset;
    active: boolean;
    playhead: number;
    playing: boolean;
    source: (a: Asset) => string;
    onSourceError: (a: Asset, url: string) => void;
    onBlocked: () => void;
    audible: boolean;
    bypass: boolean;
    onStats: (s: PlaybackStats) => void;
};
function Source({ project, scene, asset, active, playhead, playing, source, onSourceError, onBlocked, audible, bypass, onStats }: SourceProps) {
    const ref = useRef<HTMLVideoElement>(null), id = `primary-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`, [failed, setFailed] = useState(false), url = source(asset), copy = url !== asset.url;
    const shot = buildTimeline(project).segments.find(s => s.scene.id === scene.id)!, local = active ? Math.max(0, playhead - shot.startFrame / project.fps) : 0, rate = playbackSpeed(scene.speed), frame = Math.floor(playhead * project.fps + 1e-6), gain = active && audible ? audioGainAt(local, shot.durationFrames / project.fps, audioOnFrameGrid(scene.audio ?? {}, project.fps)) * sceneTransitionGain(resolveSceneTransitions(project), scene.id, frame) : 0;
    const position = useRef({ time: 0, playing: false, volume: 0, fps: project.fps, rate });
    position.current = { time: sourceTime(scene.trimStart, local, scene.speed), playing: active && playing, volume: gain, fps: project.fps, rate };
    const sync = () => { if (ref.current)
        syncMediaClock(ref.current, position.current, onBlocked); };
    useEffect(sync, [playhead, active, playing, gain, url, scene.trimStart, rate, project.fps]);
    useEffect(() => { setFailed(false); }, [url]);
    useEffect(() => { const node = ref.current; return () => node?.pause(); }, [url]);
    useEffect(()=>{if(active&&asset.type==='video')onStats({sceneId:scene.id,source:copy?'copy':'original',counted:0,dropped:0,seconds:0,available:typeof ref.current?.getVideoPlaybackQuality==='function'})},[active,url,scene.id,onStats,asset.type]);
    useEffect(()=>{if(!active||!playing||asset.type!=='video')return;const video=ref.current;if(!video)return;const available=typeof video.getVideoPlaybackQuality==='function',start=performance.now(),base=available?video.getVideoPlaybackQuality():null;const report=()=>{const q=available?video.getVideoPlaybackQuality():null;onStats({sceneId:scene.id,source:copy?'copy':'original',counted:q&&base?Math.max(0,q.totalVideoFrames-base.totalVideoFrames-(q.droppedVideoFrames-base.droppedVideoFrames)):0,dropped:q&&base?Math.max(0,q.droppedVideoFrames-base.droppedVideoFrames):0,seconds:(performance.now()-start)/1000,available})};const timer=setInterval(report,500);return()=>{clearInterval(timer);report()}},[active,playing,url,scene.id,onStats,asset.type]);
    const filter = `${bypass ? '' : scene.look === 'noir' ? 'grayscale(1) contrast(1.08) ' : scene.look === 'warm' ? 'sepia(.15) saturate(.85) ' : ''}url(#${id})`;
    return <div className={`primary-playback-source ${active ? 'is-current' : 'is-preloaded'}`} aria-hidden={!active} data-shot-id={scene.id} data-source-kind={copy ? 'copy' : 'original'}><ColorFilter id={id} color={bypass ? undefined : scene.color}/>{asset.type === 'video' ? <video key={url} ref={ref} src={url} playsInline preload={active || copy ? 'auto' : 'metadata'} onLoadedMetadata={sync} onCanPlay={sync} style={{ filter }} onError={() => { onSourceError(asset, url); if (url === asset.url)
        setFailed(true); }}/> : <img src={url} style={{ filter }} alt={active ? scene.description || scene.title : ''} onError={() => setFailed(true)}/>}{active && failed && <span className="layer-error">No se pudo leer {asset.name}. Comprueba el original en la biblioteca.</span>}</div>;
}
/** Reuse the preloaded next node when it becomes current. At most two base
 * sources are mounted; originals remain the source for export and analysis. */
export default function PrimaryPlayback(props: Omit<SourceProps, 'scene' | 'asset' | 'active'> & {
    sceneId: string;
}) { const index = props.project.scenes.findIndex(s => s.id === props.sceneId); return <>{props.project.scenes.slice(Math.max(0, index), Math.max(0, index) + 2).map((s, i) => { const asset = props.project.assets.find(a => a.id === (s.videoAssetId ?? s.assetId)); return asset && asset.type !== 'audio' ? <Source key={`${props.project.id}:${s.id}:${asset.id}`} {...props} scene={s} asset={asset} active={i === 0}/> : null; })}</>; }
