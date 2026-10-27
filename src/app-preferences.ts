export const DEFAULT_APP_PREFERENCES = {
  theme: 'cinema' as 'cinema'|'graphite'|'light'|'system',
  accent: 'sage' as 'sage'|'amber'|'ocean'|'rose',
  scale: 'standard' as 'standard'|'large', density: 'comfortable' as 'comfortable'|'compact',
  navigation: 'labels' as 'labels'|'icons', motion: 'system' as 'system'|'reduced',
  language: 'es' as 'es'|'en', startPage: 'home' as 'home'|'script'|'studio',
  automaticUpdateChecks: true,
  preferredModel: 'ltx-2b' as 'ltx-2b'|'minimax-h3',
  modelPresetId: 'ltx-preview' as 'ltx-preview'|'ltx-balanced'|'h3-safe'|'h3-hd',
  recommendedProfile: 'balanced' as 'balanced'|'quality'|'preview',
};
export type AppPreferences = typeof DEFAULT_APP_PREFERENCES;
