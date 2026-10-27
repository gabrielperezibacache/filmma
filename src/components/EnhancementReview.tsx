import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Check,Pause,Play,X} from 'lucide-react';
import type {Asset} from '../types';
import {reviewCanvas,reviewDimensions,reviewSourceDimensions,type ReviewDimensions,type ReviewZoom} from '../enhancement-review';

type Props={original:Asset;version:Asset;characters:string[];applied:boolean;onApply:()=>void;onClose:()=>void};
export default function EnhancementReview({original,version,characters,applied,onApply,onClose}:Props){
  const dialog=useRef<HTMLDialogElement>(null),before=useRef<HTMLVideoElement>(null),after=useRef<HTMLVideoElement>(null),viewport=useRef<HTMLDivElement>(null);
  const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[divider,setDivider]=useState(50),[zoom,setZoom]=useState<ReviewZoom>('fit'),[ready,setReady]=useState(0),[error,setError]=useState('');
  const [sourceSize,setSourceSize]=useState<ReviewDimensions|null>(null),[versionSize,setVersionSize]=useState<ReviewDimensions|null>(null),[viewportSize,setViewportSize]=useState({width:1,height:1}),[scroll,setScroll]=useState({x:0,y:0});
  const originalDimensions=reviewSourceDimensions(original,sourceSize),outputDimensions=reviewSourceDimensions(version,versionSize);
  const canvas=reviewCanvas(outputDimensions,viewportSize,zoom),maxX=Math.max(0,canvas.width-viewportSize.width),maxY=Math.max(0,canvas.height-viewportSize.height);
  const sizeLabel=(size:ReviewDimensions|null)=>size?`${size.width} × ${size.height}`:'Leyendo dimensiones…';
  const fps=version.enhancement?.fps||24,totalFrames=Math.max(1,Math.round((version.enhancement?.duration||1)*fps));
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>{element?.close()}},[]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    const measure=()=>setViewportSize({width:element.clientWidth,height:element.clientHeight});
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=viewport.current;if(!element)return;
    element.scrollLeft=maxX/2;element.scrollTop=maxY/2;
    setScroll({x:element.scrollLeft,y:element.scrollTop});
  },[zoom,maxX,maxY]);
  useEffect(()=>{
    const left=before.current,right=after.current;if(!left||!right)return;
    if(!playing){left.pause();right.pause();return}
    if(frame>=totalFrames-1){left.currentTime=0;right.currentTime=0;setFrame(0)}
    let active=true,handle=0;
    void Promise.all([left.play(),right.play()]).catch(()=>{if(active){setPlaying(false);setError('No se pudo reproducir la comparación. Prueba a desplazarte fotograma a fotograma.')}});
    const tick=()=>{if(!active)return;if(Math.abs(right.currentTime-left.currentTime)>.75/fps)right.currentTime=left.currentTime;setFrame(Math.min(totalFrames-1,Math.floor(left.currentTime*fps+1e-4)));if(left.ended){setPlaying(false);return}handle=requestAnimationFrame(tick)};
    handle=requestAnimationFrame(tick);return()=>{active=false;cancelAnimationFrame(handle);left.pause();right.pause()};
  },[playing,version.id]);
  const seek=(value:number)=>{setPlaying(false);const next=Math.max(0,Math.min(totalFrames-1,Math.round(value)));setFrame(next);if(before.current)before.current.currentTime=next/fps;if(after.current)after.current.currentTime=next/fps};
  const videoStyle={width:canvas.width,height:canvas.height,transform:`translate(${-scroll.x}px, ${-scroll.y}px)`};
  const pan=(axis:'x'|'y',value:number)=>{const element=viewport.current;if(!element)return;if(axis==='x')element.scrollLeft=maxX*value/100;else element.scrollTop=maxY*value/100};
  const videoError=()=>{setPlaying(false);setError('No se pudo abrir una de las versiones. Cierra la comparación y comprueba el archivo en Biblioteca.')};
  return createPortal(<dialog ref={dialog} className="enhancement-review" aria-labelledby="enhancement-review-title" onCancel={event=>{event.preventDefault();onClose()}} onKeyDown={event=>event.stopPropagation()}>
    <header><div><h2 id="enhancement-review-title">Compara el detalle de la copia.</h2><p className="comparison-dimensions">Original: {sizeLabel(originalDimensions)} · Copia: {sizeLabel(outputDimensions)}</p><p>{characters.length?characters.join(', '):'Mismo plano, mismos tiempos'}. El reescalado aumenta el tamaño; la mejora visible debe revisarse.</p></div><button className="icon-button" aria-label="Cerrar comparación" onClick={onClose}><X size={18}/></button></header>
    <div ref={viewport} className="comparison-viewport" style={{aspectRatio:`${outputDimensions?.width||16}/${outputDimensions?.height||9}`}} tabIndex={zoom==='fit'?-1:0} role="region" aria-label="Visor de comparación" aria-describedby={zoom==='fit'?undefined:'comparison-pan-help'} onScroll={event=>setScroll({x:event.currentTarget.scrollLeft,y:event.currentTarget.scrollTop})}>
    <div className="comparison-scroll-surface" style={{width:Math.max(canvas.width,viewportSize.width),height:Math.max(canvas.height,viewportSize.height)}}>
    <div className="comparison-stage" style={{width:viewportSize.width,height:viewportSize.height}}>
      <video ref={before} src={original.url} muted playsInline preload="auto" style={videoStyle} onLoadedMetadata={event=>{setSourceSize(reviewDimensions(event.currentTarget.videoWidth,event.currentTarget.videoHeight));setReady(value=>value|1)}} onError={videoError}/>
      <div className="comparison-after" style={{clipPath:`inset(0 0 0 ${divider}%)`}}><video ref={after} src={version.url} muted playsInline preload="auto" style={videoStyle} onLoadedMetadata={event=>{setVersionSize(reviewDimensions(event.currentTarget.videoWidth,event.currentTarget.videoHeight));setReady(value=>value|2)}} onError={videoError}/></div>
      <div className="comparison-divider" style={{left:`${divider}%`}}/>
      <span className="comparison-label before">Original</span><span className="comparison-label after">{version.enhancement?.preset==='ai-4k'?'Copia con IA':'Copia procesada'}</span>
    </div>
    </div>
    </div>
    {error&&<p role="alert" className="danger">{error}</p>}
    <label className="comparison-wipe"><span>Comparar original y mejora</span><input type="range" min="0" max="100" value={divider} onChange={event=>setDivider(Number(event.target.value))}/></label>
    <div className="comparison-transport"><button className="quiet-button" disabled={ready!==3||!!error} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'Pausar':'Reproducir'}</button><button className="icon-button" aria-label="Fotograma anterior en comparación" disabled={!frame||ready!==3} onClick={()=>seek(frame-1)}><ArrowLeft size={16}/></button><input aria-label="Fotograma de comparación" type="range" min="0" max={totalFrames-1} step="1" value={frame} onChange={event=>seek(Number(event.target.value))} disabled={ready!==3}/><button className="icon-button" aria-label="Fotograma siguiente en comparación" disabled={frame>=totalFrames-1||ready!==3} onClick={()=>seek(frame+1)}><ArrowRight size={16}/></button><output>{frame+1} / {totalFrames}</output></div>
    <div className="comparison-detail-controls"><label className="field"><span>Tamaño de revisión</span><select value={zoom} onChange={event=>setZoom(event.target.value as ReviewZoom)}><option value="fit">Ajustar al visor</option><option value="100" disabled={!outputDimensions}>100 % de la copia</option><option value="200" disabled={!outputDimensions}>200 % de la copia</option></select></label>{zoom!=='fit'&&<><label><span>Desplazamiento horizontal</span><input type="range" min="0" max="100" value={maxX?scroll.x/maxX*100:0} disabled={!maxX} onChange={event=>pan('x',Number(event.target.value))}/></label><label><span>Desplazamiento vertical</span><input type="range" min="0" max="100" value={maxY?scroll.y/maxY*100:0} disabled={!maxY} onChange={event=>pan('y',Number(event.target.value))}/></label></>}</div>
    {zoom!=='fit'&&<p id="comparison-pan-help" className="comparison-pan-help">{zoom==='100'?'100 %: cada píxel de la copia ocupa un píxel del visor.':'200 %: cada píxel de la copia se amplía al doble.'} Recorre la imagen con las barras, el trackpad o las flechas al enfocar el visor. Ambas versiones muestran la misma zona.</p>}
    <footer><p>Comprueba rostro, manos, vestuario y objetos en varios fotogramas. La IA puede variar texturas; el original permanece disponible. Comparación sin sonido ni corrección de color del montaje.</p><button className="primary" disabled={applied||ready!==3||!!error} onClick={()=>{onApply();onClose()}}><Check size={16}/>{applied?'Versión en uso':'Usar esta versión'}</button></footer>
  </dialog>,document.body);
}
