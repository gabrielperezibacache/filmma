import {Blend} from 'lucide-react';
import type {Project} from '../types';
import {resolveSceneTransitions} from '../transitions';

export default function TransitionControls({project,sceneId,onUpdate,onPreview}:{project:Project;sceneId:string;onUpdate:(fn:(p:Project)=>Project,group?:string)=>void;onPreview:(seconds:number,sceneId?:string)=>void}) {
  const index=project.scenes.findIndex(s=>s.id===sceneId),scene=project.scenes[index],previous=project.scenes[index-1];
  if(!scene)return null;
  const transition=resolveSceneTransitions(project).find(t=>t.incoming.id===scene.id);
  const kind=scene.transition??'cut';
  const patch=(change:Partial<typeof scene>)=>onUpdate(p=>({...p,scenes:p.scenes.map(s=>s.id===scene.id?{...s,...change}:s)}),`transition:${scene.id}:${Object.keys(change).join(',')}`);
  return <div className="tl-transition-controls" aria-label="Transición entre planos">
    <div className="tl-transition-heading"><Blend size={17}/><div><strong>Transición de entrada</strong><span>{previous?`${previous.title} → ${scene.title}`:'El primer plano abre la película.'}</span></div></div>
    <div className="tl-transition-fields"><label><span>Tipo de transición</span><select aria-label="Tipo de transición" value={kind} onChange={e=>patch({transition:e.target.value as typeof kind})}>
      <option value="cut">Corte directo</option><option value="dissolve" disabled={!previous}>Fundido encadenado</option><option value="dip" disabled={!previous}>Paso por negro</option>{kind==='fade'&&<option value="fade">Fundidos al inicio y final</option>}
    </select></label>
    {transition&&<><label><span>Duración <output>{(transition.durationFrames/project.fps).toFixed(2)} s</output></span><input type="range" aria-label="Duración de la transición" min={1/project.fps} max={2} step={1/project.fps} value={scene.transitionDuration??.5} onChange={e=>patch({transitionDuration:Number(e.target.value)})}/></label><button className="tl-transition-preview" type="button" onClick={()=>onPreview(transition.startFrame/project.fps,transition.kind==='dip'?previous.id:scene.id)}>Ir a la transición</button></>}
    </div>
    {transition&&<p>{kind==='dissolve'?'Continúa el plano anterior mientras entra el siguiente. Si el original termina, conserva su último fotograma.':'La imagen y el audio del plano pasan por negro en el corte.'} La duración se ajusta al espacio disponible; el guion, las pistas y los subtítulos mantienen sus tiempos.</p>}
  </div>;
}
