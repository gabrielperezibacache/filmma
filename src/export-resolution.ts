export type ExportResolution = '720p' | '1080p' | '2160p';
export const PROJECT_FORMATS = ['16:9', '9:16', '1:1', '4:3', '4:5', '2.39:1'] as const;
export type ProjectFormat = typeof PROJECT_FORMATS[number];
export const PROJECT_FRAME_RATES = [24, 25, 30, 48, 50, 60] as const;
export type ProjectFrameRate = typeof PROJECT_FRAME_RATES[number];
export const DEFAULT_PROJECT_FORMAT: ProjectFormat = '16:9';
export const DEFAULT_PROJECT_FPS: ProjectFrameRate = 24;

export function isProjectFrameRate(fps: number): fps is ProjectFrameRate {
  return PROJECT_FRAME_RATES.some((rate) => rate === fps);
}

/** Framing for previews and layers; encoder dimensions may round to even pixels. */
export function projectAspectRatio(format: string): number {
  if (!PROJECT_FORMATS.some((value) => value === format)) return 16 / 9;
  const [width, height] = format.split(':').map(Number);
  return width! / height!;
}

/** The export canvas follows the project framing; sources are fitted, never cropped. */
export function exportDimensions(format: string, resolution: ExportResolution = '1080p'): [number, number] {
  const scale = resolution === '2160p' ? 2 : 1;
  const canvases: Record<ProjectFormat, [number, number]> = resolution === '720p' ? {
    '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720],
    '4:3': [960, 720], '4:5': [720, 900], '2.39:1': [1280, 536],
  } : {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080],
    '4:3': [1440, 1080], '4:5': [1080, 1350], '2.39:1': [1920, 804],
  };
  const canvas = canvases[format as ProjectFormat] ?? canvases[DEFAULT_PROJECT_FORMAT];
  return [canvas[0] * scale, canvas[1] * scale];
}
