# MiniMax H3 cuantizado: prueba local en M4 Max

Comprobación del 28 de octubre de 2026 en Apple M4 Max con **36 GiB** de memoria
unificada. Se eligió **GGUF Q4_K** como variante local de menor lectura del disco.
El BF16 original se conserva con su configuración y pesos en el SSD externo.

## Condiciones y alcance

- Tres tomas aisladas en orden **Q4 → Q8 → Q4**, con idéntica referencia ficticia
  de Elena, prompt, semilla 42, Ref2VA, 512 × 320, 22 fotogramas a 24 fps y 20 pasos.
- Se conservaron los 50 bloques, Euler, reutilización 1, sin Turbo, LoRA ni saltos
  de pasos. Q4 y Q8 usan el mismo codificador Q4_K_M con visión, 50 capas, y VAE FP16.
- El video dura 22/24 s; el contenedor puede durar 0,925 s por el audio AAC. Se
  comprobaron dimensiones, reloj, fotogramas, audio y decodificación completa.
- Un cuarto ensayo pasó por la API real de Filmma, con FL2VA, imagen inicial,
  semilla 43 y el mismo lienzo, fotogramas y pasos. La selección del clip, el guion,
  personaje y referencia permanecieron vinculados tras guardar y recargar.
- Una quinta toma recorrió **Probar con este personaje → visor → aprobar** desde
  Filmma: 168,985 s y 10,97 GiB de footprint. Usó el prompt técnico del flujo de
  validación, por lo que no se añade a la comparación controlada de la tabla.
- El SSD externo no estaba disponible. **No se ejecutó una comparación con BF16**,
  ni se volvió a descargar ese modelo. Q8 sólo se descargó y probó para Ref2VA;
  su transformador FL2VA sigue pendiente de descarga para activar Q8 completo.

## Mediciones

| Variante | Generación | Footprint pico | RSS pico | Crecimiento swap | Lecturas lógicas DiT | Lecturas del proceso muestreadas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Q4 · primera toma | 180.3 s | 10.70 GiB | 6.71 GiB | 0.0 MiB | 202.076 GiB | 33.55 GiB |
| Q8 · referencias | 222.5 s | 10.78 GiB | 7.80 GiB | 0.0 MiB | 381.698 GiB | 404.74 GiB |
| Q4 · después de Q8 | 170.6 s | 11.13 GiB | 7.80 GiB | 0.5 MiB | 202.076 GiB | 36.48 GiB |

La toma desde Filmma tardó **185.11 s**, con **11.41 GiB** de footprint pico y sin
aumento de swap. Los 22 fotogramas RGB sin compresión de las dos pruebas Q4 son
idénticos por SHA256.

Q4 leyó **47,1 % menos datos lógicos del transformador** que Q8 en estas tomas.
El menor tamaño también permitió más reutilización de caché en este equipo. Las
lecturas lógicas son bytes solicitados por el motor; no equivalen a lecturas
físicas del SSD. `proc_pid_rusage` mide E/S atribuida al proceso, con el efecto de
la caché, y el muestreo puede omitir el final. No se purgó la caché del sistema;
los tiempos son observaciones locales, no una garantía para otros planos.

El footprint y RSS son mediciones del proceso; los buffers Metal, caché de
archivos, compresión y swap se solapan y **no se suman** como memoria unificada.
Los tres ensayos mantuvieron presión normal. Se conservaron las paradas de
24 GiB de footprint, 28 GiB de RSS, 2 GiB de aumento de swap, presión crítica y
la reserva de 20 GiB en disco. Los perfiles largos/HD mantienen sus propios
límites y no quedan validados por estas tomas breves.

## Calidad y continuidad

Se inspeccionaron cinco fotogramas distribuidos por toma y los originales,
antes de cualquier reescalado. No se observó una pérdida evidente con Q4 frente
a Q8 en rostro, cabello, abrigo o butacas en esta comparación breve.

Apple Vision **marcó posibles cambios respecto a la referencia en ambas
variantes**. Sus umbrales de apariencia no son reconocimiento biométrico y
cambian con la pose, resolución y luz. La aceptación como comparación de
cuantización no levanta esas alertas: la identidad debe revisarse por plano
antes de exportar. No se ajustaron los umbrales para hacer pasar la prueba.
Vision también marcó los fotogramas de la toma con imagen inicial para revisión.
La imagen inicial ofrece un ancla visual directa; tampoco certifica
continuidad en otros ángulos, resoluciones o tomas de 15 segundos.

Se conservaron por hash diez archivos protegidos, incluyendo el proyecto de
producción, medios anteriores y la referencia. La subida de prueba es una copia
idéntica. Cada original nuevo tiene un sidecar con variante, revisiones,
parámetros, hashes de condicionamiento y vínculos a proyecto, plano y personaje.
La validación de modelos mantiene sus videos fuera del proyecto: conserva sus
referencias y permite revisarlos desde Motores sin añadir planos.

## Uso en Filmma

En **Motores → MiniMax H3 · GGUF**, Q4 está disponible tras completar los pesos
y revisar su toma. La activación comprueba de nuevo todos los hashes y la
identidad del adaptador. No se mezclan GGUF y BF16 en una misma carpeta. Se
puede volver al BF16 conservado desde el mismo apartado.

Esta ruta sigue descomprimiendo bloques a BF16 en la GPU. **No es residencia
completa de H3 en RAM**: conserva la caché del sistema y reduce el volumen leído
por bloques. Q4 completo ocupa aproximadamente 46,9 GB incluyendo FL2VA,
Ref2VA, codificador y ambos VAE. La generación no descarga pesos por sorpresa.
El límite de 15 segundos no cambia; esta prueba no certifica 720p ni 15 s.

Para repetir de forma aislada, con Filmma abierto y sin otra inferencia:

```sh
python3 runtime/h3_quant_benchmark.py \
  --model runtime/models/minimax-h3-gguf-q4 \
  --output output/qa/h3-quantized/nueva-prueba \
  --variant gguf-q4 \
  --reference /ruta/a/referencia.png
```

El ejecutable de comparación comprueba las colas de producción y QA disponibles, adquiere
el bloqueo real de generación y conserva los errores. No sobrescribe una
carpeta de ensayo ni reintenta automáticamente una inferencia.

## Procedencia y evidencia

- Motor MIT: [H3cApp](https://github.com/JunzoKamahara/H3cApp), revisión
  `754858b4f28acd537d16a6ad97c5ee0f0635e950`.
- Pesos: [Unsloth MiniMax-H3-GGUF](https://huggingface.co/unsloth/MiniMax-H3-GGUF),
  revisión `babc040eff0084465460ead58fdb8ec44296f8dd`. Se mantiene la licencia de H3.
- Configuración oficial: MiniMax-AI, revisión
  `42ed227ee7df40d41602854ae760620d6eb651fe`.
- Catálogo verificable: `runtime/h3-gguf-catalog.json`.
- Evidencia local conservada en `output/qa/h3-quantized/`: `comparison.json`,
  `comparison.png`, `continuity-checks.json`, `integration-verification.json`,
  originales, fotogramas PNG/RGB, logs, hashes y métricas de cada toma.
- Activación local: `runtime/validation/h3-quantized/latest.json`. No se publica
  ni se distribuye como una validación de otros equipos.
