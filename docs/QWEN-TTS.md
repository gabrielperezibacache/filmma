# Qwen local conectado a Hermes

Filmma reutiliza el Qwen3-TTS que Hermes ya tiene configurado en este Mac. No instala otra copia, no descarga pesos y no modifica Hermes. La voz se muestra como **Voz de Hermes**; es la referencia existente, no una voz nueva ni una biblioteca de hablantes de Qwen.

## Instalación detectada

La sección `tts` de `~/.hermes/config.yaml` selecciona `qwen3-llama`, cuyo adaptador `~/.hermes/tts/qwen_tts_auto.py` usa `llama-tts`. Filmma conecta directamente con ese binario y sus archivos locales para imponer ejecución sin red, duración y conservación de originales. No ejecuta el adaptador original con `-hf`, porque ese comando podría descargar si cambia la caché.

- Binario: `~/Documents/Herramientas IA/llama.cpp-dflash2/build-dflash2/bin/llama-tts`.
- Versión observada: `0.1.2-dev`, build `10507`, commit `d1a522fc8`.
- Modelo: `ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF`, revisión `ca27d74bc954b73dadab5b71ca265d87fc861a7c`.
- Backbone Q4_K_M: 1.035.965.280 bytes, SHA256 `8d18c94acb2addd042f97da63c98be144eafa76d0d9495177eab65130cf85129`.
- Proyector Q8_0: 446.422.912 bytes, SHA256 `6fd65188839bcd6ecc91b277ad471e22a0edfada4699a0fe82f1165c18cfcce2`.
- Referencia existente: `~/.hermes/tts/voz-2-reference.wav`.
- Conexión de Filmma: `runtime/qwen/connection.json`; contiene rutas y huellas, ninguna credencial.

Se utiliza **llama.cpp con Metal**, porque es el motor instalado de Hermes. No se anuncia como MLX ni se convierte o duplica el modelo. La instalación PyTorch adicional de `~/Qwen3-TTS` no se toca.

## Uso y límites

El motor se selecciona por personaje o narrador en Voces. La misma referencia se reutiliza en cada plano. El idioma se fija explícitamente en español o inglés, sin detección que cambie de idioma en líneas cortas. El ritmo admite 0,7–1,3; el ajuste temporal usa FFmpeg sin cambiar el tono. A ritmo 1 se conserva la duración completa sin filtro de ajuste temporal.

Cada solicitud admite hasta 600 caracteres y un WAV de máximo 15 segundos. Una generación demasiado larga, que agote sus 256 pasos de audio o cuyo final no pueda verificarse se rechaza entera; no se publica un diálogo cortado. Esto limita la duración del resultado, no promete que cualquier texto de 600 caracteres quepa en un plano.

El perfil para M4 Max usa cuatro hilos, contexto de 2.048 tokens, batch 256, microbatch 128, una sola secuencia y semilla 42. El proceso se libera al terminar. La semilla y referencia estables ayudan a la continuidad, pero no garantizan actuación ni pronunciación idénticas. El backend debe usar la misma cola pesada que video, reescalado y sincronización labial. El adaptador detecta también un `llama-tts` activo fuera de Filmma antes de iniciar y durante el trabajo; si Hermes comienza otro, Filmma detiene su propio proceso.

La protección de memoria vigila RSS de `llama-tts` cada segundo y cancela al superar 8 GiB. **No es un límite de memoria unificada ni una medición total de GPU**; puede omitir picos entre muestras. No debe presentarse como garantía absoluta de consumo del equipo.

## Contrato

```sh
python3 runtime/filmma_qwen_tts.py doctor --json
python3 runtime/filmma_qwen_tts.py synthesize --request request.json --json
```

`doctor` devuelve `ready`, `engine: qwen`, `model`, `modelRevision`, `voices`, `referenceSha256`, límites, disponibilidad y rutas de conexión local. Solo examina metadatos/cabeceras del modelo y calcula SHA256 de la pequeña referencia; no relee 1,48 GB en cada actualización del panel.

La solicitud tiene `text`, `voiceId: hermes-default`, `language: es | en`, `speed`, `outputPath` absoluto WAV, `maxDurationSeconds <= 15` y `expectedReferenceSha256` opcional. El backend fija esta última al elegir la voz para bloquear un cambio silencioso de la referencia entre escenas. Si Hermes cambia ese archivo, la interfaz debe pedir revisar y volver a elegir la voz.

Antes de inferir se verifican SHA256 de ambos pesos. El resultado se guarda en `runtime/qwen/verified-models.json`, asociado a ruta real, tamaño, mtime, ctime e inode; cualquier cambio invalida esa comprobación. Modelo, binario y referencia se revisan otra vez antes de publicar.

El resultado incluye duración, formato, SHA256 del audio, texto, modelo, proyector, referencia y binario, revisión del modelo y métricas. El WAV final se publica mediante enlace atómico que falla si ya existe el destino. Se rechazan también enlaces simbólicos existentes. Los fallos de proceso conservan un registro local con permiso 0600 en `runtime/qwen/failures/` y devuelven su ruta de diagnóstico.

`setup` equivale a comprobar la conexión existente; no instala ni descarga nada. Si faltan los archivos, hay que corregir su ruta en la conexión o restaurar la instalación de Hermes. No hay sustitución silenciosa por otra voz, nube o modelo.

## Validación real

El 18 de octubre de 2026 UTC se sintetizó «La película comienza ahora.» con la referencia de Hermes en el M4 Max. La primera ejecución dentro de la restricción de herramientas no pudo crear la cola Metal; el registro se conservó. La ejecución autorizada con acceso a Metal completó el trabajo sin cambiar Hermes.

- Evidencia inicial: `runtime/qwen/validation/hermes-filmma.wav` y `result.json`.
- PCM16 mono, 24.000 Hz, 1,996125 s, 25 pasos de audio.
- 9,758 segundos de trabajo; RSS máximo muestreado: 3.507.798.016 bytes, aproximadamente 3,27 GiB, con los límites de medición anteriores.
- FFprobe y decodificación completa con FFmpeg correctos; referencias y pesos conservaron sus huellas.
- Esta ejecución inicial utilizaba `atempo=1`, que varió unas muestras del extremo; el adaptador final evita ese filtro a velocidad 1. La evidencia inicial se conserva y no se sobrescribe.

Las pruebas automáticas comprueban validación, conservación de archivos, límites de tiempo, cambio de referencia antes/durante la inferencia, caché de integridad, colisiones de publicación y procesos simultáneos. No evalúan parecido perceptual de voz ni acento.

## Fuentes técnicas

- [Qwen3-TTS oficial](https://github.com/QwenLM/Qwen3-TTS).
- [Modelo GGUF utilizado por Hermes](https://huggingface.co/ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF/tree/ca27d74bc954b73dadab5b71ca265d87fc861a7c).
- [Documentación oficial de llama.cpp TTS](https://github.com/ggml-org/llama.cpp/tree/master/tools/tts); para compatibilidad se comprobó además el código y la ayuda del binario instalado localmente.

La validación final desde la interfaz de Filmma produjo `output/qa/voice-providers/store/media/0cae8533-0c40-4778-9591-94539ccf7931.wav`: 1,040000 s, PCM16 mono 24 kHz, decodificación completa correcta. Confirma la versión definitiva con `anull` a velocidad 1. La referencia SHA256 y el proyecto de producción se conservaron; véase `output/qa/voice-providers/verified.json`.
