import type {ClipAudio} from './types';
export type MediaPosition = {time:number;playing:boolean;volume:number;fps:number;rate?:number};

export function audioOnFrameGrid(settings:ClipAudio,fps:number):ClipAudio {
  return {...settings,fadeIn:Math.round((settings.fadeIn??0)*fps)/fps,fadeOut:Math.round((settings.fadeOut??0)*fps)/fps};
}

/** Keep the media clock on the montage clock; exhausted sources hold silently. */
export function syncMediaClock(media: HTMLMediaElement, position: MediaPosition, onBlocked?:()=>void) {
  const gain = Math.max(0, Math.min(1, position.volume));
  media.volume = gain;
  media.muted = gain === 0;
  media.playbackRate = Math.max(.25,Math.min(4,Number.isFinite(position.rate)?position.rate!:1));
  media.preservesPitch = true;
  if (media.readyState < 1) return;
  const finiteDuration = Number.isFinite(media.duration) && media.duration > 0;
  const exhausted = finiteDuration && position.time >= media.duration;
  const target = Math.max(0, finiteDuration ? Math.min(position.time, Math.max(0, media.duration - .001)) : position.time);
  if (Math.abs(media.currentTime - target) > (position.playing ? Math.max(.08, 2 / position.fps) : .001)) media.currentTime = target;
  if (!position.playing || exhausted) {
    media.pause();
    if (exhausted) media.muted = true;
  } else if (media.paused) {
    void media.play().catch((error:unknown) => {
      // A source change or a pause may abort an in-flight play request normally.
      if (error instanceof DOMException && error.name === 'NotAllowedError') onBlocked?.();
    });
  }
}
