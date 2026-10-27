# Voces locales de Filmma

Filmma usa **Kokoro-82M v1.0** mediante `kokoro-onnx 0.6.1`. La voz se identifica por un preset estable que el proyecto puede asignar a cada personaje. No se clonan grabaciones ni se envían diálogos a un servicio remoto durante la síntesis.

La configuración comprobada utiliza **CPU, cuatro hilos, ONNX Runtime 1.23.2**. Deja disponible la GPU para el motor de video. El entorno `runtime/speech/.venv` es independiente de `runtime/.venv`; instalar voces no cambia las dependencias de MiniMax, LTX ni reescalado.

## Modelos y elección

Los pesos de Kokoro tienen licencia Apache-2.0 y el adaptador ONNX usa MIT. El [catálogo oficial](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) incluye tres voces españolas: `ef_dora`, `em_alex` y `em_santa`. Filmma también habilita `af_heart` y `am_michael` para inglés. Español no implica acento chileno; nombres, prosodia y actuación requieren escucha y revisión.

Se evaluó [Qwen3-TTS 0.6B CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice): ofrece español y control expresivo, pero su ejemplo oficial usa CUDA. No está instalado ni validado en Filmma. Para esta primera integración se eligió Kokoro por la prueba efectiva de latencia y memoria en este Mac, no por afirmar superioridad perceptual sobre Qwen.

La descarga fijada es la [publicación del adaptador `model-files-v1.1`](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1), con **353.719.767 bytes** entre modelo FP32 y voces. `runtime/speech/model.json` fija tamaño y SHA256 publicados por GitHub para cada archivo. La versión de publicación no cambia la versión del modelo: se instala Kokoro **v1.0**. `requirements.lock` fija los 17 paquetes y sus hashes; la instalación sólo acepta wheels.

Las dependencias fonéticas phonemizer y eSpeak NG incluyen GPL-3.0; sus licencias no deben omitirse al redistribuir el entorno. Se conserva un inventario y copias de licencias en `runtime/speech/licenses/`. El modelo Apache-2.0 no tiene una restricción de uso no comercial. Esto no convierte las licencias de todo el entorno en Apache-2.0.

## Contrato

```sh
python3 runtime/filmma_speech.py doctor --json
python3 runtime/filmma_speech.py setup --json
python3 runtime/filmma_speech.py synthesize --request /ruta/dialogo.json --json
```

`install` y `generate` son alias de `setup` y `synthesize`. La salida estándar contiene un único JSON final. Los avances van a stderr; al instalar también aparecen los mensajes del gestor de paquetes.

```json
{
  "text": "No cierres el cine todavía. Queda una historia por contar.",
  "language": "es",
  "voiceId": "ef_dora",
  "speed": 1,
  "maxDurationSeconds": 15,
  "outputPath": "/ruta/nueva/voz.wav"
}
```

`voice` también se acepta como alias. El servidor debe validar que el destino pertenece a su almacén y enlazar la salida con el personaje, plano y diálogo correspondiente. El runtime exige una ruta absoluta WAV nueva y no sobrescribe archivos ni enlaces simbólicos. Publica mediante un enlace atómico sin reemplazo, después de validar el audio.

Límites: 600 caracteres, velocidad entre 0,5 y 2, hasta 15 segundos por diálogo. Si la síntesis supera el límite, responde `DURATION_LIMIT`, informa la duración y **no publica ni recorta el WAV**. Debe acortarse la línea, dividirse en turnos o ajustar la velocidad. No se confunde duración de voz con duración del montaje.

El resultado es mono, 24 kHz, PCM de 16 bits. Devuelve duración, SHA256 del audio y texto, modelo y huella de pesos, preset, velocidad, tiempo y pico RSS. Rechaza audio no finito o prácticamente silencioso. Sólo reduce ganancia cuando el pico lo exige para evitar saturación; no restaura rostros ni cambia imágenes.

Preparación y síntesis comparten un bloqueo local que evita trabajos duplicados. Una descarga interrumpida conserva `.part` y continúa con HTTP Range; sólo publica pesos con tamaño y SHA256 correctos. Un parcial corrupto se conserva para revisión. Cancelar termina el proceso hijo y no sustituye originales.

## Comprobación en este equipo

El **17 de octubre de 2026, hora de Chile**, se generó el mismo diálogo de 96 caracteres en dos voces:

| Voz | Duración WAV | Tiempo del worker | Pico RSS del worker |
| --- | ---: | ---: | ---: |
| Dora | 5,669 s | 1,613 s | 677.052.416 bytes |
| Alex | 5,894 s | 3,309 s | 700.760.064 bytes |

Ambos WAV superaron FFprobe y una decodificación completa con FFmpeg. Los informes, solicitudes y audios están en `runtime/validation/speech-20261018-001721/`. La fecha del nombre de esa carpeta está en UTC. El tiempo incluye comprobación y carga en el worker, pero no representa una garantía para todos los textos. RSS mide ese proceso; no la memoria total del sistema. No se usó GPU. Esta comprobación objetiva no sustituye una evaluación perceptual de pronunciación, naturalidad o actuación.

Una tercera síntesis con Dora conservó la voz configurada y la duración, pero no el SHA256: el motor no ofrece aquí reproducción idéntica de cada muestra. Para conservar una interpretación concreta, se reutiliza su WAV original. Una prueba real de 21,061 segundos produjo `DURATION_LIMIT` y confirmó que no se publicó un WAV recortado.

```sh
runtime/speech/.venv/bin/python -m unittest discover -s tests -p 'test_speech*.py' -v
```

Las pruebas cubren voz/idioma, límites, WAV real con motor simulado, bloqueo, preservación de destinos, reanudación, SHA256, silencio y rechazo de duración sin truncamiento.
