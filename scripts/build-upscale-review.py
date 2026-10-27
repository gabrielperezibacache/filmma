"""Publish an inspectable comparison only after the real media checks pass."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/qa/upscale-720-comparison'
data = json.loads((OUT / 'comparison.json').read_text())
assert data['status'] == 'verified' and data['sourcePreserved']
methods = {
    'lanczos': 'Escalado clásico', 'lanczos-sharp': 'Enfoque suave',
    'ai-texture-35': 'IA · conservar textura 35 %',
    'ai-restore-65': 'IA · restaurar definición 65 %',
    'ai-restore-85': 'IA · restaurar definición 85 %',
}
temporal_directory = ROOT / 'output/qa/temporal-720-comparison'
temporal_path = temporal_directory / 'comparison.json'
temporal = json.loads(temporal_path.read_text()) if temporal_path.exists() else None
if temporal and temporal['status'] == 'verified':
    assert temporal['sourceSha256'] == data['sourceSha256'] and temporal['sourcePreserved']
    key = 'ai-temporal-65'
    shutil.copytree(temporal_directory / key, OUT / key, dirs_exist_ok=True)
    methods[key] = 'IA · restauración estable 65 %'
    data['metrics'][key] = temporal['metrics'][key]
for key in methods:
    assert json.loads((OUT / key / 'verification.json').read_text())['fullDecodePassed']
html = '''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Filmma · Prueba de definición</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111510;color:#eae6d9}*{box-sizing:border-box}body{max-width:1500px;margin:auto;padding:32px 5vw 70px}header{max-width:850px;margin:24px 0 32px}.eyebrow{font-size:12px;letter-spacing:.2em;color:#bdc6a0}h1{font:clamp(30px,5vw,60px)/1.08 Georgia,serif;font-weight:400;margin:15px 0}p{line-height:1.65;color:#b7bdad}strong{color:#eae6d9}.controls{display:flex;flex-wrap:wrap;gap:15px;margin:22px 0}label{display:grid;gap:8px;font-size:13px;flex:1;min-width:200px}select,button,a{font:inherit}select{width:100%;min-width:0;max-width:100%}select,button{background:#252f20;border:1px solid #526047;color:#eae6d9;border-radius:8px;padding:12px}button{cursor:pointer}a{color:#d5debc}select:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #e7b280;outline-offset:4px}.compare{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden;border:1px solid #384031;border-radius:12px}.compare img{width:100%;height:100%;object-fit:contain;position:absolute;inset:0}.compare .right{clip-path:inset(0 0 0 50%)}.divider{position:absolute;left:50%;top:0;bottom:0;border-left:2px solid #e6bc91;pointer-events:none}.range{display:block;width:100%;margin:18px 0;accent-color:#d2b38c}.labels{display:flex;justify-content:space-between;font-size:13px;gap:20px}section{margin:45px 0}h2{font:30px Georgia,serif}video{display:block;width:100%;max-height:70vh;background:#000;border-radius:12px}.note{border-left:2px solid #7d8c65;padding:8px 20px}.meta{font-size:13px}.actions{display:flex;flex-wrap:wrap;gap:20px;margin:20px 0}@media(max-width:600px){body{padding:20px}label{min-width:150px}.labels{font-size:11px}}
</style><header><span class="eyebrow">FILMMA / LABORATORIO DE IMAGEN</span><h1>El detalle se compara.</h1><p>La misma fuente MiniMax de <strong>1280 × 736</strong>, entregada en <strong>4K UHD</strong>. Todos los acabados conservan los 22 fotogramas a 24 fps, el encuadre completo y el audio. Esta prueba dura <strong>0,92 segundos</strong>.</p></header>
<div class="controls"><label>Antes<select id="before"></select></label><label>Después<select id="after"></select></label><label>Fotograma<select id="frame"><option value="0">Inicio · 0</option><option value="11" selected>Centro · 11</option><option value="21">Final · 21</option></select></label></div>
<div class="compare" id="comparison"><img id="left" alt="Imagen del acabado anterior"><img class="right" id="right" alt="Imagen del acabado comparado"><span class="divider" id="divider"></span></div>
<input class="range" id="split" type="range" min="0" max="100" value="50" aria-label="Dividir comparación entre antes y después"><div class="labels"><span id="left-label"></span><span id="right-label"></span></div>
<section><h2>Ver el movimiento</h2><label>Acabado del video<select id="video-method"></select></label><p class="meta">Los videos tienen idénticos fps, duración, tamaño y compresión. TTA se probó sólo en tres imágenes y no se presenta como video validado.</p><video id="video" controls playsinline preload="metadata" loop></video><div class="actions"><a id="download" download>Descargar este acabado 4K</a><a href="informe-calidad.md">Leer la revisión y sus límites</a></div></section>
<p class="note"><strong>Selección para esta toma: restauración al 65 %.</strong> Define mejor el objetivo y las piezas sin acentuar tanto la textura como el 85 %. El reescalado no corrige las letras inventadas ni la ligera deriva de perspectiva presentes en la generación. Esta prueba de un objeto no acredita continuidad de rostros ni de una toma larga.</p>
<script>
const methods=METHODS, stillMethods={...methods,'tta':'IA · TTA 65 % · sólo imágenes'};
const $=id=>document.getElementById(id);for(const id of ['before','after','video-method'])for(const [value,label] of Object.entries(id==='video-method'?methods:stillMethods))$(id).add(new Option(label,value));
$('before').value='lanczos';$('after').value='ai-restore-65';$('video-method').value='ai-restore-65';
const path=(method,frame)=>method==='tta'?`tta-restore-65-frame-${frame.padStart(3,'0')}.png`:`${method}/frame-${frame.padStart(3,'0')}.png`;
function refresh(){for(const [side,control] of [['left','before'],['right','after']]){$(side).src=path($(control).value,$('frame').value);$(side+'-label').textContent=stillMethods[$(control).value];}}
for(const id of ['before','after','frame'])$(id).onchange=refresh;
$('split').oninput=()=>{$('right').style.clipPath=`inset(0 0 0 ${$('split').value}%)`;$('divider').style.left=$('split').value+'%'};
function video(){const src=$('video-method').value+'/Filmma-720-a-4K.mp4';$('video').src=src;$('download').href=src;}
$('video-method').onchange=video;refresh();video();
</script></html>'''.replace('METHODS', json.dumps(methods, ensure_ascii=False))
if temporal and temporal['status'] == 'verified':
    html = html.replace('cinco', 'seis').replace('cinco', 'seis')
    html = html.replace("$('before').value='lanczos';$('after').value='ai-restore-65';$('video-method').value='ai-restore-65';", "$('before').value='ai-restore-65';$('after').value='ai-temporal-65';$('video-method').value='ai-temporal-65';")
    html = html.replace('<strong>Selección para esta toma: restauración al 65 %.</strong> Define mejor el objetivo y las piezas sin acentuar tanto la textura como el 85 %.', '<strong>Nuevo acabado: restauración estable al 65 %.</strong> Su diferencia visual es sutil: conserva la imagen de cada instante y estabiliza pequeñas correcciones de textura donde coincide el movimiento. Se mantienen disponibles los otros tratamientos.')
terminal_path = ROOT / 'output/qa/native-resolution/long-720/terminal-result.json'
terminal = json.loads(terminal_path.read_text()) if terminal_path.exists() else None
if terminal and terminal['status'] == 'failed':
    html = html.replace('</header>', '</header><p class="note"><strong>La prueba larga en HD se detuvo por presión crítica de memoria.</strong> Esta página muestra únicamente la prueba breve verificada. La toma de 14,375 s no llegó a producir un video; los originales se conservaron y la comprobación automática quedó pausada, sin reintentos.</p>', 1)
(OUT / 'index.html').write_text(html)
rows = []
for key, label in methods.items():
    metric = data['metrics'][key]
    rows.append(f"| {label} | {metric['sourceCycleMae']['mean']:.3f} | {metric['residualChangeMae']['mean']:.3f} |")
report = f'''# Revisión de calidad · fuente MiniMax HD

Se compararon cinco videos completos derivados de la misma fuente real: 1280 × 736, 22 fotogramas, 24 fps, 0,916667 s. Cada salida tiene 3840 × 2160, contenido completo encajado con bandas laterales, H.264 CRF 16 y los paquetes de audio originales intactos. Decodificación completa y hashes comprobados. Original conservado: `{data['sourceSha256']}`.

## Revisión visual

Se inspeccionaron el encuadre completo y recortes del objetivo/cuerpo en los fotogramas 0, 11 y 21. Lanczos y enfoque suave conservan bien la fuente, con menor definición aparente. El perfil de textura 35 % cambia poco la impresión de detalle. Restauración 65 % ofrece el mejor compromiso para este objeto: contornos y anillos más limpios, con textura menos acentuada que 85 %. El 85 % refuerza el grano del cuerpo y se percibe más procesado. La opción conservadora sigue disponible para piel y materiales delicados; no se probó aquí un rostro.

TTA se probó solamente en tres imágenes; tardó {sum(x['wallSeconds'] for x in data['tta']):.1f} s en total. En estos recortes su diferencia frente a la pasada normal es pequeña y no resuelve el pseudotexto. No se selecciona como tratamiento por defecto ni se afirma que exista un video TTA completo. La [documentación oficial del motor](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan#full-usages) describe su opción TTA y el control de mosaicos.

El original contiene letras inventadas y una leve variación de perspectiva/encuadre. El reescalado las conserva o define; no las corrige. La nitidez aparente mejoró, pero esta muestra no justifica calificar toda una película como de calidad excelente. Debe revisarse la toma larga terminada y sus personajes reales.

## Mediciones descriptivas

| Técnica | Cambio al volver al tamaño de fuente, MAE RGB | Cambio entre residuos consecutivos, MAE |
|---|---:|---:|
{chr(10).join(rows)}

Escala RGB 0–255, medidas antes de codificar. No hay referencia real en alta resolución: estos valores describen alteraciones y no puntúan calidad. Los fotogramas no están registrados por movimiento; el cambio del residuo no aísla parpadeo. No se usaron PSNR/SSIM contra una ampliación para presentarlos falsamente como detalle recuperado.

Tiempo total de la comparación: {data['elapsedSeconds']:.1f} s. RSS máximo separado del proceso: {data['peakWorkerRssBytes']/1024**3:.2f} GiB; mayor hijo: {data['peakChildRssBytes']/1024**3:.2f} GiB. No son máximos simultáneos ni toda la memoria GPU/unificada. Un solo reescalado neural por fotograma se reutilizó para comparar intensidades; los tiempos no son cinco inferencias independientes.

## Mejora del montaje

El editor conserva ahora sin pérdidas las muestras YUV420 de trabajo entre planos, fundidos y lotes de capas, y realiza la compresión final H.264 a CRF 16. Esto evita degradaciones de codificación acumuladas; no elimina pérdidas anteriores de la fuente ni conversiones de color/submuestreo realizadas por filtros. La prueba real compara exactamente las muestras decodificadas de la fuente y del plano intermedio. Las 21 pruebas de calidad, transiciones, acabado y exportación aprobaron, además de la compilación y la revisión de 720p en escritorio y móvil.

La fuente HD de 22 fotogramas está comprobada. No se simula una toma larga repitiendo o ralentizando esta muestra.
'''
if terminal and terminal['status'] == 'failed':
    report += '''\n## Resultado de la prueba larga HD\n\nEl trabajo `89c47b95-59dc-48f4-9449-c93d53763b51` terminó a las15:15:51UTC del18 deoctubre de2026 con `MEMORY_PRESSURE`. macOS notificó presión crítica al intentar1280×736,345fotogramas24fps,20pasos. El supervisor paró el motor antes de producir un video. El máximo observado de physicalfootprint fue16.086GB y RSS4.406GB, con crecimiento de intercambio0.587GB y nivel de presión4; no equivalen a toda la memoriaGPU/unificada. Se conservaron los seis archivos protegidos y producción2038. No hubo reintentos ni se relajaron límites; la comprobación automática quedó pausada.\n\nEsto acredita un fallo de esta configuración en el estado del equipo durante la prueba; no determina por sí solo el máximo exacto de duración HD. Cualquier optimización futura requiere una nueva validación. No se presenta una toma más corta ni un montaje como sustituto de los14,375s continuos solicitados. Evidencia: `output/qa/native-resolution/long-720/terminal-result.json`.\n'''
if temporal and temporal['status'] == 'verified':
    previous = temporal['metrics']['ai-restore-65']['residualChangeMae']['mean']
    stable = temporal['metrics']['ai-temporal-65']['residualChangeMae']['mean']
    reduction = (1 - stable / previous) * 100
    stats = temporal['temporalMetrics']
    report += f'\n## Restauración estable local\n\nSe añadió una sexta versión de video, con el mismo modelo y fuerza65%. Flujo óptico bidireccional sobre la fuente, comprobación de consistencia y color, rechazo de cortes/oclusiones y mezcla limitada exclusivamente al residuo de IA. La imagen base actual no se desplaza ni mezcla con otra. Sólo se conserva un fotograma de estado. Las20 pruebasPython y28 pruebasAPI/película aprobaron; incluyen cortes, objetos nuevos, movimiento y memoria de estado constante.\n\nEn los22 fotogramasHD, la variación media de los residuos pasó de{previous:.6f} a{stable:.6f}, una reducción de{reduction:.1f}%. Es una medición descriptiva sin registro de movimiento, no una puntuación perceptual ni una medida aislada de parpadeo. Se estabilizaron{stats["stabilizedFrames"]} fotogramas; confianza media{stats["meanConfidence"]:.3f}; máxima modificación temporal{stats["maxTemporalChangeRgb"]}/255 por canal. En los recortes revisados se conserva la definición del objetivo con una suavización leve de la textura. La diferencia es moderada; siguen presentes las letras inventadas y la deriva de perspectiva.\n\nLa comparación completa de ambos tratamientos tardó{temporal["elapsedSeconds"]:.1f}s. MáximoRSS separado: proceso{temporal["peakWorkerRssBytes"]/1024**3:.2f}GiB, mayor hijo{temporal["peakChildRssBytes"]/1024**3:.2f}GiB; no es toda la memoriaGPU/unificada. Se conservaron22frames24fps0.916667s, audio y fuente. La [documentación de flujo óptico de OpenCV](https://docs.opencv.org/4.11.0/d4/dee/tutorial_optical_flow.html) describe el método base; esta combinación y sus límites son propios de Filmma.\n'
(OUT / 'informe-calidad.md').write_text(report)
destination = ROOT / 'dist/quality-review'
destination.mkdir(exist_ok=True)
for name in ('index.html', 'informe-calidad.md'):
    shutil.copyfile(OUT / name, destination / name)
for key in methods:
    target = destination / key
    target.mkdir(exist_ok=True)
    for name in ('Filmma-720-a-4K.mp4', 'frame-000.png', 'frame-011.png', 'frame-021.png'):
        shutil.copyfile(OUT / key / name, target / name)
for frame in (0, 11, 21):
    name = f'tta-restore-65-frame-{frame:03d}.png'
    shutil.copyfile(OUT / name, destination / name)
print('http://127.0.0.1:4318/quality-review/index.html')
