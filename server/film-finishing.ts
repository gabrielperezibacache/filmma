import type { Asset, Project } from './types.js';
import type { AiProcessingProfile } from '../src/types.js';

export type AiFinishingIdentity = { model: string; version: string; modelSha256: string; temporalMode?:string; tile?:number; profile?:AiProcessingProfile };
export type FinishingReference = { kind: 'scene'; sceneId: string; assetId: string } | { kind: 'clip'; trackId: string; clipId: string; assetId: string };
export type FinishingItem = { sourceAssetId: string; name: string; status: 'created' | 'reused' | 'skipped' | 'error'; assetId?: string; message?: string };
export type FinishingSummary = { total: number; created: number; reused: number; skipped: number; errors: number; applied: number; items: FinishingItem[] };
export const referenceKey = (reference: FinishingReference) => reference.kind === 'scene' ? `scene:${reference.sceneId}` : `clip:${reference.trackId}:${reference.clipId}`;

/** Resolve to a retained original rather than repeatedly restoring an AI copy. */
export function assetFamilyId(assetId: string | undefined, assets: Asset[]): string | undefined {
  const seen = new Set<string>();
  while (assetId) {
    if (seen.has(assetId)) throw new Error('La relación entre originales y copias contiene un ciclo.');
    seen.add(assetId);
    const asset = assets.find(item => item.id === assetId);
    if (!asset) throw new Error('No se encuentra el original de una copia mejorada. Importa también sus originales.');
    if (!asset.enhancement) return assetId;
    assetId = asset.enhancement.sourceAssetId;
  }
  return undefined;
}

export function filmFinishingPlan(project: Project) {
  const references: FinishingReference[] = project.scenes.filter(scene => scene.videoAssetId || scene.assetId).map(scene => ({ kind: 'scene', sceneId: scene.id, assetId: (scene.videoAssetId ?? scene.assetId)! }));
  for (const track of project.tracks ?? []) if (track.type === 'video') for (const clip of track.clips) references.push({ kind: 'clip', trackId: track.id, clipId: clip.id, assetId: clip.assetId });
  const sources = new Map<string, { source: Asset; references: FinishingReference[] }>(), skipped = new Map<string, FinishingItem>();
  for (const reference of references) {
    const selected = project.assets.find(asset => asset.id === reference.assetId);
    if (!selected) throw new Error('Un plano o capa hace referencia a un archivo que ya no está en la biblioteca.');
    if (selected.type !== 'video') { skipped.set(selected.id, { sourceAssetId: selected.id, name: selected.name, status: 'skipped', message: 'Imagen fija: se conserva sin convertirla en video.' }); continue; }
    const rootId = assetFamilyId(selected.id, project.assets)!, source = project.assets.find(asset => asset.id === rootId)!;
    if (source.type !== 'video') throw new Error('El original de esta copia no es un video.');
    const group = sources.get(rootId) ?? { source, references: [] }; group.references.push(reference); sources.set(rootId, group);
  }
  return { sources: [...sources.values()], skipped: [...skipped.values()] };
}

export function compatibleAiCopy(asset: Asset, source: Asset, assets: Asset[], identity: AiFinishingIdentity, strength: number) {
  const enhancement = asset.enhancement;
  if (asset.type !== 'video' || enhancement?.preset !== 'ai-4k' || enhancement.method !== 'realesrgan-ncnn' || enhancement.model !== identity.model || enhancement.version !== identity.version || enhancement.modelSha256 !== identity.modelSha256 || Math.abs((enhancement.strength ?? -1) - strength) > 1e-6) return false;
  if ((enhancement.profile ?? 'conservative') !== (identity.profile ?? 'conservative')) return false;
  if ((identity.temporalMode && enhancement.temporalMode !== identity.temporalMode) || (identity.tile && enhancement.tile !== identity.tile)) return false;
  try { return assetFamilyId(asset.id, assets) === source.id; } catch { return false; }
}

/** Changes only the source binding. Trim, speed, color and identity live on the
 * scene or clip and therefore survive every original/derivative replacement. */
export function replaceFinishingReference(project: Project, reference: FinishingReference, derivative: Asset): boolean {
  if (!project.assets.some(asset => asset.id === derivative.id)) project.assets.push(derivative);
  if (reference.kind === 'scene') {
    const scene = project.scenes.find(item => item.id === reference.sceneId);
    if (!scene || scene.clearVideoAsset || (scene.videoAssetId ?? scene.assetId) !== reference.assetId || scene.videoAssetId === derivative.id) return false;
    scene.videoAssetId = derivative.id; return true;
  }
  const clip = project.tracks?.find(track => track.id === reference.trackId)?.clips.find(item => item.id === reference.clipId);
  if (!clip || clip.assetId !== reference.assetId || clip.assetId === derivative.id) return false;
  clip.assetId = derivative.id; return true;
}

export async function finishFilm(project: Project, options: {
  identity: AiFinishingIdentity; strength: number; signal: AbortSignal;
  latestAssets: () => Promise<Asset[]>;
  usableCopy: (asset: Asset, source: Asset) => Promise<boolean>;
  create: (source: Asset, update: (message: string, progress?: number) => void) => Promise<Asset>;
  apply?: (references: FinishingReference[], derivative: Asset) => Promise<number>;
  update: (message: string, progress: number, summary: FinishingSummary) => void;
}) {
  const { identity, strength, signal, update } = options, plan = filmFinishingPlan(project);
  const summary: FinishingSummary = { total: plan.sources.length, created: 0, reused: 0, skipped: plan.skipped.length, errors: 0, applied: 0, items: [...plan.skipped] };
  const publish = (message: string, progress: number) => update(message, progress, structuredClone(summary));
  publish('Preparando las fuentes de la película…', 0);
  for (const [index, entry] of plan.sources.entries()) {
    if (signal.aborted) throw new Error('Trabajo cancelado. Las copias ya terminadas se conservan.');
    const prefix = `Video ${index + 1} de ${plan.sources.length} · ${entry.source.name}`;
    try {
      const latest = await options.latestAssets(), assets = [...new Map([...project.assets, ...latest].map(asset => [asset.id, asset])).values()];
      let derivative: Asset | undefined;
      for (const candidate of [...assets].reverse()) if (compatibleAiCopy(candidate, entry.source, assets, identity, strength) && await options.usableCopy(candidate, entry.source)) { derivative = candidate; break; }
      let status: 'created' | 'reused' = 'reused';
      if (!derivative) {
        derivative = await options.create(entry.source, (message, progress = 0) => publish(`${prefix}: ${message}`, (index + progress / 100) / plan.sources.length * 100));
        status = 'created';
      }
      summary[status]++;
      summary.items.push({ sourceAssetId: entry.source.id, name: entry.source.name, status, assetId: derivative.id });
      // Completed assets are already persisted by create(). A cancellation here
      // must retain that completed copy, while avoiding an unwanted live switch.
      if (!signal.aborted && options.apply) summary.applied += await options.apply(entry.references, derivative);
      for (const reference of entry.references) replaceFinishingReference(project, reference, derivative);
      publish(`${prefix}: ${status === 'reused' ? 'copia compatible reutilizada' : 'copia con IA terminada'}.`, (index + 1) / plan.sources.length * 100);
    } catch (error) {
      if (signal.aborted) { publish('Trabajo cancelado. Las copias ya terminadas se conservan.', index / Math.max(1, plan.sources.length) * 100); throw error; }
      summary.errors++; summary.items.push({ sourceAssetId: entry.source.id, name: entry.source.name, status: 'error', message: error instanceof Error ? error.message : String(error) });
      publish(`${prefix}: no se pudo mejorar. El original se conserva.`, (index + 1) / plan.sources.length * 100);
    }
  }
  if (signal.aborted) throw new Error('Trabajo cancelado. Las copias ya terminadas se conservan.');
  publish(summary.total ? 'Preparación con IA terminada.' : 'La película contiene imágenes fijas; se conservan sus originales.', 100);
  return summary;
}
