import { useState } from 'react';
import { Copy, Download, FileText } from 'lucide-react';
import type { Project, Scene } from '../types';
import { buildGenerationInstructions } from '../generation-instructions';
import { cinemaSettingWarnings } from '../cinematography';
import { directionDecisionRows } from '../shot-planning';
import { tr, t } from '../i18n';
import './fourth-delivery.css';
export default function GenerationInstructions({ project, scene, mode, model, supervised, onChange }: {
    project: Project;
    scene: Scene;
    mode: 'text' | 'image';
    model: string;
    supervised: boolean;
    onChange: (patch: Partial<Scene>) => void;
}) {
    const [message, setMessage] = useState('');
    const text = buildGenerationInstructions(project, scene), previous = project.scenes[project.scenes.findIndex(s => s.id === scene.id) - 1], image = (id?: string) => project.assets.find(a => a.id === id)?.name, warnings = cinemaSettingWarnings(scene.cinematography), inactive = directionDecisionRows(scene).filter(r => r.stored), endUsed = mode === 'image' && model === 'minimax-h3' && !supervised && !!scene.endAssetId;
    return <section className="generation-instructions"><details><summary><FileText size={16}/>{tr('Instrucciones finales de generación', 'Final generation instructions')}</summary><p>{tr('Este texto comparte el mismo generador de instrucciones que el servidor. Las decisiones son indicaciones creativas; no simulan físicamente una cámara ni modifican el video seleccionado.', 'This text uses the same instruction builder as the server. Decisions are creative guidance; they neither physically simulate a camera nor modify the selected video.')}</p><dl className="instruction-bindings"><div><dt>{tr('Modo', 'Mode')}</dt><dd>{mode === 'image' ? tr('Imagen inicial', 'Starting image') : tr('Texto', 'Text')}</dd></div><div><dt>{tr('Imagen inicial', 'Starting image')}</dt><dd>{mode === 'image' ? image(scene.assetId) ?? tr('No disponible', 'Unavailable') : tr('No se utiliza en este perfil', 'Not used with this profile')}</dd></div><div><dt>{tr('Imagen final', 'Ending image')}</dt><dd>{endUsed ? image(scene.endAssetId) : scene.endAssetId ? tr('Conservada; este perfil no la utiliza', 'Retained; not used by this profile') : tr('Sin ancla visual final', 'No ending image anchor')}</dd></div></dl>{warnings.length > 0 && <div className="instruction-warnings"><h3>{tr('Revisar combinaciones', 'Review combinations')}</h3><ul>{warnings.map(w => <li key={w}>{t(w)}</li>)}</ul></div>}{inactive.length > 0 && <details><summary>{tr('Decisiones conservadas pero inactivas', 'Retained but inactive decisions')}</summary><ul>{inactive.map(r => <li key={r.key}>{t(r.label)}: {t(r.stored!)}</li>)}</ul></details>}<label>{tr('Restricciones del plano', 'Shot constraints')}<textarea aria-label={tr('Restricciones del plano', 'Shot constraints')} rows={3} maxLength={12000} value={scene.negativePrompt} onChange={e => onChange({ negativePrompt: e.target.value })}/></label><div className="instruction-actions"><button className="quiet-button" onClick={async () => { try {
        await navigator.clipboard.writeText(text);
        setMessage(tr('Instrucciones copiadas.', 'Instructions copied.'));
    }
    catch {
        setMessage(tr('No se pudo copiar. Puedes descargar el TXT.', 'Copy failed. You can download the TXT.'));
    } }}><Copy size={15}/>{tr('Copiar instrucciones', 'Copy instructions')}</button><button className="quiet-button" onClick={() => { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = `${scene.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 90) || 'Filmma'} - prompt.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={15}/>TXT</button></div>{message && <p role="status">{message}</p>}<pre aria-label={tr('Prompt final de este plano', 'Final prompt for this shot')}>{text || tr('Escribe la intención del plano para comenzar.', 'Write the shot intention to begin.')}</pre>{previous && <details className="previous-instructions"><summary>{tr('Comparar con el plano anterior', 'Compare with the previous shot')}</summary><p>{tr('Cada columna conserva su propio guion y sus personajes. No se copia ni modifica ningún plano.', 'Each column keeps its own script and characters. No shot is copied or modified.')}</p><div><section><h3>{previous.title}</h3><pre>{buildGenerationInstructions(project, previous)}</pre></section><section><h3>{scene.title}</h3><pre>{text}</pre></section></div></details>}</details></section>;
}
