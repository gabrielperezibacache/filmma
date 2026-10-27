import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { assetSchema, projectSchema, validateEditingReferences, type Asset, type Project } from './types.js';
import { exportSubtitlesSrt } from '../src/subtitles.js';
import type {CharacterVoice} from '../src/types.js';
import {enhancementSha256} from './ai-enhance.js';
import type { Store } from './store.js';

const MAX_ARCHIVE_BYTES = 0xffffffff;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 2002;
const archiveAsset = /^assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/;
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void Promise.resolve(fn(req, res)).catch(next); };
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; crcTable[index] = value; }
const updateCrc = (bytes: Buffer, previous: number) => { let value = previous; for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8); return value; };
type ZipEntry = { name: string; size: number; compressedSize: number; checksum: number; method: number; flags: number; localOffset: number; dataOffset: number; path: string };
type MediaKind = { extension: string; mime: string; type: Asset['type'] };
export type ExtensionContext = { app: Express; store: Store; dataDirectory: string; backupProject: (project: Project) => Promise<void>; detectMedia: (buffer: Buffer) => MediaKind | undefined };

/** Read only ZIP32 regular files, checking all names and bounds before extracting.
 * Extraction paths are generated locally; archive names are never joined onto disk paths.
 * Every stream is bounded and checks CRC, including optional README entries. */
async function extractArchive(archivePath: string, destination: string) {
  const file = await open(archivePath, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 22 || info.size > MAX_ARCHIVE_BYTES) throw fail('El proyecto debe ser un ZIP válido de hasta 4 GB.');
    const read = async (length: number, position: number) => {
      if (position < 0 || length < 0 || position + length > info.size) throw fail('El archivo ZIP está incompleto.');
      const bytes = Buffer.alloc(length); const result = await file.read(bytes, 0, length, position);
      if (result.bytesRead !== length) throw fail('El archivo ZIP está incompleto.');
      return bytes;
    };
    const tail = await read(Math.min(info.size, 22 + 65535), Math.max(0, info.size - 22 - 65535));
    let endIndex = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { endIndex = index; break; }
    }
    if (endIndex < 0) throw fail('No se encontró el directorio del ZIP. Vuelve a exportar el proyecto desde Filmma.');
    const end = tail.subarray(endIndex), count = end.readUInt16LE(10), centralSize = end.readUInt32LE(12), centralOffset = end.readUInt32LE(16);
    const endOffset = info.size - tail.length + endIndex;
    if (end.readUInt16LE(4) !== 0 || end.readUInt16LE(6) !== 0 || count !== end.readUInt16LE(8) || count < 1 || count > MAX_ENTRIES || centralSize > 2 * 1024 * 1024 || centralOffset + centralSize !== endOffset) throw fail('ZIP no compatible: usa un proyecto Filmma de un solo archivo, con hasta 2.000 originales.');
    const central = await read(centralSize, centralOffset);
    const entries: ZipEntry[] = [], names = new Set<string>();
    let offset = 0, total = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) throw fail('El directorio ZIP está dañado.');
      const flags = central.readUInt16LE(offset + 8), method = central.readUInt16LE(offset + 10), checksum = central.readUInt32LE(offset + 16), compressedSize = central.readUInt32LE(offset + 20), size = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28), extraLength = central.readUInt16LE(offset + 30), commentLength = central.readUInt16LE(offset + 32);
      const localOffset = central.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > central.length || nameLength > 200) throw fail('El directorio ZIP está dañado.');
      const name = central.toString('utf8', offset + 46, offset + 46 + nameLength);
      const unixMode = central.readUInt32LE(offset + 38) >>> 16, fileType = unixMode & 0xf000;
      if ((name !== 'project.json' && name !== 'README.txt' && !archiveAsset.test(name)) || name.includes('..') || names.has(name.toLowerCase())) throw fail(`Ruta ZIP no permitida o repetida: ${name.slice(0, 150)}.`);
      if ((fileType !== 0 && fileType !== 0x8000) || (central.readUInt32LE(offset + 38) & 0x10) || central.readUInt16LE(offset + 34) !== 0) throw fail('El proyecto no puede contener enlaces, carpetas ni archivos especiales.');
      if ((flags & ~0x0808) !== 0 || ![0, 8].includes(method)) throw fail('ZIP cifrado o con compresión no compatible. Exporta el proyecto desde Filmma.');
      if ([compressedSize, size, localOffset].includes(0xffffffff)) throw fail('ZIP64 no compatible; el proyecto debe ocupar menos de 4 GB.');
      total += size;
      if (total > MAX_ARCHIVE_BYTES || (name === 'project.json' && size > MAX_MANIFEST_BYTES) || (name === 'README.txt' && size > 1024 * 1024) || (size > 1024 * 1024 && size > Math.max(1, compressedSize) * 200)) throw fail('El contenido descomprimido supera los límites del proyecto.');
      if (method === 0 && size !== compressedSize) throw fail('Los tamaños declarados en el ZIP no coinciden.');
      names.add(name.toLowerCase());
      entries.push({ name, size, compressedSize, checksum, method, flags, localOffset, dataOffset: 0, path: join(destination, `${index}.original`) });
      offset = next;
    }
    if (offset !== central.length || !names.has('project.json')) throw fail('Falta project.json o el directorio ZIP está dañado.');
    const disk = await statfs(destination);
    if (disk.bavail * disk.bsize < total + 32 * 1024 * 1024) throw fail('No hay espacio suficiente para extraer los originales. Libera espacio y vuelve a importar.', 507);
    for (const entry of entries) {
      const local = await read(30, entry.localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== entry.flags || local.readUInt16LE(8) !== entry.method) throw fail('La cabecera local del ZIP no coincide con su directorio.');
      const nameLength = local.readUInt16LE(26), extraLength = local.readUInt16LE(28);
      if (nameLength > 200 || (await read(nameLength, entry.localOffset + 30)).toString('utf8') !== entry.name) throw fail('Las rutas internas del ZIP no coinciden.');
      entry.dataOffset = entry.localOffset + 30 + nameLength + extraLength;
      if (entry.dataOffset + entry.compressedSize > centralOffset) throw fail('Un original está truncado o se solapa con el directorio ZIP.');
      if (!(entry.flags & 8) && (local.readUInt32LE(14) !== entry.checksum || local.readUInt32LE(18) !== entry.compressedSize || local.readUInt32LE(22) !== entry.size)) throw fail('Los tamaños o la integridad del ZIP no coinciden.');
    }
    const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
    for (let index = 1; index < ordered.length; index++) if (ordered[index]!.localOffset < ordered[index - 1]!.dataOffset + ordered[index - 1]!.compressedSize) throw fail('El ZIP contiene archivos solapados.');
    for (const entry of entries) {
      let written = 0, checksum = 0xffffffff;
      const checked = new Transform({ transform(chunk: Buffer, _encoding, done) {
        written += chunk.length;
        if (written > entry.size) return done(fail('El tamaño real de un original supera el declarado.'));
        checksum = updateCrc(chunk, checksum); done(null, chunk);
      } });
      if (entry.compressedSize) {
        const source = createReadStream(archivePath, { fd: file.fd, start: entry.dataOffset, end: entry.dataOffset + entry.compressedSize - 1, autoClose: false });
        if (entry.method === 8) await pipeline(source, createInflateRaw(), checked, createWriteStream(entry.path, { flags: 'wx', mode: 0o600 }));
        else await pipeline(source, checked, createWriteStream(entry.path, { flags: 'wx', mode: 0o600 }));
      } else await writeFile(entry.path, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      if (written !== entry.size || ((checksum ^ 0xffffffff) >>> 0) !== entry.checksum) throw fail(`El original «${entry.name}» está dañado (tamaño o CRC).`);
    }
    return entries;
  } catch (error) {
    if (error instanceof Error && !('status' in error) && /Z_DATA_ERROR|invalid|unexpected end|incorrect/i.test(error.message)) throw fail('El contenido comprimido del ZIP está dañado.');
    throw error;
  } finally { await file.close(); }
}

function validateReferences(project: Project) {
  for (const group of [project.assets, project.characters, project.scenes]) if (new Set(group.map((item) => item.id)).size !== group.length) throw fail('Los identificadores del proyecto deben ser únicos.');
  const assets = new Map(project.assets.map((asset) => [asset.id, asset])), characters = new Set(project.characters.map((character) => character.id));
  const image = (id?: string) => !id || assets.get(id)?.type === 'image';
  for (const scene of project.scenes) {
    if (scene.characterIds.some((id) => !characters.has(id))) throw fail('Un plano hace referencia a un personaje inexistente.');
    if (!image(scene.assetId) || !image(scene.endAssetId)) throw fail('La referencia de un plano debe ser una imagen del paquete.');
    if (scene.videoAssetId && assets.get(scene.videoAssetId)?.type !== 'video') throw fail('El clip de un plano debe ser un video del paquete.');
    if (scene.takeAssetIds?.some(id => assets.get(id)?.type !== 'video')) throw fail('Una toma conservada debe ser un video del paquete.');
  }
  if (project.characters.some((character) => !image(character.assetId))) throw fail('La referencia de un personaje debe ser una imagen del paquete.');
  if (project.audioAssetId && assets.get(project.audioAssetId)?.type !== 'audio') throw fail('La banda sonora debe ser un audio del paquete.');
  validateEditingReferences(project);
}

/** Imports a separate project; never reuses archive IDs or overwrites existing media. */
export async function importProjectArchive(archivePath: string, context: Omit<ExtensionContext, 'app'>): Promise<Project> {
  const { store, dataDirectory, backupProject, detectMedia } = context;
  const original = structuredClone(store.project), originalState = JSON.stringify(store.project);
  const work = await mkdtemp(join(dataDirectory, 'work', 'import-'));
  const installed: string[] = [];
  let committed = false;
  try {
    const entries = await extractArchive(archivePath, work), byName = new Map(entries.map((entry) => [entry.name, entry]));
    let manifest: unknown;
    try { manifest = JSON.parse(await readFile(byName.get('project.json')!.path, 'utf8')); }
    catch { throw fail('project.json no contiene un documento JSON válido.'); }
    if (!manifest || typeof manifest !== 'object' || !('schemaVersion' in manifest) || manifest.schemaVersion !== 1 || !('project' in manifest)) throw fail('La versión del proyecto no es compatible. Se requiere un paquete Filmma versión 1.');
    const raw = manifest.project;
    if (!raw || typeof raw !== 'object' || !('assets' in raw) || !Array.isArray(raw.assets) || raw.assets.length > 2000) throw fail('El proyecto no contiene una lista válida de originales.');
    const replacements = new Map<string, { id: string; url: string; path: string; type: Asset['type']; mime: string; size: number }>();
    const consumed = new Set<string>();
    const assets: Asset[] = [];
    for (const value of raw.assets) {
      if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !archiveAsset.test(value.url) || value.url.includes('..')) throw fail('El paquete contiene una ruta de original inválida.');
      const entry = byName.get(value.url);
      if (!entry || consumed.has(entry.name)) throw fail('Falta un original del proyecto o está referenciado más de una vez.');
      consumed.add(entry.name);
      const handle = await open(entry.path, 'r'), header = Buffer.alloc(128);
      try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
      const media = detectMedia(header);
      if (!media) throw fail(`Formato de original no admitido: ${entry.name}.`);
      const id = randomUUID(), filename = `${id}.${media.extension}`, url = `/api/media/${filename}`;
      const parsed = assetSchema.safeParse({ ...value, url });
      if (!parsed.success || parsed.data.type !== media.type) throw fail(`Los datos de «${entry.name}» no coinciden con su contenido.`);
      // Early exports used size=0 for bundled demo assets. Actual bytes are authoritative.
      if (parsed.data.size !== 0 && parsed.data.size !== entry.size) throw fail(`El tamaño de «${entry.name}» no coincide con project.json.`);
      if (replacements.has(parsed.data.id)) throw fail('El proyecto contiene identificadores de originales repetidos.');
      replacements.set(parsed.data.id, { id, url, path: entry.path, type: media.type, mime: media.mime, size: entry.size });
      assets.push({ ...parsed.data, id, url, type: media.type, mime: media.mime, size: entry.size });
    }
    if (entries.some((entry) => entry.name.startsWith('assets/') && !consumed.has(entry.name))) throw fail('El paquete contiene originales que no están declarados en project.json.');
    const rawProject = projectSchema.safeParse({ ...raw, assets: raw.assets.map((value: any) => ({ ...value, url: replacements.get(value.id)?.url })) });
    if (!rawProject.success) throw fail(`El esquema del proyecto no es válido: ${rawProject.error.issues.slice(0, 3).map((issue) => issue.path.join('.')).join(', ')}.`);
    validateReferences(rawProject.data);
    for(const asset of rawProject.data.assets)if(asset.voiceReference){
      const meta=asset.voiceReference,source=replacements.get(meta.sourceAssetId),copy=replacements.get(asset.id);
      if(asset.type!=='audio'||source?.type!=='audio'||meta.projectId!==rawProject.data.id||source.id===copy?.id)throw fail('El perfil de voz no conserva una referencia original válida.');
      if(!copy||await enhancementSha256(copy.path)!==meta.outputSha256||await enhancementSha256(source.path)!==meta.sourceSha256)throw fail('Los audios de un perfil de voz no coinciden con sus huellas de integridad.');
    }
    const remap = (id?: string) => id ? replacements.get(id)?.id : undefined;
    for (const asset of assets) if (asset.enhancement) {
      const sourceAssetId = remap(asset.enhancement.sourceAssetId);
      if (!sourceAssetId || sourceAssetId === asset.id) throw fail('Una copia mejorada tiene una referencia original inexistente o circular.');
      asset.enhancement = { ...asset.enhancement, sourceAssetId };
    }
    const sequenceIds=new Map((rawProject.data.story?.sequences??[]).map(s=>[s.id,randomUUID()]));
    const storySceneIds=new Map((rawProject.data.story?.scenes??[]).map(s=>[s.id,randomUUID()]));
    const sceneIds = new Map(rawProject.data.scenes.map((scene) => [scene.id, randomUUID()]));
    const characterIds = new Map(rawProject.data.characters.map((character) => [character.id, randomUUID()]));
    const dialogueIds = new Map((rawProject.data.dialogueLines??[]).map(line=>[line.id,randomUUID()]));
    const remapVoice=(voice?:CharacterVoice):CharacterVoice|undefined=>voice?.engine==='qwen'&&voice.referenceAssetId?{...voice,referenceAssetId:remap(voice.referenceAssetId),voiceId:`profile-${remap(voice.referenceAssetId)}`}:voice;
    const project: Project = {
      ...rawProject.data, story:rawProject.data.story?{sequences:rawProject.data.story.sequences.map(s=>({...s,id:sequenceIds.get(s.id)!})),scenes:rawProject.data.story.scenes.map(s=>({...s,id:storySceneIds.get(s.id)!,sequenceId:sequenceIds.get(s.sequenceId)!}))}:undefined, id: randomUUID(), assets, updatedAt: new Date().toISOString(),
      scenes: rawProject.data.scenes.map((scene) => {
        const next = { ...scene, storySceneId:scene.storySceneId?storySceneIds.get(scene.storySceneId):undefined, id: sceneIds.get(scene.id)!, characterIds: scene.characterIds.map((id) => characterIds.get(id)!),
          continuity: scene.continuity && Object.fromEntries(Object.entries(scene.continuity).map(([id, state]) => [characterIds.get(id) ?? id, state])),
          assetId: remap(scene.assetId), videoAssetId: remap(scene.videoAssetId), takeAssetIds:scene.takeAssetIds?.map(id => remap(id)!), endAssetId: remap(scene.endAssetId) };
        delete next.clearVideoAsset; delete next.preserveVideoAsset; return next;
      }),
      characters: rawProject.data.characters.map((character) => ({ ...character, states:character.states?.map(s=>({...s,id:randomUUID()})),referenceAssetIds:character.referenceAssetIds?.map(id=>remap(id)!), id: characterIds.get(character.id)!, assetId: remap(character.assetId),voice:remapVoice(character.voice) })), audioAssetId: remap(rawProject.data.audioAssetId),
      dialogueLines:rawProject.data.dialogueLines?.map(line=>({...line,id:dialogueIds.get(line.id)!,sceneId:sceneIds.get(line.sceneId)!,characterId:line.characterId?characterIds.get(line.characterId):undefined,audioAssetId:remap(line.audioAssetId),voice:remapVoice(line.voice)})),
      tracks: rawProject.data.tracks?.map((track) => ({ ...track, id: randomUUID(), clips: track.clips.map((clip) => ({ ...clip, id: randomUUID(), assetId: remap(clip.assetId)!, sceneId: sceneIds.get(clip.sceneId)!,dialogueLineId:clip.dialogueLineId?dialogueIds.get(clip.dialogueLineId):undefined })) })),
      subtitleCues: rawProject.data.subtitleCues?.map((cue) => ({ ...cue, id: randomUUID(), dialogueLineId:dialogueIds.get(cue.dialogueLineId??(cue.id.startsWith('dialogue-')?cue.id.slice(9):'')), sceneId: sceneIds.get(cue.sceneId)!, characterId: cue.characterId ? characterIds.get(cue.characterId) : undefined })),
    };
    // The prompt remains an exact historical record. Association IDs follow the
    // imported project so each retained take stays discoverable in its new scene.
    for (const asset of project.assets) if (asset.generation && asset.generation.projectId === rawProject.data.id) {
      const generation = asset.generation;
      asset.generation = { ...generation, projectId: project.id, sceneId: sceneIds.get(generation.sceneId) ?? generation.sceneId,
        characterIds: generation.characterIds.map(id => characterIds.get(id) ?? id), referenceAssetIds: generation.referenceAssetIds.map(id => remap(id) ?? id),
        continuity: generation.continuity && Object.fromEntries(Object.entries(generation.continuity).map(([id, state]) => [characterIds.get(id) ?? id, state])),
      };
    }
    const remapDialogueSnapshot = <T extends {voice:CharacterVoice;characterId?:string;characterSnapshot?:{referenceAssetId?:string}}>(snapshot:T):T=>({...snapshot,voice:remapVoice(snapshot.voice)!,characterId:snapshot.characterId?characterIds.get(snapshot.characterId)??snapshot.characterId:undefined,characterSnapshot:snapshot.characterSnapshot?{...snapshot.characterSnapshot,referenceAssetId:remap(snapshot.characterSnapshot.referenceAssetId)}:undefined});
    for(const asset of project.assets){
      if(asset.voiceReference){const meta=asset.voiceReference;asset.voiceReference={...meta,projectId:project.id,characterId:characterIds.get(meta.characterId)??meta.characterId,sourceAssetId:remap(meta.sourceAssetId)!};}
      if(asset.speech&&asset.speech.projectId===rawProject.data.id){const meta=asset.speech;asset.speech={...remapDialogueSnapshot(meta),projectId:project.id,sceneId:sceneIds.get(meta.sceneId)??meta.sceneId,lineId:dialogueIds.get(meta.lineId)??meta.lineId};}
      if(asset.lipSync){const meta=asset.lipSync,sourceAssetId=remap(meta.sourceAssetId),audioAssetId=remap(meta.audioAssetId);
        if(!sourceAssetId||!audioAssetId||sourceAssetId===asset.id||project.assets.find(a=>a.id===sourceAssetId)?.type!=='video'||project.assets.find(a=>a.id===audioAssetId)?.type!=='audio')throw fail('Una sincronización labial tiene fuentes inexistentes o inválidas.');
        asset.lipSync={...meta,sourceAssetId,audioAssetId,...(meta.projectId===rawProject.data.id?{projectId:project.id,sceneId:sceneIds.get(meta.sceneId)??meta.sceneId,lineId:dialogueIds.get(meta.lineId)??meta.lineId,dialogue:remapDialogueSnapshot(meta.dialogue)}:{})};
      }
    }
    projectSchema.parse(project); validateReferences(project);
    const assertUnchanged = () => { if (JSON.stringify(store.project) !== originalState) throw fail('El proyecto abierto cambió durante la importación. Se ha conservado; vuelve a importar el paquete.', 409); };
    assertUnchanged(); await backupProject(original); assertUnchanged();
    await mkdir(join(dataDirectory, 'media'), { recursive: true });
    for (const replacement of replacements.values()) {
      const destination = join(dataDirectory, 'media', basename(replacement.url));
      await link(replacement.path, destination); installed.push(destination);
    }
    assertUnchanged(); store.project = project;
    try { await store.save(); committed = true; }
    catch (error) {
      store.project = original;
      try { await store.save(); }
      catch { committed = true; throw fail('No se pudo terminar ni restaurar el guardado. Los originales se conservaron; revisa el espacio en disco antes de continuar.', 507); }
      throw error;
    }
    return project;
  } finally {
    if (!committed) await Promise.all(installed.map((path) => rm(path, { force: true })));
    await rm(work, { recursive: true, force: true });
  }
}

const cleanComment = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
const timecode = (frame: number, fps: number) => {
  const frames = frame % fps, totalSeconds = Math.floor(frame / fps);
  return [Math.floor(totalSeconds / 3600), Math.floor(totalSeconds / 60) % 60, totalSeconds % 60, frames].map((part) => String(part).padStart(2, '0')).join(':');
};
export function projectToEdl(project: Project) {
  const lines = [`TITLE: ${cleanComment(project.name)}`, 'FCM: NON-DROP FRAME', `* FILMMA FRAME RATE: ${project.fps}`, '* VIDEO CUTS ONLY; IMAGES ARE STILL CLIPS; SOUNDTRACK IS LISTED SEPARATELY.', ''];
  let record = project.fps * 3600;
  const reels = new Map<string, string>();
  for (const [index, scene] of project.scenes.entries()) {
    const asset = project.assets.find((value) => value.id === (scene.videoAssetId ?? scene.assetId));
    if (asset && !reels.has(asset.id)) reels.set(asset.id, `AX${String(reels.size + 1).padStart(6, '0')}`);
    const frames = Math.round(scene.duration * project.fps), source = asset?.type === 'video' ? Math.round((scene.trimStart ?? 0) * project.fps) : 0;
    const reel = asset ? reels.get(asset.id)! : 'BL';
    lines.push(`${String(index + 1).padStart(3, '0')}  ${reel.padEnd(8)} V     C        ${timecode(source, project.fps)} ${timecode(source + frames, project.fps)} ${timecode(record, project.fps)} ${timecode(record + frames, project.fps)}`);
    lines.push(`* FROM CLIP NAME: ${asset ? basename(asset.url) : 'BLACK'}`, `* FILMMA SCENE: ${cleanComment(scene.title)}`);
    if (asset) lines.push(`* FILMMA ORIGINAL NAME: ${cleanComment(asset.name)}`, `* FILMMA SOURCE URL: ${asset.url}`);
    else lines.push('* MISSING MEDIA: BLACK PLACEHOLDER');
    if (asset?.type === 'image') lines.push('* STILL IMAGE');
    lines.push(''); record += frames;
  }
  const audio = project.assets.find((asset) => asset.id === project.audioAssetId);
  if (audio) lines.push(`* SOUNDTRACK: ${basename(audio.url)}`, `* SOUNDTRACK ORIGINAL NAME: ${cleanComment(audio.name)}`, `* SOUNDTRACK GAIN: ${project.audioVolume ?? 1}`, '* SOUNDTRACK START: 01:00:00:00; NOT INCLUDED AS AN EDL AUDIO EVENT.', '');
  if (project.tracks?.some((track) => track.clips.length) || project.subtitleCues?.length) lines.push('* ADDITIONAL TRACKS AND SUBTITLES ARE NOT REPRESENTABLE IN THIS V1 CUT LIST. USE THE FILMMA PACKAGE OR MP4 FOR THE COMPLETE EDIT.', '');
  if (project.scenes.some(scene => scene.transition && scene.transition !== 'cut')) lines.push('* TRANSITIONS ARE NOT INCLUDED IN THIS CUT LIST. USE THE FILMMA PACKAGE OR MP4 TO RETAIN THEM.', '');
  const effectClips = (project.tracks ?? []).flatMap(track => track.clips);
  if (project.scenes.some(scene => scene.color || (scene.look && scene.look !== 'original') || (scene.speed != null && scene.speed !== 1)) || effectClips.some(clip => clip.color || (clip.speed != null && clip.speed !== 1) || clip.transform || clip.keyframes?.length)) lines.push('* COLOR CORRECTION, FILM LOOKS, SPEED CHANGES, LAYER TRANSFORMS AND KEYFRAMES ARE NOT INCLUDED. EVENTS USE NORMAL-SPEED CUTS. USE THE FILMMA PACKAGE OR MP4 TO RETAIN THESE EFFECTS.', '');
  return lines.join('\r\n');
}

export function projectToSrt(project: Project) {
  return exportSubtitlesSrt(project);
}

export function registerExtensions(context: ExtensionContext) {
  const { app, store, dataDirectory } = context;
  const upload = multer({ dest: join(dataDirectory, 'work'), limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1, fields: 0, parts: 2 } }).single('projectFile');
  app.post('/api/projects/import', (req, res, next) => upload(req, res, (error) => {
    if (error) return next(fail(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 'El paquete Filmma puede ocupar hasta 4 GB.' : 'Selecciona un único paquete .filmma.zip en el campo projectFile.'));
    next();
  }), route(async (req, res) => {
    if (!req.file) throw fail('Selecciona un paquete .filmma.zip.');
    let project: Project;
    try {
      const info = await lstat(req.file.path);
      if (!info.isFile() || info.isSymbolicLink()) throw fail('El paquete subido no es un archivo regular.');
      project = await importProjectArchive(req.file.path, context);
    } finally { await rm(req.file.path, { force: true }); }
    res.status(201).json({ project, importedAsNew: true });
  }));
  app.get('/api/project/edl', route(async (_req, res) => {
    if (!store.project.scenes.length) throw fail('Añade al menos un plano antes de exportar el montaje.');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.attachment('filmma-montaje.edl'); res.send(projectToEdl(store.project));
  }));
  app.get('/api/project/subtitles', route(async (_req, res) => {
    const srt = projectToSrt(store.project);
    if (!srt) throw fail(store.project.subtitleCues === undefined ? 'Añade diálogo al guion antes de exportar subtítulos.' : 'Añade un subtítulo con texto y tiempo dentro de un plano antes de exportar.');
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8'); res.setHeader('X-Filmma-Subtitle-Timing', store.project.subtitleCues === undefined ? 'scene-based' : 'editable-cues'); res.attachment('filmma-guion.srt'); res.send(srt);
  }));
}
