import { useEffect, useId, useRef, useState } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react';
import { Play, RotateCcw, Square } from 'lucide-react';
import type { Cinematography } from '../cinematography';
import { cinemaOptionLabel } from '../cinema-reference';
import './camera-movement-preview.css';

type Point = { x: number; y: number; rotation: number };
type MovementStudy = {
  view: string; action: string; from: string; to: string; path?: string;
  camera: Point[]; subject?: number[]; subjectY?: number; cone?: number[];
};
const point = (x: number, y: number, rotation = -90): Point => ({ x, y, rotation });
const fixed = [point(140, 154), point(140, 154)];

const STUDIES: Record<NonNullable<Cinematography['movement']>, MovementStudy> = {
  locked: { view: 'Vista superior', action: 'La cámara mantiene posición, dirección y focal. El movimiento pertenece a la acción.', from: 'Mismo encuadre', to: 'Mismo encuadre', camera: fixed },
  'dolly-in': { view: 'Vista superior', action: 'La cámara se acerca físicamente al sujeto. La perspectiva cambia con el recorrido.', from: 'Más distancia', to: 'Más cerca', path: 'M140 160V106', camera: [point(140, 160), point(140, 106)] },
  'dolly-out': { view: 'Vista superior', action: 'La cámara retrocede físicamente. El espacio alrededor del sujeto cobra presencia.', from: 'Más cerca', to: 'Más distancia', path: 'M140 106V160', camera: [point(140, 106), point(140, 160)] },
  'pan-left': { view: 'Vista superior', action: 'La cámara gira hacia la izquierda desde un punto fijo; no se desplaza lateralmente.', from: 'Eje inicial', to: 'Mirada a la izquierda', camera: [point(140, 154, -65), point(140, 154, -115)] },
  'pan-right': { view: 'Vista superior', action: 'La cámara gira hacia la derecha desde un punto fijo; no se desplaza lateralmente.', from: 'Eje inicial', to: 'Mirada a la derecha', camera: [point(140, 154, -115), point(140, 154, -65)] },
  tracking: { view: 'Vista superior', action: 'Cámara y sujeto avanzan en paralelo. Se conserva una relación lateral durante el seguimiento.', from: 'Inicio del recorrido', to: 'Desplazamiento paralelo', path: 'M80 154H218', camera: [point(80, 154), point(218, 154)], subject: [80, 218] },
  orbit: { view: 'Vista superior', action: 'La cámara describe un arco alrededor del sujeto y orienta su mirada hacia él.', from: 'Un lado del sujeto', to: 'El lado opuesto', path: 'M66 74A74 74 0 0 0 214 74', camera: [point(66, 74, 0), point(88, 126, -45), point(140, 148, -90), point(192, 126, -135), point(214, 74, -180)] },
  'crane-up': { view: 'Vista lateral', action: 'El brazo de grúa eleva la cámara en un arco. Cambian altura y posición; la mirada se mantiene sobre la acción.', from: 'Cámara baja', to: 'Vista elevada', path: 'M74 151Q32 107 58 44', camera: [point(74, 151, -38), point(48, 105, -16), point(58, 44, 21)] },
  handheld: { view: 'Vista superior', action: 'Pequeños desplazamientos y giros expresan una cámara sostenida por una persona. La intensidad depende del ritmo elegido.', from: 'Posición de partida', to: 'Variación orgánica', path: 'M134 151L141 148L136 156L143 153L138 149L142 154', camera: [point(134, 151, -92), point(141, 148, -89), point(136, 156, -91), point(143, 153, -88), point(138, 149, -92), point(142, 154, -90)] },
  'tilt-up': { view: 'Vista lateral', action: 'La cámara inclina su mirada hacia arriba sin cambiar de altura. Es un giro, no una elevación.', from: 'Mirada baja', to: 'Mirada alta', camera: [point(75, 108, 25), point(75, 108, -35)] },
  'tilt-down': { view: 'Vista lateral', action: 'La cámara inclina su mirada hacia abajo desde la misma posición. El soporte permanece quieto.', from: 'Mirada alta', to: 'Mirada baja', camera: [point(75, 108, -35), point(75, 108, 25)] },
  'crane-down': { view: 'Vista lateral', action: 'La grúa desciende en arco para acercar la mirada a la acción; no es sólo una inclinación de cámara.', from: 'Vista elevada', to: 'Cámara baja', path: 'M58 44Q32 107 74 151', camera: [point(58, 44, 21), point(48, 105, -16), point(74, 151, -38)] },
  follow: { view: 'Vista superior', action: 'La cámara avanza detrás del sujeto. Ambos se desplazan en la misma dirección manteniendo una distancia de seguimiento.', from: 'Detrás del personaje', to: 'Sigue su recorrido', path: 'M58 110H165', camera: [point(58, 110, 0), point(165, 110, 0)], subject: [122, 229], subjectY: 110 },
  lead: { view: 'Vista superior', action: 'La cámara retrocede delante del sujeto mientras lo mira de frente. Ambos avanzan por el mismo recorrido.', from: 'Delante del personaje', to: 'Retrocede mirándolo', path: 'M135 110H242', camera: [point(135, 110, 180), point(242, 110, 180)], subject: [71, 178], subjectY: 110 },
  'zoom-in': { view: 'Vista superior', action: 'La cámara permanece fija y aumenta la focal. Se estrecha el campo de visión sin acercarse físicamente al sujeto.', from: 'Campo más amplio', to: 'Campo más estrecho', camera: fixed, cone: [35, 12] },
  'zoom-out': { view: 'Vista superior', action: 'La cámara permanece fija y reduce la focal. Se abre el campo de visión sin retroceder físicamente.', from: 'Campo más estrecho', to: 'Campo más amplio', camera: fixed, cone: [12, 35] },
  'dolly-zoom': { view: 'Vista superior', action: 'La cámara se acerca y abre la focal a la vez. La intención es conservar el tamaño del sujeto mientras cambia la perspectiva del fondo.', from: 'Lejos · focal larga', to: 'Cerca · focal corta', path: 'M140 163V115', camera: [point(140, 163), point(140, 115)], cone: [12, 32] },
  'whip-pan': { view: 'Vista superior', action: 'Un giro horizontal rápido enlaza dos direcciones. El esquema muestra el recorrido; no simula el desenfoque de movimiento.', from: 'Primera dirección', to: 'Segunda dirección', camera: [point(140, 154, -150), point(140, 154, -30)] },
  'lateral-reveal': { view: 'Vista superior', action: 'La cámara se desplaza lateralmente hasta descubrir al sujeto detrás de un obstáculo. Describe en el guion qué se revela.', from: 'Sujeto oculto', to: 'Sujeto descubierto', path: 'M78 154H211', camera: [point(78, 154), point(211, 154, -115)] },
  'pedestal-up': { view: 'Vista lateral', action: 'La cámara sube en línea vertical conservando su inclinación. Cambia su altura sin girar la mirada.', from: 'Posición baja', to: 'Posición alta', path: 'M74 151V55', camera: [point(74, 151, 0), point(74, 55, 0)] },
  'pedestal-down': { view: 'Vista lateral', action: 'La cámara baja en línea vertical conservando su inclinación. Es un desplazamiento vertical, no un tilt.', from: 'Posición alta', to: 'Posición baja', path: 'M74 55V151', camera: [point(74, 55, 0), point(74, 151, 0)] },
};

function CameraGlyph() {
  return <><path d="M13-3L23-8V8L13 3Z" fill="var(--panel)" stroke="var(--accent)" strokeWidth="1.5"/><rect x="-12" y="-10" width="25" height="20" rx="3" fill="var(--panel)" stroke="var(--accent)" strokeWidth="1.5"/><path d="M-6-14H6" stroke="var(--accent)" strokeWidth="2"/></>;
}

function sample(values: number[], progress: number) {
  const position = Math.max(0, Math.min(1, progress)) * (values.length - 1);
  const index = Math.floor(position);
  return values[index] + ((values[Math.min(index + 1, values.length - 1)] - values[index]) * (position - index));
}

export default function CameraMovementPreview({ movement }: { movement: NonNullable<Cinematography['movement']> }) {
  const study = STUDIES[movement];
  const reducedMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<0 | 1>(0);
  const sectionRef = useRef<HTMLElement>(null);
  const cameraRef = useRef<SVGGElement>(null);
  const subjectRef = useRef<SVGGElement>(null);
  const coneRef = useRef<SVGPathElement>(null);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const progress = useMotionValue(0);
  const side = study.view === 'Vista lateral';
  const cameraTransform = useTransform(progress, current => `translate(${sample(study.camera.map(p => p.x), current)} ${sample(study.camera.map(p => p.y), current)}) rotate(${sample(study.camera.map(p => p.rotation), current)})`);
  const subjectTransform = useTransform(progress, current => `translate(${sample(study.subject ?? [side ? 198 : 140, side ? 198 : 140], current)} 0)`);
  const coneTransform = useTransform(progress, current => `scale(1 ${sample(study.cone ?? [25, 25], current)})`);
  // Native SVG transforms keep rotation about (0, 0), independent of the group's changing bounds.
  useMotionValueEvent(cameraTransform, 'change', value => cameraRef.current?.setAttribute('transform', value));
  useMotionValueEvent(subjectTransform, 'change', value => subjectRef.current?.setAttribute('transform', value));
  useMotionValueEvent(coneTransform, 'change', value => coneRef.current?.setAttribute('transform', value));
  const titleId = useId();
  const arrowId = useId().replaceAll(':', '');
  useEffect(() => {
    animationRef.current?.stop();
    progress.set(0);
    setPlaying(false);
    setPhase(0);
    return () => animationRef.current?.stop();
  }, [movement, progress]);
  useEffect(() => {
    const stop = () => { animationRef.current?.stop(); setPlaying(false); setPhase(0); progress.set(0); };
    const stopWhenHidden = () => { if (document.hidden) stop(); };
    const observer = new IntersectionObserver(entries => { if (!entries.some(entry => entry.isIntersecting)) stop(); });
    if (sectionRef.current) observer.observe(sectionRef.current);
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', stopWhenHidden); };
  }, [progress]);
  useEffect(() => { if (reducedMotion) { animationRef.current?.stop(); setPlaying(false); setPhase(0); progress.set(0); } }, [reducedMotion, progress]);
  const last = study.camera.at(-1)!;
  const first = study.camera[0];
  const duration = movement === 'whip-pan' ? .8 : 3;
  const startOrEnd = (next: 0 | 1) => { animationRef.current?.stop(); setPlaying(false); setPhase(next); progress.set(next); };
  const play = () => {
    if (playing) { startOrEnd(0); return; }
    if (reducedMotion) return;
    animationRef.current?.stop();
    progress.set(0);
    setPhase(0);
    setPlaying(true);
    animationRef.current = animate(progress, 1, { duration, ease: 'linear', onComplete: () => { setPlaying(false); setPhase(1); } });
  };
  return <section ref={sectionRef} className="camera-movement-study" aria-labelledby={titleId}>
    <div className="camera-movement-heading"><h4 id={titleId}>Recorrido de cámara</h4><span>{study.view}</span></div>
    <div className="camera-movement-layout">
      <svg viewBox="0 0 300 208" role="img" aria-label={`${cinemaOptionLabel('movement', movement)}. ${study.action}`}>
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10" fill="var(--muted)"/></marker></defs>
        <path d="M27 22h15M27 22v15M273 22h-15M273 22v15M27 186h15M27 186v-15M273 186h-15M273 186v-15" stroke="var(--border)" fill="none"/>
        {side && <path d="M35 170H265" stroke="var(--border)"/>}
        {movement === 'lateral-reveal' && <path d="M52 112H110" stroke="var(--muted)" strokeWidth="7"/>}
        {study.path && <path d={study.path} stroke="var(--muted)" strokeWidth="1.3" strokeDasharray="4 5" fill="none" markerEnd={`url(#${arrowId})`}/>}
        {[first, last].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--muted)" opacity=".5"/>)}
        <g ref={subjectRef} transform={subjectTransform.get()}>
          <circle cy={study.subjectY ?? 74} r="12" fill="var(--accent)" fillOpacity=".18" stroke="var(--accent)"/><circle cy={study.subjectY ?? 74} r="3" fill="var(--accent)"/>
        </g>
        <g ref={cameraRef} transform={cameraTransform.get()}>
          <path ref={coneRef} d="M23 0L95-1L95 1Z" fill="var(--accent)" fillOpacity=".08" stroke="var(--accent)" strokeOpacity=".4" vectorEffect="non-scaling-stroke" transform={coneTransform.get()}/>
          <CameraGlyph/>
        </g>
      </svg>
      <div className="camera-movement-notes"><p>{study.action}</p><dl><div><dt>Inicio</dt><dd>{study.from}</dd></div><div><dt>Final</dt><dd>{study.to}</dd></div></dl></div>
    </div>
    <div className="camera-movement-controls"><div className="camera-movement-steps" aria-label="Estados del recorrido"><button aria-pressed={!playing && phase === 0} onClick={() => startOrEnd(0)}>Inicio</button><button aria-pressed={!playing && phase === 1} onClick={() => startOrEnd(1)}>Final</button></div>{!reducedMotion && <button className="quiet-button" onClick={play}>{playing ? <Square size={14}/> : phase === 1 ? <RotateCcw size={14}/> : <Play size={14}/>} {playing ? 'Detener' : phase === 1 ? 'Repetir recorrido' : 'Ver recorrido'}</button>}</div>
    <p className="camera-movement-limit">{reducedMotion ? 'Movimiento reducido: compara Inicio y Final. ' : ''}Esquema orientativo, sin escala. La cámara es el rectángulo; el círculo es el sujeto. El modelo interpreta el recorrido, no lo ejecuta como una trayectoria medida.</p>
  </section>;
}
