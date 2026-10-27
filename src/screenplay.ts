import type { Project, Scene } from './types';

export const MAX_SCRIPT_SCENES = 100;
export const MAX_FOUNTAIN_BYTES = 8 * 1024 * 1024;
export type ImportedScene = Pick<Scene, 'title' | 'description' | 'dialogue' | 'duration' | 'camera'> & { characterNames: string[] };
export type FountainDocument = { title: string; logline: string; scenes: ImportedScene[]; warnings: string[] };

const normalizeLines = (value: string) => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const trimLines = (value: string) => value.replace(/^\n+|\n+$/g, '');
export const normalizeScriptSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
export const formatScriptTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export function sceneTimings(scenes: Scene[]) {
  let start = 0;
  return scenes.map((scene, index) => { const timing = { id: scene.id, index, start, end: start + scene.duration }; start = timing.end; return timing; });
}

// Only a stale-data fingerprint, never a security or authenticity signature.
function fingerprint(text: string) {
  let hash = 2166136261;
  for (const character of text) { hash ^= character.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
function protectLiteral(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]').replace(/\/\*/g, '\\/\\*').replace(/\*\//g, '\\*\\/');
}
function unescapeLiteral(text: string) { return text.replace(/\\([\\\[\]/*_])/g, '$1'); }
function isCue(line: string, next?: string) {
  const value = line.trim();
  return value.startsWith('@') || (!!next?.trim() && value.length <= 100 && /\p{L}/u.test(value) && value === value.toLocaleUpperCase() && !/^(?:!|#|=|>|\.|\[|\])/.test(value) && !/TO:$/.test(value));
}
function cueName(value: string) { return value.trim().replace(/^@/, '').replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim(); }
function heading(line: string): string | undefined {
  const text = line.trim();
  if (/^\.(?!\.)\s*\S/.test(text)) return text.replace(/^\.\s*/, '').replace(/\s+#[^#]+#\s*$/, '');
  if (/^(?:INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)(?:\s|$)/i.test(text)) return text.replace(/\s+#[^#]+#\s*$/, '');
  return undefined;
}
function dialogueForExport(value: string) {
  const lines = normalizeLines(value).split('\n'), result: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const inline = line.match(/^([\p{Lu}\p{N}][\p{Lu}\p{N}\s.'’()\-]{0,90}):\s*(.+)$/u);
    if (inline) { result.push(`${result.length ? '\n' : ''}@${protectLiteral(inline[1]!)}`, protectLiteral(inline[2]!)); }
    else if (line.trim() && (index === 0 || !lines[index - 1]?.trim()) && isCue(line, lines[index + 1])) result.push(`@${protectLiteral(line.replace(/^@/, ''))}`);
    else result.push(protectLiteral(line));
  }
  return result.join('\n');
}

/** Fountain's visible text remains portable. A standard note preserves Filmma's
 * two text fields exactly on an unchanged round trip, including blank lines and
 * unnamed dialogue. Editing the visible text invalidates that note's text copy.
 * Syntax reference: https://fountain.io/syntax/ */
export function exportFountain(project: Project): string {
  const title = normalizeLines(project.name).split('\n');
  const output = [`Title: ${title[0] ?? ''}`, ...title.slice(1).map((line) => `   ${line}`)];
  if (project.logline) output.push('Synopsis:', ...normalizeLines(project.logline).split('\n').map((line) => `   ${line}`));
  output.push('', '');
  for (const scene of project.scenes) {
    const sceneHeading = `. ${protectLiteral(scene.title.replace(/[\r\n]/g, ' ')) || 'Plano sin título'}`;
    const action = normalizeLines(scene.description).split('\n').map((line) => line ? `!${protectLiteral(line)}` : '').join('\n');
    const body = [action, dialogueForExport(scene.dialogue)].filter(Boolean).join('\n\n');
    const record = { title: scene.title, description: scene.description, dialogue: scene.dialogue, duration: scene.duration, camera: scene.camera, characterNames: scene.characterIds.map((id) => project.characters.find((item) => item.id === id)?.name).filter((name): name is string => !!name), fingerprint: fingerprint(`${sceneHeading}\n${trimLines(body)}`) };
    output.push(sceneHeading, `[[filmma-scene-v1 ${encodeURIComponent(JSON.stringify(record))}]]`, '', body, '', '');
  }
  return `${output.join('\n')}\n`;
}

function validateImported(scene: ImportedScene): ImportedScene {
  for (const [name, max] of [['title', 250], ['description', 12000], ['dialogue', 12000], ['camera', 250]] as const) {
    if (typeof scene[name] !== 'string' || scene[name].length > max) throw new Error(`El campo ${name === 'title' ? 'título' : name === 'description' ? 'acción' : name === 'dialogue' ? 'diálogo' : 'cámara'} de un plano supera el límite de ${max.toLocaleString('es')} caracteres.`);
  }
  if (!Number.isFinite(scene.duration) || scene.duration < 1 || scene.duration > 120) throw new Error('La duración de cada plano debe estar entre 1 y 120 segundos.');
  if (!Array.isArray(scene.characterNames) || scene.characterNames.length > 100 || scene.characterNames.some((name) => typeof name !== 'string' || name.length > 250)) throw new Error('Los nombres de personajes del archivo no son válidos.');
  return scene;
}

export function parseFountain(source: string): FountainDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_FOUNTAIN_BYTES) throw new Error('El guion supera los 8 MB. Divide el archivo antes de importarlo.');
  if (source.includes('\0')) throw new Error('Este archivo no parece un guion de texto. Elige un archivo .fountain o .txt.');
  const warnings = new Set<string>();
  let text = normalizeLines(source), title = '', logline = '';
  const titleKeys = /^(title|credit|author|authors|source|draft date|contact|copyright|notes|synopsis|language):\s*(.*)$/i;
  const lines = text.split('\n'); let cursor = 0, key = '';
  while (cursor < lines.length) {
    const line = lines[cursor]!, match = line.match(titleKeys);
    if (match) {
      key = match[1]!.toLowerCase(); const value = match[2]!;
      if (key === 'title') title = value; else if (key === 'synopsis') logline = value;
      else warnings.add('Los créditos y otros datos de portada se conservan en el archivo original; no se añaden como planos.');
      cursor++; continue;
    }
    if (key && /^(?: {3,}|\t)/.test(line)) { const value = line.replace(/^(?: {3,}|\t)/, ''); if (key === 'title') title += `${title ? '\n' : ''}${value}`; if (key === 'synopsis') logline += `${logline ? '\n' : ''}${value}`; cursor++; continue; }
    if (key && !line.trim()) { cursor++; break; }
    break;
  }
  text = lines.slice(cursor).join('\n');
  text = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => { warnings.add('Los bloques comentados /* … */ no se incorporan al montaje.'); return '\n'.repeat(comment.split('\n').length - 1); });
  if (text.includes('/*')) warnings.add('Hay un bloque /* sin cierre; se conserva como texto para que puedas revisarlo.');
  const chunks: { title: string; heading: string; body: string[] }[] = [];
  let current: typeof chunks[number] | undefined;
  const preamble: string[] = [];
  const contentLines = text.split('\n');
  for (let index = 0; index < contentLines.length; index++) {
    const line = contentLines[index]!, sceneTitle = heading(line);
    const isHeading = sceneTitle !== undefined && (index === 0 || !contentLines[index - 1]?.trim() || !current);
    if (isHeading) { current = { title: unescapeLiteral(sceneTitle!), heading: line, body: [] }; chunks.push(current); }
    else if (current) current.body.push(line); else preamble.push(line);
  }
  const preambleText = preamble.join('\n').trim();
  if (preambleText && !chunks.length) {
    const meaningful = preambleText.replace(/\[\[[\s\S]*?\]\]/g, '').split('\n').some((line) => line.trim() && !/^(?:#|=)/.test(line.trim()));
    if (meaningful) { chunks.push({ title: 'Escena importada', heading: '', body: preamble }); warnings.add('No se encontraron encabezados de escena. Revisa el texto, agrupado en un único plano.'); }
  } else if (preambleText) warnings.add('El texto anterior al primer encabezado no se añadió como plano. Revísalo en el archivo original.');
  if (chunks.length > MAX_SCRIPT_SCENES) throw new Error('El guion contiene más de 100 planos. Divide el archivo antes de importarlo.');
  const scenes = chunks.map((chunk) => {
    let rawBody = chunk.body.join('\n');
    const capsule = rawBody.match(/^\[\[filmma-scene-v1 (.+)\]\]\s*$/m);
    let metadata: any;
    if (capsule) {
      rawBody = rawBody.replace(capsule[0], '');
      try {
        metadata = JSON.parse(decodeURIComponent(capsule[1]!));
        validateImported(metadata);
        const visible = trimLines(rawBody);
        if (metadata.fingerprint === fingerprint(`${chunk.heading}\n${visible}`)) return validateImported({ title: metadata.title, description: metadata.description, dialogue: metadata.dialogue, duration: metadata.duration, camera: metadata.camera, characterNames: [...metadata.characterNames] });
        warnings.add('El texto Fountain fue editado: se relee lo visible y se conservan sólo los ajustes de duración y cámara de Filmma.');
      } catch { metadata = undefined; warnings.add('Una nota de Filmma no es válida. Se importará el texto visible para revisión.'); }
    }
    rawBody = rawBody.replace(/\[\[[\s\S]*?\]\]/g, () => { warnings.add('Las notas [[ … ]] no se incorporan a la acción ni al diálogo.'); return ''; });
    const body = rawBody.split('\n'), action: string[] = [], dialogue: string[] = [], names = new Set<string>();
    let mode: 'action' | 'dialogue' = 'action', switches = 0;
    for (let index = 0; index < body.length; index++) {
      let line = body[index]!, value = line.trim();
      if (!value) { if (line === '  ' && mode === 'dialogue') { dialogue.push(''); continue; } (mode === 'dialogue' ? dialogue : action).push(''); mode = 'action'; continue; }
      if (/^(?:#|=)/.test(value)) { warnings.add('Secciones, sinopsis y saltos de página no crean planos; su estructura se conserva sólo en el archivo original.'); continue; }
      if (line.startsWith('!')) { if (mode === 'dialogue') switches++; mode = 'action'; action.push(unescapeLiteral(line.slice(1))); continue; }
      if ((index === 0 || !body[index - 1]?.trim()) && isCue(line, body[index + 1])) {
        if (value.endsWith('^')) warnings.add('El diálogo simultáneo se incorpora en secuencia; revisa su orden.');
        names.add(cueName(line)); mode = 'dialogue'; switches++;
        if (dialogue.length && dialogue.at(-1) !== '') dialogue.push('');
        dialogue.push(unescapeLiteral(value.replace(/^@/, '').replace(/\s*\^$/, ''))); continue;
      }
      if (/^>|TO:$/.test(value)) { warnings.add('Las transiciones y el texto centrado se conservan como acción; no añaden efectos al montaje.'); mode = 'action'; }
      if (value.startsWith('~')) warnings.add('Las líneas de canción se conservan como texto; no se crea audio al importar.');
      line = unescapeLiteral(line); (mode === 'dialogue' ? dialogue : action).push(line);
    }
    if (switches > 1 && action.some((line) => line.trim()) && dialogue.length) warnings.add('Acciones y diálogos se agrupan por plano; revisa su intercalado en el archivo original.');
    if (!metadata) warnings.add('Los planos sin duración de Filmma comienzan con 5 segundos de montaje. Puedes ajustarlos antes de producir.');
    return validateImported({ title: chunk.title, description: trimLines(action.join('\n')), dialogue: trimLines(dialogue.join('\n')), duration: metadata?.duration ?? 5, camera: metadata?.camera ?? '', characterNames: [...names].filter(Boolean) });
  });
  return { title, logline, scenes, warnings: [...warnings] };
}

/** Call only after the user confirms the preview. Existing scenes and media are untouched. */
export function appendFountainScenes(project: Project, document: FountainDocument, selected: number[], newId: () => string = () => crypto.randomUUID()): Project {
  if (!selected.length) throw new Error('Selecciona al menos un plano para añadir.');
  if (new Set(selected).size !== selected.length || selected.some((index) => !Number.isInteger(index) || index < 0 || index >= document.scenes.length)) throw new Error('La selección de planos no es válida. Vuelve a revisar el archivo.');
  if (project.scenes.length + selected.length > MAX_SCRIPT_SCENES) throw new Error(`Quedan ${Math.max(0, MAX_SCRIPT_SCENES - project.scenes.length)} espacios. Un proyecto admite hasta 100 planos.`);
  const ids = new Set(project.scenes.map((scene) => scene.id));
  const scenes = [...selected].sort((a, b) => a - b).map((index): Scene => {
    const incoming = validateImported(document.scenes[index]!), id = newId();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error('No se pudo crear un identificador único. Vuelve a intentarlo.'); ids.add(id);
    const names = new Set(incoming.characterNames.map(normalizeScriptSearch));
    const characterIds = project.characters.filter((character) => names.has(normalizeScriptSearch(character.name))).map((character) => character.id);
    if (characterIds.length > 30) throw new Error(`«${incoming.title}» coincide con más de 30 elementos del proyecto. Revisa los nombres antes de importar.`);
    const duration = Math.round(incoming.duration * project.fps) / project.fps;
    return { id, title: incoming.title, description: incoming.description, dialogue: incoming.dialogue, duration, camera: incoming.camera, prompt: incoming.description, negativePrompt: '', seed: 42, characterIds, look: 'original', transition: 'cut' };
  });
  return { ...project, scenes: [...project.scenes, ...scenes] };
}
