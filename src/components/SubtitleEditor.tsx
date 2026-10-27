import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Clock3, Download, FileText, Plus, Subtitles, Trash2, X } from 'lucide-react';
import type { Project, SubtitleCue } from '../types';
import { buildTimeline, frameFromSeconds, frameToTimecode, segmentAtFrame } from '../timeline';
import { cuesFromDialogue, dialogueSourceSignature, exportSubtitlesSrt, MAX_SUBTITLE_CUES, MAX_SUBTITLE_TEXT, replaceSceneSubtitleCues, resolveSubtitleCues, subtitleIssues } from '../subtitles';
import './SubtitleEditor.css';

export type SubtitleEditorProps = {
  project:Project;
  selectedSceneId:string;
  playhead:number;
  onUpdate:(updater:(current:Project)=>Project,group?:string)=>void;
  onSeek:(seconds:number,sceneId?:string)=>void;
  onSelectScene?:(sceneId:string)=>void;
};
type Proposal={projectId:string;sceneId:string;source:string;durationFrames:number;fps:number;previous:string;cues:SubtitleCue[]};
const decimal=(seconds:number)=>Number(seconds.toFixed(4)).toString();

function CueTime({label,value,min,max,fps,onChange,onError}:{label:string;value:number;min:number;max:number;fps:number;onChange:(seconds:number)=>void;onError:(message:string)=>void}) {
  const [draft,setDraft]=useState(decimal(value));
  useEffect(()=>setDraft(decimal(value)),[value]);
  const commit=()=>{
    const input=Number(draft.replace(',','.')),rounded=Math.round(input*fps)/fps;
    if(!draft.trim()||!Number.isFinite(rounded)||rounded<min-1e-8||rounded>max+1e-8){setDraft(decimal(value));onError(`«${label}» debe estar entre ${decimal(min)} y ${decimal(max)} segundos.`);return;}
    setDraft(decimal(rounded));if(rounded!==value)onChange(rounded);
  };
  return <label className="se-time-field"><span>{label}</span><div><input aria-label={label} type="text" inputMode="decimal" value={draft} onChange={(event)=>setDraft(event.target.value)} onBlur={commit} onKeyDown={(event)=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}if(event.key==='Escape'){event.preventDefault();setDraft(decimal(value));}}}/><span>s</span></div></label>;
}

export default function SubtitleEditor({project,selectedSceneId,playhead,onUpdate,onSeek,onSelectScene}:SubtitleEditorProps){
  const instance=useId(),currentProject=useRef(project),textRef=useRef<HTMLTextAreaElement>(null),proposalRef=useRef<HTMLElement>(null);
  currentProject.current=project;
  const [scope,setScope]=useState<'scene'|'all'>('scene'),[selectedId,setSelectedId]=useState('');
  const [proposal,setProposal]=useState<Proposal|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const layout=useMemo(()=>buildTimeline(project),[project.scenes,project.fps]),fps=layout.fps,frame=frameFromSeconds(playhead,fps,layout.totalFrames);
  const selectedScene=project.scenes.find((scene)=>scene.id===selectedSceneId),cues=project.subtitleCues??[];
  const resolved=useMemo(()=>resolveSubtitleCues(project,{includeDisabled:true}),[project]);
  const issues=useMemo(()=>subtitleIssues(project),[project]);
  const anchorMap=new Map(layout.segments.map((segment)=>[segment.scene.id,segment]));
  const visible=cues.filter((cue)=>scope==='all'||cue.sceneId===selectedSceneId).slice().sort((left,right)=>(anchorMap.get(left.sceneId)?.startFrame??Infinity)+left.start*fps-((anchorMap.get(right.sceneId)?.startFrame??Infinity)+right.start*fps));
  const selected=visible.find((cue)=>cue.id===selectedId)??visible[0],anchor=selected?anchorMap.get(selected.sceneId):undefined;
  const selectedIssues=selected?issues.filter((issue)=>issue.cueId===selected.id):[],effective=resolved.find((item)=>item.cue.id===selected?.id);
  const enabled=project.subtitlesEnabled??project.subtitleCues!==undefined;
  const selectedSceneCues=cues.filter((cue)=>cue.sceneId===selectedSceneId);
  const linked=anchor?project.characters.filter((character)=>anchor.scene.characterIds.includes(character.id)):[];
  const secondsIntoSelected=anchor?(frame-anchor.startFrame)/fps:0;
  const tc=(value:number)=>frameToTimecode(value,fps);
  const fail=(cause:unknown)=>setError(cause instanceof Error?cause.message:'No se pudo actualizar el subtítulo.');
  useEffect(()=>{setProposal(null);setError('');setNotice('');setSelectedId('');},[project.id]);
  useEffect(()=>{if(scope==='scene'&&selectedId&&!project.subtitleCues?.some((cue)=>cue.id===selectedId&&cue.sceneId===selectedSceneId))setSelectedId('');},[selectedSceneId,scope]);
  useEffect(()=>{if(proposal)proposalRef.current?.focus();},[proposal]);

  const edit=(patch:Partial<SubtitleCue>,group?:string)=>{
    if(!selected)return;
    const id=selected.id;
    onUpdate((current)=>current.id===project.id?{...current,subtitleCues:(current.subtitleCues??[]).map((cue)=>cue.id===id?{...cue,...patch}:cue)}:current,group??`subtitle:${id}:${Object.keys(patch).sort().join(',')}`);setError('');
  };
  const choose=(cue:SubtitleCue)=>{setSelectedId(cue.id);onSelectScene?.(cue.sceneId);const item=resolved.find((entry)=>entry.cue.id===cue.id),start=anchorMap.get(cue.sceneId)?.startFrame??0;onSeek((item?.startFrame??start)/fps,cue.sceneId);};
  const add=()=>{
    if(cues.length>=MAX_SUBTITLE_CUES){setError('El proyecto ya tiene 1.000 subtítulos. Elimina alguno antes de añadir otro.');return;}
    const target=segmentAtFrame(layout,Math.min(frame,Math.max(0,layout.totalFrames-1)));
    if(!target)return;
    const start=Math.max(0,Math.min(target.durationFrames-1,frame-target.startFrame)),end=Math.min(target.durationFrames,start+fps*2);
    const cue:SubtitleCue={id:crypto.randomUUID(),sceneId:target.scene.id,start:start/fps,end:end/fps,text:''};
    onUpdate((current)=>current.id===project.id&&(current.subtitleCues?.length??0)<MAX_SUBTITLE_CUES?{...current,subtitleCues:[...(current.subtitleCues??[]),cue],subtitlesEnabled:current.subtitlesEnabled??true}:current);
    setSelectedId(cue.id);onSelectScene?.(cue.sceneId);onSeek((target.startFrame+start)/fps,cue.sceneId);setError('');setNotice('Subtítulo creado en la posición del cabezal. Escribe su texto.');
    requestAnimationFrame(()=>textRef.current?.focus());
  };
  const remove=()=>{
    if(!selected)return;
    const id=selected.id;onUpdate((current)=>current.id===project.id?{...current,subtitleCues:(current.subtitleCues??[]).filter((cue)=>cue.id!==id)}:current);setSelectedId('');setNotice('Subtítulo eliminado. Puedes recuperarlo con Deshacer.');setError('');
  };
  const makeProposal=()=>{
    if(!selectedScene)return;
    try{
      const next=cuesFromDialogue(selectedScene,fps,project.characters);
      if(!next.length)throw new Error('Escribe diálogo en este plano antes de crear subtítulos.');
      setProposal({projectId:project.id,sceneId:selectedScene.id,source:dialogueSourceSignature(selectedScene.dialogue),durationFrames:Math.round(selectedScene.duration*fps),fps,previous:JSON.stringify(selectedSceneCues),cues:next});setError('');setNotice('');
    }catch(cause){fail(cause);}
  };
  const acceptProposal=()=>{
    if(!proposal)return;
    try{
      const current=currentProject.current,scene=current.scenes.find((item)=>item.id===proposal.sceneId);
      if(current.id!==proposal.projectId||!scene)throw new Error('El proyecto o el plano cambiaron. Vuelve a preparar la propuesta.');
      if(dialogueSourceSignature(scene.dialogue)!==proposal.source||current.fps!==proposal.fps||Math.round(scene.duration*current.fps)!==proposal.durationFrames||JSON.stringify((current.subtitleCues??[]).filter((cue)=>cue.sceneId===scene.id))!==proposal.previous)throw new Error('El guion, los tiempos o los subtítulos cambiaron durante la revisión. Prepara de nuevo la propuesta.');
      let applied=false;
      onUpdate((latest)=>{
        const latestScene=latest.scenes.find((item)=>item.id===proposal.sceneId);
        if(latest.id!==current.id||!latestScene||dialogueSourceSignature(latestScene.dialogue)!==proposal.source||latest.fps!==proposal.fps||Math.round(latestScene.duration*latest.fps)!==proposal.durationFrames||JSON.stringify((latest.subtitleCues??[]).filter((cue)=>cue.sceneId===scene.id))!==proposal.previous)throw new Error('El plano cambió durante la revisión. Prepara de nuevo la propuesta.');
        const next={...replaceSceneSubtitleCues(latest,scene.id,proposal.cues),subtitlesEnabled:latest.subtitlesEnabled??true};applied=true;return next;
      });
      if(!applied)return;
      setSelectedId(proposal.cues[0]?.id??'');onSelectScene?.(scene.id);setScope('scene');setProposal(null);setError('');setNotice(`${proposal.cues.length===1?'Se incorporó 1 subtítulo':`Se incorporaron ${proposal.cues.length} subtítulos`} en este plano. Revisa su ritmo con el visor.`);
    }catch(cause){fail(cause);}
  };
  const alignToHead=(edge:'start'|'end')=>{
    if(!selected||!anchor)return;
    const value=Math.round(secondsIntoSelected*fps)/fps;
    if(value<0||value>anchor.durationFrames/fps||edge==='start'&&value>=selected.end||edge==='end'&&value<=selected.start){setError('Sitúa el cabezal dentro de este plano y conserva al menos un fotograma de subtítulo.');return;}
    edit({[edge]:value});
  };
  const download=()=>{
    const srt=exportSubtitlesSrt(project);
    if(!srt){setError('Añade texto a los subtítulos antes de descargar el SRT.');return;}
    const url=URL.createObjectURL(new Blob([srt],{type:'application/x-subrip;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`${project.name.replace(/[\\/:*?"<>|]/g,'-')||'Filmma'}.srt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('SRT preparado con los tiempos actuales del montaje.');setError('');
  };

  return <section className="subtitle-editor" aria-labelledby={`${instance}-title`}>
    <header className="se-heading"><div><h2 id={`${instance}-title`}><Subtitles size={20}/>Cada palabra, a tiempo.</h2><p>Edita el texto y sus entradas sin cambiar el diálogo del guion.</p></div><label className="se-enabled"><input type="checkbox" checked={enabled} onChange={(event)=>{const value=event.target.checked;onUpdate((current)=>({...current,subtitlesEnabled:value}));}}/><span>Mostrar en visor y MP4<small>El SRT se descarga por separado.</small></span></label></header>
    {error&&<div className="se-message se-error" role="alert"><AlertCircle size={17}/><p>{error}</p><button aria-label="Cerrar error de subtítulos" onClick={()=>setError('')}><X size={17}/></button></div>}
    {notice&&<div className="se-message" role="status"><Check size={17}/><p>{notice}</p><button aria-label="Cerrar aviso de subtítulos" onClick={()=>setNotice('')}><X size={17}/></button></div>}
    {proposal&&<section className="se-proposal" ref={proposalRef} tabIndex={-1} aria-labelledby={`${instance}-proposal`}>
      <div className="se-proposal-heading"><h3 id={`${instance}-proposal`}>Revisa el desglose del diálogo.</h3><button aria-label="Cancelar propuesta de subtítulos" onClick={()=>setProposal(null)}><X size={18}/></button></div>
      <p>{(project.subtitleCues??[]).some((cue)=>cue.sceneId===proposal.sceneId)?'Al confirmar, se reemplazarán los subtítulos de este plano, incluidas sus ediciones manuales. Los demás planos se conservan.':'Se crearán subtítulos sólo para este plano. Los demás diálogos no se convierten automáticamente.'}</p>
      <p className="se-subtle">Los tiempos se reparten según la longitud del texto. No se ha escuchado ni transcrito ningún audio.</p>
      <ol>{proposal.cues.map((cue)=><li key={cue.id}><span>{tc(Math.round(cue.start*fps))} — {tc(Math.round(cue.end*fps))}</span><p>{cue.text}</p>{cue.characterId&&<small>{project.characters.find((character)=>character.id===cue.characterId)?.name}</small>}</li>)}</ol>
      <footer><button className="se-text-button" onClick={makeProposal}>Preparar de nuevo</button><button className="primary" onClick={acceptProposal} disabled={cues.filter((cue)=>cue.sceneId!==proposal.sceneId).length+proposal.cues.length>MAX_SUBTITLE_CUES}>Confirmar {proposal.cues.length} {proposal.cues.length===1?'subtítulo':'subtítulos'}</button></footer>
      {cues.filter((cue)=>cue.sceneId!==proposal.sceneId).length+proposal.cues.length>MAX_SUBTITLE_CUES&&<p role="alert">La propuesta supera el límite de 1.000 subtítulos. Reduce el diálogo o elimina otros subtítulos antes de continuar.</p>}
    </section>}
    <div className="se-toolbar"><div className="se-scope" role="group" aria-label="Filtrar subtítulos"><button aria-pressed={scope==='scene'} onClick={()=>setScope('scene')}>Este plano</button><button aria-pressed={scope==='all'} onClick={()=>setScope('all')}>Toda la película <span>{cues.length}</span></button></div><div className="se-actions"><button className="se-text-button" onClick={makeProposal} disabled={!selectedScene?.dialogue.trim()}><FileText size={15}/>{selectedSceneCues.length?'Revisar desde el diálogo':'Crear desde el diálogo'}</button><button className="se-text-button" onClick={download}><Download size={15}/>SRT</button><button className="quiet-button" onClick={add} disabled={!project.scenes.length||cues.length>=MAX_SUBTITLE_CUES}><Plus size={15}/>Añadir en el cabezal</button></div></div>
    <div className="se-layout"><aside className="se-list" aria-label="Lista de subtítulos"><div className="se-list-caption"><span>{visible.length} {visible.length===1?'subtítulo':'subtítulos'}</span>{issues.length>0&&<span title="Avisos para revisar"><AlertCircle size={12}/>{issues.length}</span>}</div><nav>{visible.map((cue,index)=>{const item=resolved.find((entry)=>entry.cue.id===cue.id),cueAnchor=anchorMap.get(cue.sceneId),active=!!item&&frame>=item.startFrame&&frame<item.endFrame;return <button key={cue.id} className={`${selected?.id===cue.id?'is-selected':''} ${active?'is-playing':''}`} aria-current={selected?.id===cue.id?'true':undefined} onClick={()=>choose(cue)}><span className="se-cue-number">{String(index+1).padStart(2,'0')}</span><span className="se-cue-caption"><strong>{cue.text||'Escribe este subtítulo…'}</strong><small>{item?`${tc(item.startFrame)} → ${tc(item.endFrame)}`:'Fuera de tiempo'}{scope==='all'&&` · ${cueAnchor?.scene.title||'Plano eliminado'}`}</small></span>{issues.some((issue)=>issue.cueId===cue.id)&&<AlertCircle size={13}/>}</button>;})}</nav>{!visible.length&&<p className="se-list-empty">{scope==='scene'?'Este plano aún no tiene subtítulos editables.':'Aún no hay subtítulos editables.'}</p>}</aside>
      <div className="se-main">{selected?<>
        <div className="se-cue-heading"><h3>{anchor?.scene.title??'Plano eliminado'}</h3><button className="se-icon-button" aria-label="Eliminar subtítulo seleccionado" onClick={remove}><Trash2 size={17}/></button></div>
        <label className="se-text-field"><span>Texto en pantalla <small>{selected.text.length}/{MAX_SUBTITLE_TEXT}</small></span><textarea ref={textRef} aria-label="Texto del subtítulo" maxLength={MAX_SUBTITLE_TEXT} rows={3} value={selected.text} onChange={(event)=>edit({text:event.target.value})} placeholder="Escribe las palabras que aparecerán en pantalla…"/></label>
        {anchor&&<><div className="se-timing"><CueTime key={`${selected.id}-start`} label="Entrada en el plano" value={selected.start} min={0} max={Math.max(0,Math.min(selected.end-1/fps,(anchor.durationFrames-1)/fps))} fps={fps} onChange={(value)=>edit({start:value})} onError={setError}/><CueTime key={`${selected.id}-end`} label="Salida en el plano" value={selected.end} min={Math.max(0,selected.start)+1/fps} max={anchor.durationFrames/fps} fps={fps} onChange={(value)=>edit({end:value})} onError={setError}/><div className="se-global-time"><Clock3 size={15}/><span>{effective?`${tc(effective.startFrame)} — ${tc(effective.endFrame)}`:'Sin tramo visible'}<small>Posición en la película · {fps} fps</small></span></div></div>
        <div className="se-head-actions"><button className="se-text-button" onClick={()=>alignToHead('start')}>Entrada en el cabezal</button><button className="se-text-button" onClick={()=>alignToHead('end')}>Salida en el cabezal</button><button className="se-text-button" onClick={()=>choose(selected)}>Ver este subtítulo</button></div>
        <label className="se-character"><span>Personaje <small>Una referencia de guion; no añade su nombre al texto.</small></span><select aria-label="Personaje del subtítulo" value={selected.characterId??''} onChange={(event)=>edit({characterId:event.target.value||undefined})}><option value="">Sin personaje asociado</option>{selected.characterId&&!linked.some((character)=>character.id===selected.characterId)&&<option value={selected.characterId} disabled>{project.characters.find((character)=>character.id===selected.characterId)?.name??'Personaje anterior'} · ya no vinculado</option>}{linked.map((character)=><option key={character.id} value={character.id}>{character.name}</option>)}</select></label></>}
        {selectedIssues.length>0&&<div className="se-warnings" aria-label="Observaciones del subtítulo">{selectedIssues.map((issue)=><p key={issue.kind}><AlertCircle size={14}/>{issue.message}</p>)}</div>}
        {anchor&&<details className="se-dialogue-source"><summary>Comparar con el diálogo del guion<ChevronDown size={15}/></summary><p>{anchor.scene.dialogue||'Este plano no tiene diálogo escrito.'}</p>{selectedIssues.some((issue)=>issue.kind==='stale')&&<button className="se-text-button" onClick={()=>edit({sourceDialogue:dialogueSourceSignature(anchor.scene.dialogue)})}><Check size={15}/>Marcar este texto como revisado</button>}</details>}
      </>:<div className="se-empty"><Subtitles size={28}/><h3>El texto también tiene ritmo.</h3><p>Añade un subtítulo en el cabezal o prepara un desglose del diálogo. Podrás revisar cada palabra y cada tiempo.</p>{project.subtitleCues===undefined&&<p className="se-subtle">El SRT anterior puede seguir usando el guion. El visor no muestra subtítulos hasta que los crees aquí.</p>}<button className="quiet-button" onClick={makeProposal} disabled={!selectedScene?.dialogue.trim()}><FileText size={15}/>Revisar diálogo de este plano</button></div>}</div>
    </div>
    <p className="se-footnote">Los subtítulos siguen a su plano al reordenar. Si acortas el plano, sólo aparece el texto dentro de su duración; los tiempos guardados se conservan.</p>
  </section>;
}
