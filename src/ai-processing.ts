import type { AiProcessingProfile } from './types';

export const aiProcessingLabel = (profile: AiProcessingProfile = 'conservative') =>
  profile === 'temporal' ? 'Restauración estable' : profile === 'restore' ? 'Restaurar definición' : 'Conservar textura';
export const defaultAiStrength = (profile: AiProcessingProfile = 'conservative') =>
  profile === 'temporal' ? .65 : profile === 'restore' ? .75 : .35;
export const maxAiStrength = (profile: AiProcessingProfile = 'conservative') => profile === 'conservative' ? .7 : .85;
