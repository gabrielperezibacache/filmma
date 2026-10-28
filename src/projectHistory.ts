import type { Project } from './types';

type Entry = { before: Project; after: Project; group?: string; time: number; editedClips: string[] };
export type ProjectHistory = { past: Entry[]; future: Entry[] };
export const emptyHistory = (): ProjectHistory => ({ past: [], future: [] });

/** Generated/imported originals are never removed by undo. A background take is
 * preserved unless this history entry explicitly changed that shot's take. */
export function restoreHistorySnapshot(current: Project, expected: Project, target: Project, editedClips?: string[]): Project {
  if (current.id !== target.id || expected.id !== target.id) return current;
  const assets = [...current.assets, ...target.assets.filter(a => !current.assets.some(b => a.id === b.id))];
  const scenes = target.scenes.map(scene => {
    const live = current.scenes.find(s => s.id === scene.id);
    const from = expected.scenes.find(s => s.id === scene.id);
    const edited = editedClips ? editedClips.includes(scene.id) : from?.videoAssetId !== scene.videoAssetId;
    const preserve = live && from && (!edited || live.videoAssetId !== from.videoAssetId);
    const videoAssetId = preserve ? live.videoAssetId : scene.videoAssetId;
    const pendingClear = preserve ? live?.clearVideoAsset : scene.clearVideoAsset;
    const takeAssetIds=[...new Set([...(scene.takeAssetIds??[]),...(live?.takeAssetIds??[])])];
    return { ...scene, ...(takeAssetIds.length?{takeAssetIds}:{}), videoAssetId, clearVideoAsset: !videoAssetId && (!!pendingClear || !!live?.videoAssetId || (edited && !!from?.videoAssetId)) };
  });
  return { ...target,...(target.library||current.library?{library:{...target.library,...current.library}}:{}), assets, scenes, updatedAt: new Date().toISOString() };
}

export function recordHistory(history: ProjectHistory, before: Project, after: Project, group?: string, time = Date.now()): ProjectHistory {
  if (before.id !== after.id) return emptyHistory();
  if (JSON.stringify(before) === JSON.stringify(after)) return history;
  const editedClips = after.scenes.filter(scene => {
    const previous = before.scenes.find(item => item.id === scene.id);
    return previous && (previous.videoAssetId !== scene.videoAssetId || (!previous.clearVideoAsset && scene.clearVideoAsset));
  }).map(scene => scene.id);
  const last = history.past.at(-1);
  if (group && last?.group === group && time - last.time < 900 && !history.future.length) {
    return { past: [...history.past.slice(0, -1), { ...last, after, time, editedClips: [...new Set([...last.editedClips,...editedClips])] }], future: [] };
  }
  return { past: [...history.past, { before, after, group, time, editedClips }].slice(-60), future: [] };
}

export function travelHistory(history: ProjectHistory, current: Project, direction: 'undo' | 'redo'): { history: ProjectHistory; project: Project } {
  const source = direction === 'undo' ? history.past : history.future;
  const entry = source.at(-1);
  if (!entry || entry.before.id !== current.id) return { history, project: current };
  const project = restoreHistorySnapshot(current, direction === 'undo' ? entry.after : entry.before, direction === 'undo' ? entry.before : entry.after, entry.editedClips);
  return { project, history: direction === 'undo'
    ? { past: history.past.slice(0, -1), future: [...history.future, entry] }
    : { past: [...history.past, entry], future: history.future.slice(0, -1) } };
}
