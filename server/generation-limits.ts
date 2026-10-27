export const MAX_GENERATION_SECONDS = 15;
export const H3_NATIVE_MAX_VIDEO_TOKENS = 35000;
export function h3VisualTokens(width: number, height: number, frames: number) {
  return (2 + 5 * ((frames - 5) / 17)) * (width / 32) * (height / 32);
}
export const GENERATION_MEMORY_PROFILES = ['conservative', 'h3-long-ssd', 'h3-native-ssd', 'h3-hd-ssd'] as const;
export type GenerationMemoryProfile = typeof GENERATION_MEMORY_PROFILES[number];
export function isSupervisedGenerationProfile(profile: unknown): profile is 'h3-long-ssd' | 'h3-native-ssd' | 'h3-hd-ssd' {
  return profile === 'h3-long-ssd' || profile === 'h3-native-ssd' || profile === 'h3-hd-ssd';
}

// Existing profiles retain their six-hour API timeout. HD stops H3 internally
// at twelve hours; the extra thirty seconds lets its worker reap and report it.
export function generationTimeoutMs(profile: unknown) {
  return profile === 'h3-hd-ssd' ? 12 * 60 * 60 * 1000 + 30000 : 6 * 60 * 60 * 1000;
}

export function validateGenerationMemoryProfile(input: {
  memoryProfile?: unknown;
  model: 'minimax-h3' | 'ltx-2b';
  width: number;
  height: number;
  numFrames: number;
  steps: number;
  conditioningMode: string;
  hasImageReferences?: boolean;
}): GenerationMemoryProfile {
  const reject = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
  const profile = input.memoryProfile === undefined ? 'conservative' : input.memoryProfile;
  if (profile !== 'conservative' && !isSupervisedGenerationProfile(profile)) return reject('El perfil de memoria no es válido.');
  if (input.model === 'minimax-h3' && input.steps < 2) return reject('MiniMax H3 requiere al menos 2 pasos.');
  if (profile === 'conservative') return profile;
  if (input.model !== 'minimax-h3' || input.conditioningMode !== 'text' || input.hasImageReferences) return reject('El perfil supervisado admite MiniMax desde texto, sin imágenes ancla ni referencias visuales.');
  if (profile === 'h3-hd-ssd') {
    const hdCanvas = (input.width === 1280 && input.height === 736) || (input.width === 736 && input.height === 1280);
    if (![input.width, input.height, input.numFrames, input.steps].every(Number.isInteger) || !hdCanvas || input.numFrames < 22 || input.numFrames > 345 || (input.numFrames - 5) % 17 || input.steps > 20 || h3VisualTokens(input.width, input.height, input.numFrames) > 93840) return reject('El perfil HD largo experimental admite únicamente 1280 × 736 o 736 × 1280, hasta 345 fotogramas (14,375 s), 93.840 tokens visuales y entre 2 y 20 pasos. No se reduce la resolución ni se repiten fotogramas.');
    return profile;
  }
  if (profile === 'h3-native-ssd') {
    if (![input.width, input.height, input.numFrames, input.steps].every(Number.isInteger) || input.width < 256 || input.height < 256 || input.width % 32 || input.height % 32 || Math.max(input.width, input.height) > 1280 || input.width * input.height > 1280 * 736 || input.numFrames < 22 || input.numFrames > 345 || (input.numFrames - 5) % 17 || input.steps > 20 || h3VisualTokens(input.width, input.height, input.numFrames) > H3_NATIVE_MAX_VIDEO_TOKENS) return reject('El perfil de resolución nativa admite hasta 345 fotogramas y 35.000 tokens visuales, superficie máxima 1280 × 736, lado máximo 1280 y entre 2 y 20 pasos. Usa hasta 14,375 s en 768 × 448, 8 s en 1024 × 576 o 5,167 s en 1280 × 736; no se reduce automáticamente la duración ni la resolución.');
    return profile;
  }
  if (![input.width, input.height, input.numFrames, input.steps].every(Number.isInteger) || input.width < 256 || input.height < 256 || input.width % 32 || input.height % 32 || Math.max(input.width, input.height) > 512 || input.width * input.height > 512 * 320 || input.numFrames < 22 || input.numFrames > 345 || (input.numFrames - 5) % 17 || input.steps > 20) return reject('El perfil largo supervisado admite hasta 345 fotogramas (14,375 s), 512 × 320 píxeles de superficie, lado máximo 512 y entre 2 y 20 pasos.');
  return profile;
}

export function generationSeconds(requested: number | undefined, sceneDuration: number) {
  const duration = requested ?? sceneDuration;
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_GENERATION_SECONDS) throw Object.assign(new Error('Cada clip generado debe durar entre 1 y 15 segundos. Divide el plano o elige una toma breve; el montaje y el guion se conservan.'), { status: 400 });
  // The 36 GiB default remains deliberately short; explicit requests still pass
  // through the runtime's stricter memory budget before any model is loaded.
  return requested ?? Math.min(duration, 4);
}
export function generationFrames(duration: number, model: 'minimax-h3' | 'ltx-2b') {
  generationSeconds(duration, duration);
  const limit = Math.floor(duration * 24 + 1e-8);
  return model === 'minimax-h3' ? Math.max(22, 5 + 17 * Math.floor((limit - 5) / 17)) : Math.max(9, 1 + 8 * Math.floor((limit - 1) / 8));
}
