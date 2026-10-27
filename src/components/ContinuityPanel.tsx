import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CircleHelp, Link2, RotateCcw, ScanEye, Shirt, Users } from 'lucide-react';
import type { ContinuityOverride, Project } from '../types';
import { auditContinuity, continuityFields, continuityLabels, resolveSceneContinuity, updateContinuity } from '../continuity';
import './ContinuityPanel.css';

export type ContinuityPanelProps = {
  project: Project;
  sceneId: string;
  onChangeProject: (project: Project) => void;
  onSelectScene?: (sceneId: string) => void;
};
const examples = {
  costume: 'Abrigo ocre cerrado, puños húmedos…', appearance: 'Cabello suelto, una mancha de polvo en la mejilla…',
  props: 'Lata de película en la mano derecha…', notes: 'Mantiene la mirada hacia la pantalla, a la derecha del encuadre…',
};

export default function ContinuityPanel({ project, sceneId, onChangeProject, onSelectScene }: ContinuityPanelProps) {
  const prefix = useId();
  const [view, setView] = useState<'state' | 'review'>('state');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [wholeProject, setWholeProject] = useState(false);
  const scene = project.scenes.find((item) => item.id === sceneId);
  const appearances = useMemo(() => resolveSceneContinuity(project, sceneId), [project, sceneId]);
  const issues = useMemo(() => auditContinuity(project, wholeProject ? undefined : sceneId), [project, sceneId, wholeProject]);
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const selected = appearances.find((item) => item.character.id === selectedCharacterId) ?? appearances[0];
  const previousScene = project.scenes.find((item) => item.id === selected?.state.previousSceneId);
  const sceneTitle = (id: string) => project.scenes.find((item) => item.id === id)?.title ?? 'Plano anterior';
  const patch = (value: Partial<ContinuityOverride>) => {
    if (selected) onChangeProject(updateContinuity(project, sceneId, selected.character.id, value));
  };
  const restoreInheritance = () => patch({ costume: undefined, appearance: undefined, props: undefined, notes: undefined, intentionalChange: undefined, changeReason: undefined });
  const linkCharacter = (characterId: string) => onChangeProject({ ...project, updatedAt: new Date().toISOString(), scenes: project.scenes.map((item) => item.id === sceneId ? { ...item, characterIds: [...new Set([...item.characterIds, characterId])] } : item) });
  const clearOrphan = (characterId: string) => onChangeProject(updateContinuity(project, sceneId, characterId, { costume: undefined, appearance: undefined, props: undefined, notes: undefined, intentionalChange: undefined, changeReason: undefined }));
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'state' : event.key === 'End' ? 'review' : view === 'state' ? 'review' : 'state';
    setView(next); document.getElementById(`${prefix}-${next}-tab`)?.focus();
  };
  if (!scene) return <section className="continuity-panel"><div className="continuity-empty"><Users size={22}/><p>Selecciona un plano para revisar su continuidad.</p></div></section>;

  return <section className="continuity-panel" aria-label={`Continuidad de ${scene.title}`}>
    <div className="continuity-heading"><div><h2>Lo que permanece.</h2><p>Estado de los elementos en «{scene.title}».</p></div><ScanEye size={19} aria-hidden="true"/></div>
    <div className="continuity-tabs" role="tablist" aria-label="Vista de continuidad" onKeyDown={navigateTabs}>
      <button type="button" role="tab" id={`${prefix}-state-tab`} aria-controls={`${prefix}-state`} aria-selected={view === 'state'} tabIndex={view === 'state' ? 0 : -1} onClick={() => setView('state')}>En este plano</button>
      <button type="button" role="tab" id={`${prefix}-review-tab`} aria-controls={`${prefix}-review`} aria-selected={view === 'review'} tabIndex={view === 'review' ? 0 : -1} onClick={() => setView('review')}>Revisar{warnings > 0 && <span className="continuity-count">{warnings}</span>}</button>
    </div>
    {view === 'state' ? <div role="tabpanel" id={`${prefix}-state`} aria-labelledby={`${prefix}-state-tab`}>
      {appearances.length ? <>
        <div className="continuity-entities" aria-label="Elemento a editar">{appearances.map(({ character, state }) => {
          const image = project.assets.find((asset) => asset.id === character.assetId && asset.type === 'image');
          return <button key={character.id} type="button" aria-pressed={selected?.character.id === character.id} onClick={() => setSelectedCharacterId(character.id)}>
            {image ? <img src={image.url} alt=""/> : <Users size={15} aria-hidden="true"/>}<span>{character.name}</span>{state.changes.length > 0 && <span className={`continuity-dot ${state.intentionalChange ? 'intentional' : ''}`} title={state.intentionalChange ? 'Cambio intencional' : 'Estado modificado'}/>}
          </button>;
        })}</div>
        {selected && <div className="continuity-state-editor" key={`${sceneId}:${selected.character.id}`}>
          <div className="continuity-inheritance"><Link2 size={15} aria-hidden="true"/><p>{previousScene ? <>Continúa desde <button type="button" disabled={!onSelectScene} onClick={() => onSelectScene?.(previousScene.id)}>«{previousScene.title}»<ArrowLeft size={11}/></button></> : 'Primera aparición. Parte de la ficha del elemento.'}</p></div>
          {selected.character.description && <details className="continuity-identity"><summary>Identidad de {selected.character.name}</summary><p>{selected.character.description}</p><small>El estado de este plano tiene prioridad sobre el vestuario o el estado general de la ficha.</small></details>}
          <div className="continuity-fields">{continuityFields.map((field) => {
            const own = Object.prototype.hasOwnProperty.call(selected.state.overrides, field);
            const source = selected.state.sources[field];
            return <div className="continuity-field" key={field}>
              <div className="continuity-field-heading"><label htmlFor={`${prefix}-${field}`}>{continuityLabels[field]}</label>{own && <button type="button" onClick={() => patch({ [field]: undefined })} title={`Volver a heredar ${continuityLabels[field].toLowerCase()}`}><RotateCcw size={11}/>Heredar</button>}</div>
              <textarea id={`${prefix}-${field}`} rows={field === 'notes' ? 3 : 2} maxLength={field === 'notes' ? 2000 : 1200} value={selected.state.values[field]} placeholder={examples[field]} onChange={(event) => patch({ [field]: event.target.value })} aria-describedby={`${prefix}-${field}-source`}/>
              <small id={`${prefix}-${field}-source`}>{own ? selected.state.values[field] ? 'Definido en este plano' : 'Vacío en este plano; no hereda el valor anterior' : source ? `Heredado de «${sceneTitle(source)}»` : selected.state.values[field] ? 'Heredado de la ficha del elemento' : 'Sin definir todavía'}</small>
            </div>;
          })}</div>
          <div className="continuity-change">
            <label><input type="checkbox" checked={selected.state.intentionalChange} onChange={(event) => patch({ intentionalChange: event.target.checked })}/><span>Cambio intencional<small>La historia justifica que este estado sea distinto.</small></span></label>
            {selected.state.intentionalChange && <label className="continuity-reason" htmlFor={`${prefix}-reason`}>Motivo del cambio<textarea id={`${prefix}-reason`} rows={2} maxLength={1200} value={selected.state.changeReason} placeholder="Se quitó el abrigo al entrar en la cabina…" onChange={(event) => patch({ changeReason: event.target.value })}/></label>}
          </div>
          {selected.state.changes.length > 0 && <details className="continuity-comparison" open><summary>{previousScene ? 'Diferencias con su aparición anterior' : 'Diferencias con la ficha inicial'}</summary><dl>{selected.state.changes.map((change) => <div key={change.field}><dt>{continuityLabels[change.field]}</dt><dd><span>{change.before || 'Sin definir'}</span><ArrowRight size={12} aria-hidden="true"/><strong>{change.after || 'Vacío en este plano'}</strong></dd></div>)}</dl></details>}
          {Object.keys(selected.state.overrides).length > 0 && <button type="button" className="continuity-reset" onClick={restoreInheritance}><RotateCcw size={13}/>Volver a heredar todo el estado</button>}
        </div>}
      </> : <div className="continuity-empty"><Shirt size={24}/><h3>Aún no hay elementos vinculados.</h3><p>Vincula un personaje, un objeto o un lugar para mantener su estado entre apariciones.</p>{project.characters.length > 0 && <div className="continuity-link-options">{project.characters.map((character) => <button type="button" key={character.id} onClick={() => linkCharacter(character.id)}><Link2 size={13}/>{character.name}</button>)}</div>}</div>}
    </div> : <div role="tabpanel" id={`${prefix}-review`} aria-labelledby={`${prefix}-review-tab`}>
      <label className="continuity-scope"><input type="checkbox" checked={wholeProject} onChange={(event) => setWholeProject(event.target.checked)}/>Revisar todos los planos</label>
      {issues.length ? <div className="continuity-review-list">{issues.map((issue) => {
        const existingCharacter = project.characters.find((character) => character.id === issue.characterId);
        return <article className={`continuity-issue ${issue.severity}`} key={issue.id}>
          {issue.severity === 'warning' ? <AlertCircle size={16}/> : <CircleHelp size={16}/>}<div><span>{sceneTitle(issue.sceneId)}</span><p>{issue.message}</p><div className="continuity-issue-actions">
            {issue.sceneId !== sceneId && onSelectScene && <button type="button" onClick={() => onSelectScene(issue.sceneId)}>Ir al plano<ArrowRight size={12}/></button>}
            {issue.code === 'unexplained-change' && (issue.sceneId === sceneId || onSelectScene) && <button type="button" onClick={() => { setSelectedCharacterId(issue.characterId); setView('state'); if (issue.sceneId !== sceneId) onSelectScene?.(issue.sceneId); }}>Comparar estados<ArrowRight size={12}/></button>}
            {issue.code === 'unlinked-state' && issue.sceneId === sceneId && (existingCharacter ? <button type="button" onClick={() => linkCharacter(issue.characterId)}><Link2 size={12}/>Vincular elemento</button> : <button type="button" onClick={() => clearOrphan(issue.characterId)}>Quitar notas sin elemento</button>)}
          </div></div>
        </article>;
      })}</div> : <div className="continuity-review-clear"><Check size={21}/><strong>Sin diferencias pendientes en las fichas.</strong><p>Esta revisión compara tus notas y referencias; la continuidad visual se comprueba al ver cada toma.</p></div>}
    </div>}
    <p className="continuity-footnote">Las instrucciones se incorporan al prompt real. Las advertencias permiten seguir creando; la fidelidad visual depende del modelo.</p>
  </section>;
}
