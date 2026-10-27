# Voces propias por personaje con Qwen local

Filmma utiliza el modelo Qwen3-TTS y el ejecutable llama-tts que ya usa Hermes. Cada personaje puede crear su propia referencia a partir de un audio importado. Hermes conserva su configuración y su voz predeterminada; no se descarga otro modelo ni se copia la instalación.

## Flujo

1. Importa un audio con una sola persona hablando, sin música, ruido fuerte ni reverberación marcada. Una referencia clara de 6–12 segundos suele ser más útil que un fragmento muy corto; el rango permitido es 3–30 segundos. Escúchala antes de elegirla.
2. Selecciona el personaje y un fragmento del audio. **Crear y usar voz** crea una copia WAV mono PCM16 de 24 kHz. El original se conserva con su tamaño, formato y contenido intactos.
3. El perfil se guarda en el personaje y se comparte entre todas sus intervenciones del guion. Cada generación queda vinculada al perfil y a la huella SHA256 de la referencia.
4. Escucha cada interpretación antes de aplicar su audio, sus subtítulos o la sincronización labial. Cambiar de perfil deja las versiones anteriores en la biblioteca y las marca como desactualizadas para el diálogo actual.
5. El paquete de película incluye tanto el original como la referencia preparada. Al importarlo, Filmma reconstruye los vínculos de personajes, voces, diálogos y sincronizaciones. No incluye rutas de Hermes, claves o modelos.

La referencia constante ayuda a mantener el timbre, pero no garantiza actuación idéntica ni una semejanza biométrica medida. No se detecta automáticamente si un audio contiene una sola persona o música. La comprobación automática verifica formato, duración, decodificación, nivel audible e integridad; la elección vocal sigue siendo una decisión creativa.

## Contrato local

`POST /api/speech/qwen/profiles`

```json
{
  "projectId": "pelicula",
  "characterId": "personaje",
  "sourceAssetId": "audio-importado",
  "start": 1,
  "duration": 8,
  "name": "Voz de Elena"
}
```

Devuelve `{project, asset, voice}` con estado 201. No realiza inferencia. Si el usuario cambia la voz del personaje mientras se prepara el audio, la solicitud devuelve 409 y no modifica esa selección.

`Asset.voiceReference` conserva `projectId`, `characterId`, `sourceAssetId`, `sourceSha256`, `outputSha256`, `start`, `duration`, `sampleRate`, `createdAt` y `name`. Es metadata del servidor: un guardado normal no puede modificarla ni inventarla. El recurso sigue siendo un audio reproducible en la biblioteca.

La voz del personaje es `{engine:'qwen', voiceId:'profile-'+asset.id, referenceAssetId:asset.id, referenceSha256:outputSha256, language:'es'|'en', speed:0.7–1.3}`. El servidor resuelve la ruta del recurso y verifica SHA256 antes de pasarlo al motor; el navegador no envía rutas de archivos al sintetizador.

La solicitud interna al runtime añade `referencePath` y `expectedReferenceSha256`. La conexión original de Hermes permanece intacta. `doctor.modelReady` comprueba los modelos y dependencias independientemente de la referencia predeterminada de Hermes; por eso un perfil propio sigue disponible aunque esa referencia predeterminada no exista. `doctor.ready` continúa describiendo la disponibilidad de la voz predeterminada.

## Recursos y límites

- Síntesis en el carril serial que comparte generación, mejora y sincronización labial; sin solapar otra inferencia de Filmma. Comprueba además procesos llama-tts externos de Hermes.
- Cuatro hilos, Metal, semilla fija, límite de RSS muestreada del hijo de 8 GiB. Ese límite no representa una medida completa de toda la memoria unificada de GPU.
- Máximo 600 caracteres y 15 segundos por resultado. Un diálogo excesivo se rechaza completo: nunca se publica truncado.
- Referencias distintas se pasan por solicitud; no existe un archivo de voz global que otra escena pueda sustituir accidentalmente.

## Verificación

- `tests/voice-profiles.test.ts`: cuatro pruebas de API con FFmpeg real y motor de síntesis simulado. Cubren originales, normalización, continuidad entre escenas, rutas no permitidas, silencio, SHA256, metadata inmutable, cambio de perfil, exportación ZIP e importación con vínculos remapeados.
- `tests/test_qwen_runtime.py`: 19 pruebas, incluidas referencia propia sin modificar Hermes, perfil independiente de la referencia predeterminada, huella incorrecta y referencia demasiado corta antes de cargar el modelo.
- Las pruebas anteriores no miden similitud perceptual de clonación. La prueba real de modelo se registra separadamente en la evidencia de QA cuando se ejecute.

## Prueba real del modelo en M4 Max de 36 GB

Evidencia: `output/qa/cinema-voices/verified.json`, `metrics-*.json` y `store/project.json`. Se crearon dos perfiles nuevos mediante la API local, con referencias sintéticas Kokoro distintas (Dora y Alex), y se sintetizó una frase de cada personaje con el Qwen real de Hermes. No se utilizaron créditos de servicios externos.

| Perfil | Resultado WAV | Tiempo del runtime | RSS máxima muestreada del hijo |
| --- | --- | --- | --- |
| Elena, referencia Dora | 1,36 s, mono PCM16 24 kHz | 2,214 s | 3.423.617.024 bytes |
| Víctor, referencia Alex | 1,60 s, mono PCM16 24 kHz | 1,591 s | 3.476.340.736 bytes |

Los dos WAV superaron FFprobe y decodificación completa con FFmpeg. Se comprobaron referencias distintas por SHA256, el vínculo entre personaje y perfil y la procedencia de cada resultado. La película de producción, la configuración de Hermes, su voz predeterminada y los originales conservaron sus hashes. La descarga de MiniMax continuó sin interrupción.

Esta prueba demuestra ejecución local y aislamiento de referencias. No constituye una medición perceptual de semejanza ni una verificación automática de pronunciación o actuación. La RSS se muestrea cada segundo y no mide toda la memoria unificada utilizada por Metal. No se ejecutó una segunda inferencia de sincronización labial; la integración con ese flujo sigue cubierta por las pruebas de dominio y API.

Para reutilizar el proyecto aislado: `FILMMA_QA_REUSE=1 node --import tsx scripts/qa-voice-clones.mjs` abre el servidor 4316 sin reiniciar sus datos. No debe iniciarse si ese puerto ya está ocupado. El adaptador de auditoría sólo registra métricas: llama al runtime real y no altera el modelo ni sus resultados.
