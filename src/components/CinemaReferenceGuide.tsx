import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, RotateCcw, X } from 'lucide-react';
import { CINEMA_FIELDS, HISTORICAL_CONTEXT_LIMITS, buildCinematographyPrompt, changeCinemaSetting, cinemaSettingWarnings, clearHistoricalSetting, copyHistoricalSetting, historicalDirectionLabel, type CinemaFieldKey, type Cinematography, type HistoricalContext } from '../cinematography';
import { CINEMA_FIELD_HELP, CINEMA_REFERENCE_GROUPS, cinemaOptionLabel, cinemaReference, type CinemaReference } from '../cinema-reference';
import CameraMovementPreview from './CameraMovementPreview';
import './cinema-reference.css';

function CinemaDiagram({ kind, value }: { kind: CinemaReference['diagram']; value: string }) {
  const arrowId = useId().replaceAll(':', '');
  const arrow = `url(#${arrowId})`;
  const camera = (x: number, y: number, rotate = 0) => <g transform={`translate(${x} ${y}) rotate(${rotate})`}><rect x="-10" y="-7" width="20" height="14" rx="2" fill="var(--panel)" stroke="currentColor"/><path d="M10 -4L16 -7V7L10 4Z" fill="var(--panel)" stroke="currentColor"/></g>;
  const subject = <><circle cx="145" cy="53" r="11" fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)"/><circle cx="145" cy="53" r="3" fill="var(--accent)"/></>;
  let content;
  if (kind === 'era') {
    const captions: Record<string, string> = { prehistory: 'Antes de la escritura', antiquity: 'Lugar y cultura', medieval: 'Siglo y región', 'early-modern': 'Siglos XV–XVIII', nineteenth: 'Siglo XIX', '1900s': '1900–1909', '1910s': '1910–1919', '1920s': '1920–1929', '1930s': '1930–1939', '1940s': '1940–1949', '1950s': '1950–1959', '1960s': '1960–1969', '1970s': '1970–1979', '1980s': '1980–1989', '1990s': '1990–1999', '2000s': '2000–2009', '2010s': '2010–2019', contemporary: 'Un presente concreto', future: 'Un futuro propio', custom: 'Tu tiempo y lugar' };
    content = <><path d="M30 107H250" stroke="currentColor" opacity=".4"/>{[45, 83, 121, 159, 197, 235].map((x, i) => <path key={x} d={`M${x} ${i === 2 ? 96 : 102}V${i === 2 ? 118 : 112}`} stroke={i === 2 ? 'var(--accent)' : 'currentColor'} opacity={i === 2 ? 1 : .4}/>)}<circle cx="121" cy="107" r="4" fill="var(--accent)"/><text x="140" y="67" textAnchor="middle" fill="var(--text)" fontSize="17">{captions[value]}</text></>;
  } else if (kind === 'film-format') {
    const index = ['super8', '16mm', 'super16', '35mm', '65mm'].indexOf(value);
    const widths = [55, 76, 92, 119, 160];
    const width = widths[Math.max(0, index)];
    content = <><rect x={140 - width / 2} y="40" width={width} height="76" rx="2" fill="var(--accent)" fillOpacity=".1" stroke="var(--accent)"/><path d={`M${140 - width / 2} 30H${140 + width / 2}M${140 - width / 2} 26V34M${140 + width / 2} 26V34`} stroke="currentColor" opacity=".6"/>{[51, 71, 91].map(y => <g key={y}><rect x={133 - width / 2} y={y} width="3" height="7" fill="currentColor" opacity=".4"/><rect x={144 + width / 2} y={y} width="3" height="7" fill="currentColor" opacity=".4"/></g>)}<text x="140" y="87" textAnchor="middle" fill="var(--text)" fontSize="18">{({ super8: 'Super 8', '16mm': '16 mm', super16: 'Super 16', '35mm': '35 mm', '65mm': '65 mm' } as Record<string, string>)[value]}</text></>;
  } else if (kind === 'lens-family') {
    const curved = value === 'fisheye';
    content = <><path d="M30 79H250" stroke="currentColor" strokeDasharray="3 5" opacity=".3"/><path d={curved ? 'M90 27Q18 79 90 131' : 'M85 29Q62 79 85 129M85 29Q108 79 85 129'} fill="var(--accent)" fillOpacity=".1" stroke="var(--accent)"/>{value === 'anamorphic' ? <ellipse cx="190" cy="79" rx="20" ry="35" fill="none" stroke="var(--accent)"/> : value === 'tilt-shift' ? <path d="M170 30L205 129" stroke="var(--accent)" strokeWidth="2"/> : value === 'zoom' ? <><path d="M125 43H212M125 115H212" stroke="var(--accent)"/><path d="M145 38V120M191 38V120" stroke="var(--accent)" opacity=".5"/><path d="M150 79H187" stroke="var(--accent)" markerEnd={arrow}/></> : value === 'macro' ? <><circle cx="192" cy="79" r="29" fill="none" stroke="var(--accent)"/><circle cx="192" cy="79" r="6" fill="var(--accent)"/><path d="M166 53L218 105M166 105L218 53" stroke="var(--accent)" opacity=".25"/></> : value === 'probe' ? <><rect x="96" y="68" width="103" height="22" rx="2" fill="var(--panel)" stroke="var(--accent)"/><path d="M199 68L232 47M199 90L232 111" stroke="var(--accent)"/></> : <><path d="M91 38L215 79L91 120" fill="none" stroke="var(--accent)" opacity={value === 'vintage' ? .5 : 1}/><path d="M215 45V113" stroke="currentColor" opacity=".45"/>{value === 'vintage' && <circle cx="169" cy="56" r="14" fill="none" stroke="var(--accent)" opacity=".3"/>}</>}</>;
  } else if (kind === 'camera-body') {
    const labels: Record<string, string> = { 'cinema-digital': 'Cine digital', 'cinema-large': 'Gran formato', mirrorless: 'Ópticas intercambiables', 'film-motion': 'Captura fotoquímica', broadcast: 'Televisión / reportaje', 'dv-tape': 'Textura de cinta', action: 'Cerca de la acción', smartphone: 'Captura cotidiana' };
    const width = value === 'smartphone' ? 45 : value === 'cinema-large' ? 126 : 96;
    const height = value === 'smartphone' ? 76 : 61;
    content = <><rect x={140 - width / 2} y={70 - height / 2} width={width} height={height} rx="3" fill="none" stroke="var(--accent)"/><path d={`M${146 - width / 2} ${76 - height / 2}h13M${146 - width / 2} ${76 - height / 2}v10M${134 + width / 2} ${64 + height / 2}h-13M${134 + width / 2} ${64 + height / 2}v-10`} stroke="currentColor" opacity=".55"/><circle cx="140" cy="70" r="4" fill="var(--accent)"/><text x="140" y="131" textAnchor="middle" fill="var(--muted)" fontSize="12">{labels[value]}</text></>;
  } else if (kind === 'lens') {
    const width: Record<string, number> = { '18mm': 82, '24mm': 65, '35mm': 48, '50mm': 36, '85mm': 24, '135mm': 16 };
    const reach = width[value] ?? 40;
    content = <>{camera(38, 74)}<path d={`M55 74L220 ${74 - reach * .6}L220 ${74 + reach * .6}Z`} fill="var(--accent)" fillOpacity=".1" stroke="var(--accent)"/><path d="M80 74H225" stroke="currentColor" strokeDasharray="3 5" opacity=".5"/><path d="M220 18V132" stroke="currentColor" opacity=".3"/></>;
  } else if (kind === 'angle') {
    const positions: Record<string, [number, number, number]> = { 'eye-level': [55, 60, 0], low: [55, 112, -31], high: [55, 22, 23], overhead: [145, 15, 90], dutch: [55, 60, 16] };
    const [x, y, rotation] = positions[value] ?? positions['eye-level'];
    content = <><path d="M28 130H242" stroke="currentColor" opacity=".25"/><circle cx="167" cy="61" r="13" fill="var(--accent)" fillOpacity=".2" stroke="var(--accent)"/><path d="M147 104V88Q167 73 187 88V104" fill="none" stroke="var(--accent)"/><path d={`M${x + 18} ${y}L156 61`} stroke="currentColor" strokeDasharray="4 5" opacity=".5"/>{camera(x, y, rotation)}{value === 'dutch' && <path d="M116 123L221 95" stroke="var(--accent)"/>}</>;
  } else if (kind === 'direction') {
    const symmetric = ['kubrick', 'wes-anderson', 'ozu', 'fincher'].includes(value);
    const quiet = ['tarkovsky', 'sofia-coppola', 'chloe-zhao'].includes(value);
    const labels: Record<string, string> = { hitchcock: 'Pista · mirada · tensión', kurosawa: 'Acción en profundidad', ozu: 'Altura baja · pausa', kubrick: 'Eje y perspectiva', tarkovsky: 'Tiempo y materia', varda: 'Encuentro y detalle', 'wong-kar-wai': 'Capas y proximidad', 'wes-anderson': 'Frontalidad y simetría', 'sofia-coppola': 'Distancia e intimidad', 'chloe-zhao': 'Persona y paisaje', fincher: 'Geometría y precisión', almodovar: 'Color y espacio emocional' };
    content = <><rect x="31" y="24" width="218" height="96" fill="none" stroke="currentColor" opacity=".45"/>{symmetric ? <><path d="M140 24V120" stroke="var(--accent)" strokeDasharray="3 4" opacity=".5"/><path d={value === 'kubrick' ? 'M31 24L140 73L249 24M31 120L140 73L249 120' : 'M62 45H102V98H62ZM178 45H218V98H178Z'} fill="none" stroke="var(--accent)" opacity=".6"/><circle cx="140" cy={value === 'ozu' ? 87 : 71} r="10" stroke="var(--accent)" fill="var(--accent)" fillOpacity=".2"/></> : quiet ? <><path d="M32 92H248" stroke="currentColor" opacity=".4"/><circle cx={value === 'sofia-coppola' ? 207 : 99} cy="81" r="8" fill="var(--accent)" fillOpacity=".3" stroke="var(--accent)"/>{value === 'tarkovsky' && <path d="M57 108H216" stroke="var(--accent)" strokeDasharray="4 8"/>}</> : value === 'hitchcock' ? <><circle cx="79" cy="75" r="14" fill="none" stroke="var(--accent)"/><rect x="187" y="61" width="20" height="20" fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)"/><path d="M102 74H177" stroke="currentColor" strokeDasharray="3 5" markerEnd={arrow}/></> : value === 'kurosawa' ? <><path d="M45 108L227 38M53 119L234 49" stroke="currentColor" opacity=".3"/>{[0, 1, 2].map(i => <circle key={i} cx={81 + i * 58} cy={90 - i * 20} r={13 - i * 3} stroke="var(--accent)" fill="var(--accent)" fillOpacity=".2"/>)}</> : value === 'wong-kar-wai' ? <><rect x="31" y="24" width="60" height="96" fill="currentColor" opacity=".15"/><rect x="213" y="24" width="36" height="96" fill="currentColor" opacity=".15"/><circle cx="158" cy="69" r="14" fill="var(--accent)" fillOpacity=".2" stroke="var(--accent)"/><path d="M104 100L199 36" stroke="var(--accent)" opacity=".45"/></> : <><circle cx="95" cy="71" r="15" fill="var(--accent)" fillOpacity=".25" stroke="var(--accent)"/><rect x="157" y="40" width="58" height="60" fill="none" stroke="var(--accent)"/>{value === 'varda' && <circle cx="202" cy="98" r="11" fill="var(--panel)" stroke="var(--accent)"/>}</>}<text x="140" y="143" fill="var(--muted)" fontSize="11" textAnchor="middle">{labels[value]}</text></>;
  } else if (kind === 'take') {
    const labels: Record<string, string> = { establishing: 'Dónde sucede', master: 'Toda la acción', sequence: 'Acción sin cortes', dialogue: 'Quién escucha y responde', pov: 'Lo que ve el personaje', reaction: 'Cómo recibe lo ocurrido', insert: 'Un detalle decisivo', cutaway: 'Contexto fuera de la acción', reveal: 'De oculto a visible', 'product-hero': 'Presencia del objeto' };
    const isDetail = ['insert', 'product-hero'].includes(value);
    content = <><rect x="36" y="25" width="208" height="93" fill="none" stroke="currentColor" opacity=".5"/>{isDetail ? <><rect x="117" y="43" width="46" height="56" rx="2" fill="var(--accent)" fillOpacity=".1" stroke="var(--accent)"/>{value === 'insert' && <path d="M95 40H106M95 40V51M185 104H174M185 104V93" stroke="var(--accent)"/>}</> : value === 'sequence' ? <><path d="M63 78C89 35 113 108 140 70S188 48 215 78" fill="none" stroke="var(--accent)" strokeWidth="2" markerEnd={arrow}/><circle cx="65" cy="75" r="4" fill="var(--accent)"/></> : value === 'pov' ? <><path d="M75 72L190 38V106Z" fill="var(--accent)" fillOpacity=".08" stroke="var(--accent)"/><circle cx="75" cy="72" r="5" fill="var(--accent)"/><rect x="183" y="63" width="18" height="18" fill="var(--panel)" stroke="var(--accent)"/></> : value === 'reveal' ? <><rect x="80" y="25" width="50" height="93" fill="currentColor" opacity=".16"/><circle cx="165" cy="71" r="14" fill="var(--accent)" fillOpacity=".2" stroke="var(--accent)"/><path d="M90 98H198" stroke="var(--accent)" markerEnd={arrow}/></> : value === 'reaction' ? <><circle cx="152" cy="69" r="24" fill="var(--accent)" fillOpacity=".15" stroke="var(--accent)"/><path d="M50 72H114" stroke="currentColor" strokeDasharray="4 4" markerEnd={arrow}/></> : value === 'cutaway' ? <><rect x="55" y="41" width="63" height="60" fill="none" stroke="currentColor" strokeDasharray="3 4"/><rect x="165" y="49" width="44" height="44" fill="var(--accent)" fillOpacity=".15" stroke="var(--accent)"/><path d="M125 71H155" stroke="var(--accent)" markerEnd={arrow}/></> : <><path d="M48 93H231" stroke="currentColor" opacity=".4"/>{(value === 'establishing' ? [140] : [100, 178]).map(x => <circle key={x} cx={x} cy="77" r={value === 'establishing' ? 5 : 13} fill="var(--accent)" fillOpacity=".2" stroke="var(--accent)"/>)}{value === 'dialogue' && <path d="M119 76H158" stroke="var(--accent)" markerEnd={arrow}/>}</>}<text x="140" y="143" textAnchor="middle" fill="var(--muted)" fontSize="11">{labels[value]}</text></>;
  } else if (kind === 'pace') {
    const count = ({ still: 2, gentle: 4, measured: 6, energetic: 10 } as Record<string, number>)[value] ?? 4;
    content = <><path d="M30 80H240" stroke="currentColor" opacity=".35"/>{Array.from({ length: count }, (_, index) => <g key={index}><circle cx={35 + index * 200 / Math.max(1, count - 1)} cy="80" r={value === 'still' ? 5 : 3} fill="var(--accent)"/><path d={`M${35 + index * 200 / Math.max(1, count - 1)} 60V100`} stroke="var(--accent)" opacity={index % 2 ? .25 : .6}/></g>)}</>;
  } else {
    const moves: Record<string, string> = {
      'dolly-in': 'M135 131L135 86', 'dolly-out': 'M135 86L135 131',
      'pan-left': 'M163 100Q135 77 103 100', 'pan-right': 'M103 100Q135 77 163 100',
      tracking: 'M56 126H225', orbit: 'M91 74A66 45 0 1 1 194 87',
      'crane-up': 'M73 123Q73 73 98 31', handheld: 'M83 113L99 106L117 117L135 107L153 114L171 105',
      'crane-down': 'M98 31Q73 73 73 123', 'tilt-up': 'M73 112Q96 90 81 62', 'tilt-down': 'M81 62Q96 90 73 112',
      follow: 'M97 132V83', lead: 'M97 83V132', 'zoom-in': 'M114 128L135 85M176 128L155 85', 'zoom-out': 'M135 85L114 128M155 85L176 128',
      'dolly-zoom': 'M103 128L136 85M187 128L154 85', 'whip-pan': 'M95 103Q145 64 195 103', 'lateral-reveal': 'M64 125H220',
      'pedestal-up': 'M70 127V42', 'pedestal-down': 'M70 42V127',
    };
    content = <>{subject}{camera(value === 'crane-up' ? 50 : 145, 111, -90)}{moves[value] && <path d={moves[value]} stroke="var(--accent)" strokeWidth="2" fill="none" markerEnd={arrow}/>} {value === 'locked' && <path d="M145 124V140M134 140H156" stroke="var(--accent)"/>}</>;
  }
  return <svg className="cinema-reference-diagram" viewBox="0 0 280 158" aria-hidden="true"><defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="var(--accent)"/></marker></defs>{content}</svg>;
}

export function CinemaReferenceImage({ reference, value, className = '' }: { reference: CinemaReference; value: string; className?: string }) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => setUnavailable(false), [reference.image]);
  return <div className={`cinema-reference-image ${className}`}>
    {reference.image && !unavailable ? <img src={reference.image} alt={reference.alt ?? ''} loading="lazy" decoding="async" onError={() => setUnavailable(true)} /> : reference.diagram ? <CinemaDiagram kind={reference.diagram} value={value} /> : <span className="cinema-image-unavailable">Referencia visual no disponible</span>}
  </div>;
}

type Props = {
  settings: Cinematography;
  camera?: string;
  subjectRoles?: readonly string[];
  sceneTitle: string;
  initialField?: CinemaFieldKey;
  previous?: { title: string; settings: Cinematography };
  onApply: (settings: Cinematography) => void;
  onClose: () => void;
};

export default function CinemaReferenceGuide({ settings, camera, subjectRoles, sceneTitle, initialField = 'framing', previous, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groupNavRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<Cinematography>(() => structuredClone(settings));
  const [groupId, setGroupId] = useState(() => CINEMA_REFERENCE_GROUPS.find(item => item.fields.includes(initialField))?.id ?? 'composition');
  const [fieldKey, setFieldKey] = useState<CinemaFieldKey>(initialField);
  const titleId = useId();
  const helpId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => {
    const nav = groupNavRef.current;
    const active = nav?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!nav || !active) return;
    const revealActiveGroup = () => {
      const navBounds = nav.getBoundingClientRect();
      const activeBounds = active.getBoundingClientRect();
      const left = navBounds.left + nav.clientLeft;
      const right = left + nav.clientWidth;
      const inset = 8;
      let next = nav.scrollLeft;
      if (activeBounds.width > nav.clientWidth - inset * 2 || activeBounds.left < left + inset) next += activeBounds.left - left - inset;
      else if (activeBounds.right > right - inset) next += activeBounds.right - right + inset;
      nav.scrollLeft = Math.max(0, Math.min(next, nav.scrollWidth - nav.clientWidth));
    };
    revealActiveGroup();
    const observer = new ResizeObserver(revealActiveGroup);
    observer.observe(nav);
    observer.observe(active);
    return () => observer.disconnect();
  }, [groupId]);
  const group = CINEMA_REFERENCE_GROUPS.find(item => item.id === groupId)!;
  const field = CINEMA_FIELDS.find(item => item.key === fieldKey)!;
  const value = draft[fieldKey] ?? '';
  const reference = cinemaReference(fieldKey, value);
  const changedFields = CINEMA_FIELDS.filter(item => settings[item.key] !== draft[item.key]);
  const contextChanged = JSON.stringify(settings.historicalContext ?? {}) !== JSON.stringify(draft.historicalContext ?? {});
  const changeCount = changedFields.length + (contextChanged ? 1 : 0);
  const changed = changeCount > 0;
  const chosenCount = CINEMA_FIELDS.filter(item => draft[item.key]).length;
  const warnings = cinemaSettingWarnings(draft);
  const readingFirst = fieldKey === 'takeType';
  const directorPreviewValue = fieldKey === 'director' ? (value || field.options[0].value) : '';
  const directorPreview = directorPreviewValue ? cinemaReference('director', directorPreviewValue) : undefined;
  const explanation = <div className={`cinema-reference-explanation${readingFirst ? ' cinema-reference-explanation--leading' : ''}`} aria-live="polite" aria-atomic="true"><h4>{value ? cinemaOptionLabel(fieldKey, value) : 'Deja que la intención del plano decida'}</h4><p>{reference?.description ?? 'Sin una indicación adicional, el modelo interpreta la acción y las referencias que ya tiene el plano.'}</p>{reference?.imageNote && <p className="cinema-reference-limits">{reference.imageNote}</p>}{(reference?.diagram === 'film-format' || reference?.diagram === 'camera-body' || reference?.diagram === 'lens-family') && <p className="cinema-reference-limits">Esquema conceptual, sin escala ni simulación óptica. La generación interpreta estas indicaciones.</p>}{fieldKey === 'takeType' && value === 'pov' && <p className="cinema-reference-limits">Indica en el guion de quién es la mirada y qué observa, especialmente si hay varios personajes en la escena.</p>}</div>;
  const choose = (next: string) => setDraft(current => changeCinemaSetting(current, fieldKey, next));
  const updateContext = (key: keyof HistoricalContext, next: string) => setDraft(current => {
    const context = { ...current.historicalContext };
    if (next) (context as Record<string, string>)[key] = next;
    else delete context[key];
    const result = { ...current };
    if (Object.keys(context).length) result.historicalContext = context;
    else delete result.historicalContext;
    return result;
  });
  return <dialog ref={dialogRef} className="cinema-guide" aria-labelledby={titleId} onCancel={onClose}>
    <header className="cinema-guide-heading">
      <div><h2 id={titleId}>Encuentra la mirada del plano</h2><p>{sceneTitle} · Explora una decisión a la vez. Aplicar prepara la próxima generación.</p></div>
      <button className="icon-button" aria-label="Cerrar guía visual sin aplicar" onClick={onClose}><X size={19}/></button>
    </header>
    <nav ref={groupNavRef} className="cinema-guide-groups" aria-label="Grupos de dirección cinematográfica">{CINEMA_REFERENCE_GROUPS.map(item => <button key={item.id} aria-pressed={item.id === groupId} onClick={() => { setGroupId(item.id); setFieldKey(item.fields[0]); }}><span>{item.label}</span>{item.fields.some(key => draft[key]) && <Check size={13}/>}</button>)}</nav>
    <div className="cinema-guide-body">
      <aside className="cinema-guide-fields">
        <p>{group.description}</p>
        {group.fields.map(key => <button key={key} className={key === fieldKey ? 'is-current' : ''} aria-pressed={key === fieldKey} onClick={() => setFieldKey(key)}><span>{CINEMA_FIELDS.find(item => item.key === key)!.label}<small>{cinemaOptionLabel(key, draft[key])}</small></span><ChevronRight size={15}/></button>)}
        <div className="cinema-guide-draft"><strong>Dirección del plano</strong><span>{chosenCount ? `${chosenCount} ${chosenCount === 1 ? 'indicación elegida' : 'indicaciones elegidas'}` : 'Todavía sin indicaciones'}</span><p>El guion, los personajes y la toma actual se conservan.</p>{draft.era && <p>{historicalDirectionLabel(draft)}</p>}</div>
      </aside>
      <section className="cinema-guide-options" aria-labelledby={`${titleId}-field`}>
        <div className="cinema-guide-option-heading"><h3 id={`${titleId}-field`}>{field.label}</h3><label className="cinema-native-choice"><span className="sr-only">Elegir {field.label.toLowerCase()}</span><select aria-describedby={helpId} value={value} onChange={event => choose(event.target.value)}><option value="">Sin indicación</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
        {fieldKey === 'director' && directorPreview ? <>
          <figure className="cinema-director-feature">
            <CinemaReferenceImage reference={directorPreview} value={directorPreviewValue}/>
            <figcaption><h4>{cinemaOptionLabel('director', directorPreviewValue)}</h4><p>{value ? 'Referencia elegida para el borrador.' : 'Ejemplo para explorar. Todavía no has elegido una referencia.'}</p><p className="cinema-director-image-note">Interpretación original creada con IA; no es un fotograma del director.</p></figcaption>
          </figure>
          <p id={helpId} className="cinema-guide-help cinema-director-help">Explora un lenguaje visual. Tus decisiones concretas, el guion y la continuidad tienen prioridad.</p>
          <details className="cinema-director-reading"><summary>Qué aporta esta referencia</summary><p>{directorPreview.description}</p><p>{CINEMA_FIELD_HELP.director}</p>{directorPreview.imageNote && <p>{directorPreview.imageNote}</p>}</details>
        </> : <p id={helpId} className="cinema-guide-help">{CINEMA_FIELD_HELP[fieldKey]}</p>}
        {readingFirst && value && explanation}
        {fieldKey === 'movement' && draft.movement && <CameraMovementPreview key={draft.movement} movement={draft.movement}/>}
        {fieldKey === 'era' && <section className="cinema-history-context" aria-label="Contexto de la época">
          {draft.era ? <>
            <div className="cinema-history-fields">
              <label><span>Año o periodo concreto</span><input value={draft.historicalContext?.year ?? ''} maxLength={HISTORICAL_CONTEXT_LIMITS.year} placeholder="1928, siglo XII o 450 a. C." onChange={event => updateContext('year', event.target.value)}/></label>
              <label><span>Lugar y cultura</span><input value={draft.historicalContext?.location ?? ''} maxLength={HISTORICAL_CONTEXT_LIMITS.location} placeholder="Valparaíso, Chile" onChange={event => updateContext('location', event.target.value)}/></label>
              <label className="cinema-history-mode"><span>Cómo interpretar la época</span><select value={draft.historicalContext?.mode ?? 'faithful'} onChange={event => updateContext('mode', event.target.value)}><option value="faithful">Fidelidad histórica como intención</option><option value="stylized">Interpretación estilizada</option><option value="alternate">Historia alternativa</option></select></label>
              <label className="cinema-history-notes"><span>Detalles que deben permanecer</span><textarea rows={3} value={draft.historicalContext?.notes ?? ''} maxLength={HISTORICAL_CONTEXT_LIMITS.notes} placeholder="Materiales, arquitectura, utilería y excepciones deliberadas. Ej.: faroles de gas; conservar el reloj del personaje." onChange={event => updateContext('notes', event.target.value)}/><small>La época no cambia por sí sola el guion, las referencias, el vestuario fijado ni la voz. Acuerda cualquier cambio de identidad en continuidad.</small></label>
            </div>
            <div className="cinema-history-actions"><button className="text-button" onClick={() => setDraft(current => clearHistoricalSetting(current))}><RotateCcw size={14}/>Quitar época y notas</button>{previous?.settings.era && <button className="text-button" onClick={() => setDraft(current => copyHistoricalSetting(previous.settings, current))}><Copy size={14}/>Copiar sólo la época anterior</button>}</div>
          </> : <><p>Elige un periodo para precisar el año, el lugar y las reglas de tu historia.</p>{draft.historicalContext && <p>Las notas anteriores siguen guardadas. No se envían al modelo mientras no elijas una época. <button className="text-button" onClick={() => setDraft(current => clearHistoricalSetting(current))}>Eliminar esas notas</button></p>}{previous?.settings.era && <button className="quiet-button" onClick={() => setDraft(current => copyHistoricalSetting(previous.settings, current))}><Copy size={14}/>Usar la época de «{previous.title}»</button>}</>}
          {draft.era && previous?.settings.era && <p className="cinema-history-source">Plano anterior: {previous.title} · {historicalDirectionLabel(previous.settings)}</p>}
        </section>}
        <div className="cinema-reference-grid">{field.options.map(option => {
          const example = cinemaReference(fieldKey, option.value)!;
          const active = option.value === value;
          return <button key={option.value} className={`cinema-reference-choice${active ? ' is-selected' : ''}`} aria-pressed={active} onClick={() => choose(option.value)}>
            <CinemaReferenceImage reference={example} value={option.value}/>
            <span className="cinema-reference-label"><span>{option.label}</span>{active && <Check size={16}/>}</span>
            <span className="cinema-reference-short">{example.diagram ? 'Esquema orientativo' : example.imageNote ? 'Referencia orientativa' : 'Referencia visual'}</span>
          </button>;
        })}</div>
        {fieldKey !== 'director' && (!readingFirst || !value) && explanation}
        {warnings.length > 0 && <div className="cinema-setting-notes" role="status"><strong>Revisa esta combinación</strong><ul>{warnings.map(note => <li key={note}>{note}</li>)}</ul></div>}
        {changed && <details className="cinema-guide-changes"><summary>{changeCount} {changeCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}</summary><ul>{changedFields.map(item => <li key={item.key}><strong>{item.label}</strong><span>{cinemaOptionLabel(item.key, settings[item.key])} → {cinemaOptionLabel(item.key, draft[item.key])}</span></li>)}{contextChanged && <li><strong>Contexto histórico</strong><span>{draft.historicalContext ? 'Fecha, lugar, interpretación o detalles actualizados' : 'Notas eliminadas'}</span></li>}</ul></details>}
        <details className="cinema-guide-prompt"><summary>Ver las instrucciones que recibirá el modelo</summary><pre>{buildCinematographyPrompt({ camera, cinematography: draft }, subjectRoles) || 'Se conserva la intención escrita del plano.'}</pre></details>
      </section>
    </div>
    <footer className="cinema-guide-footer"><div><span>{changed ? `${changeCount} ${changeCount === 1 ? 'cambio pendiente de aplicar' : 'cambios pendientes de aplicar'}` : 'Las elecciones coinciden con el plano'}</span><small>Las imágenes son interpretaciones de IA; no son pruebas ópticas ni históricas.</small></div><div className="cinema-guide-footer-actions"><button className="text-button" disabled={!chosenCount && !draft.historicalContext} onClick={() => setDraft({})}><RotateCcw size={14}/>Limpiar</button><button className="quiet-button" onClick={onClose}>{changed ? 'Cancelar' : 'Cerrar'}</button><button className="primary" disabled={!changed} onClick={() => { onApply(draft); onClose(); }}><Check size={15}/>Aplicar al plano</button></div></footer>
  </dialog>;
}
