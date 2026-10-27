import type {Asset,Scene} from './types';

/** Derivatives share source time; unrelated takes begin on their own source. */
export function assignScenePatch(scene:Scene,patch:Partial<Scene>,assets:Asset[]):Scene {
  const root=(id?:string)=>{const visited=new Set<string>();while(id&&!visited.has(id)){visited.add(id);const source=assets.find(asset=>asset.id===id)?.enhancement?.sourceAssetId;if(!source)return id;id=source}return id};
  const replacement=patch.videoAssetId&&patch.videoAssetId!==scene.videoAssetId;
  const timing=replacement&&root(patch.videoAssetId)!==root(scene.videoAssetId)?{trimStart:0,speed:1}:{};
  const remembered=replacement?[...new Set([...(scene.takeAssetIds??[]),...(patch.takeAssetIds??[]),root(scene.videoAssetId),root(patch.videoAssetId)].filter((id):id is string=>!!id&&assets.some(asset=>asset.id===id&&asset.type==='video')))]:undefined;
  return {...scene,...timing,...patch,...(remembered?{takeAssetIds:remembered}:{}),...(patch.videoAssetId?{clearVideoAsset:false}:{})};
}
