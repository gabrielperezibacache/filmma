import { ImageOff } from 'lucide-react';
import type { StoryboardShot, StoryboardThumbnails } from '../storyboard';
import { storyboardFrameEntries, storyboardImageData, storyboardLook } from '../storyboard';
import ColorFilter from './ColorFilter';
import { tr, t } from '../i18n';
import './fourth-delivery.css';
export default function StoryboardFrames({ shot, thumbnails, preparing, cancelled, view }: {
    shot: StoryboardShot;
    thumbnails: StoryboardThumbnails;
    preparing: boolean;
    cancelled: boolean; view: 'middle' | 'bookends';
}) { const frames = storyboardFrameEntries(shot, thumbnails,view); return <div className={`storyboard-frame-set ${frames.length > 1 ? 'is-pair' : ''}`}>{frames.map(({ role, label, key, thumbnail }) => { const data = storyboardImageData(thumbnail), filterId = `storyboard-color-${shot.index}-${role}`; return <figure key={key} data-sample-role={role}><div className="storyboard-frame-label">{t(label)}</div><div className="storyboard-picture"><ColorFilter id={filterId} color={shot.scene.color}/>{data ? <img src={data} alt={`${t(label)} · ${shot.scene.title}`} style={{ filter: `${storyboardLook(shot.scene)}url(#${filterId})` }}/> : <div className="storyboard-missing"><ImageOff size={22}/><p>{thumbnail?.message ?? (preparing ? tr('Preparando esta muestra…', 'Preparing this sample…') : cancelled ? tr('Muestra no calculada', 'Sample not prepared') : shot.sourceLabel)}</p></div>}</div><figcaption><span>{t(shot.sourceLabel)}</span>{shot.source && <span>{shot.source.name}{thumbnail?.sourceTime !== undefined ? ` · ${tr('fuente', 'source')} ${thumbnail.sourceTime.toFixed(4)} s` : ''}</span>}{thumbnail?.limited && <span>{tr('Limitado por el final del original; revisa recorte y duración.', 'Limited by the end of the original; review trim and duration.')}</span>}</figcaption></figure>; })}</div>; }
