import type { Asset, Project } from './types';

export type SceneTake = { asset: Asset; originalAsset: Asset; generation?: Asset['generation']; selected: boolean; isDerivative: boolean };

/** Broken or cyclic lineage cannot make unrelated media appear as a scene take. */
function originalFor(asset: Asset, assets: Map<string, Asset>): Asset | undefined {
  const visited = new Set<string>();
  let current = asset;
  while (current.enhancement) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const parent = assets.get(current.enhancement.sourceAssetId);
    if (!parent || parent.type !== 'video') return undefined;
    current = parent;
  }
  return current;
}

export function listSceneTakes(project: Project, sceneId: string): SceneTake[] {
  const scene = project.scenes.find(item => item.id === sceneId);
  if (!scene) return [];
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const current = scene.videoAssetId ? assets.get(scene.videoAssetId) : undefined;
  const selectedFamily = current && originalFor(current, assets)?.id;
  const rememberedFamilies = new Set((scene.takeAssetIds ?? []).flatMap(id => { const asset = assets.get(id), original = asset && originalFor(asset, assets); return original ? [original.id] : []; }));
  return project.assets.flatMap(asset => {
    if (asset.type !== 'video') return [];
    const originalAsset = originalFor(asset, assets);
    if (!originalAsset) return asset.id === scene.videoAssetId ? [{ asset, originalAsset: asset, generation: asset.generation, selected: true, isDerivative: !!asset.enhancement }] : [];
    const generation = originalAsset.generation;
    if (!(generation?.projectId === project.id && generation.sceneId === sceneId) && !(originalAsset.lipSync?.projectId === project.id && originalAsset.lipSync.sceneId === sceneId) && originalAsset.id !== selectedFamily && !rememberedFamilies.has(originalAsset.id)) return [];
    return [{ asset, originalAsset, generation, selected: asset.id === scene.videoAssetId, isDerivative: asset.id !== originalAsset.id }];
  }).sort((left, right) => {
    // Keep each original next to its derivatives; newest take families first.
    const date = (right.generation?.createdAt ?? '').localeCompare(left.generation?.createdAt ?? '');
    if (date) return date;
    if (left.originalAsset.id === right.originalAsset.id) return Number(left.isDerivative) - Number(right.isDerivative);
    return project.assets.indexOf(right.originalAsset) - project.assets.indexOf(left.originalAsset);
  });
}
