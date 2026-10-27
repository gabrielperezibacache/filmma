import { isProjectFrameRate } from './export-resolution';

export function sourceTrim(inFrame: number, outFrame: number, sourceSeconds: number, fps: number, speed = 1) {
  if (!isProjectFrameRate(fps) || !Number.isFinite(sourceSeconds) || sourceSeconds <= 0) throw new Error('No se pudo leer la duración del original.');
  const frames = Math.floor(sourceSeconds * fps + 1e-6);
  if (![inFrame,outFrame].every(Number.isInteger) || inFrame < 0 || outFrame > frames) throw new Error('El recorte debe quedar dentro del video original.');
  if (!Number.isFinite(speed)||speed<.25||speed>4) throw new Error('La velocidad debe estar entre 0,25× y 4×.');
  const length = Math.floor((outFrame - inFrame)/speed+1e-6);
  if (length < fps) throw new Error('Conserva al menos un segundo de video.');
  if (length > fps * 120) throw new Error('Cada plano admite hasta 120 segundos; divide la toma en varios planos.');
  return {trimStart:inFrame/fps,duration:length/fps};
}
