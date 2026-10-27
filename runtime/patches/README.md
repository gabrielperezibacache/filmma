# Parches de compatibilidad del motor H3

`h3.json` registra cambios locales pequeños sobre la revisión de H3 fijada en `model-catalog.json`. `filmma_runtime.py install-runtime --model minimax-h3` los aplica antes de compilar. Cada parche exige el SHA256 exacto de la fuente original o de la versión ya corregida. Una fuente diferente se conserva y se detiene la instalación para revisar el cambio; no se reemplazan modificaciones del usuario.

## Archivos auxiliares de macOS

El lector de `h3_weights.c` trataba los archivos AppleDouble `._*.safetensors` creados por macOS en el SSD como pesos. El parche `ignore-hidden-safetensors-shards` excluye nombres que comienzan por punto, igual que el inventario de `h3_safetensors.c`. No elimina archivos del SSD y mantiene el rechazo de un shard visible que sea inválido.

Comprobación sin GPU ni pesos reales:

```sh
python3 -m unittest discover -s tests -p test_h3_weight_store.py
```

La prueba compila los lectores C reales con funciones GPU que abortan si se invocan, crea un tensor mínimo y metadatos ocultos, y verifica tanto la lectura correcta como la conservación de archivos y el rechazo de un peso visible corrupto. También comprueba aplicación idempotente y protección de fuentes modificadas.

Diagnóstico original y primera validación interrumpida antes de inferencia: `runtime/validation/minimax-h3-20261018-020504/`. Sus registros se conservan; la ausencia de un MP4 en ese intento no se considera generación exitosa.

## Recursos Metal y directorio de ejecución

H3 busca `h3_shaders.metal` mediante rutas relativas. El adaptador de Filmma resuelve el ejecutable H3 y su carpeta real (también si se configuró un enlace simbólico), verifica el shader y utiliza esa carpeta como directorio de ejecución. Las rutas de pesos, referencias y resultados permanecen absolutas; LTX conserva el directorio del proyecto y su intérprete de entorno virtual. El diagnóstico no declara disponible H3 si falta el shader. No se copian ni se modifican los recursos Metal del motor.

```sh
python3 -m unittest discover -s tests -p 'test_h3_*.py'
```

La regresión del lanzador ejecuta un sustituto de host desde otra carpeta con espacios y un enlace al binario. Comprueba el acceso relativo al shader, las rutas absolutas y la conservación de originales, sin pesos ni GPU. La comprobación adicional `h3_audio_gpu_tests` compiló el shader real y contrastó seis primitivas pequeñas con referencias CPU: el contexto antiguo falló y el contexto corregido pasó. Evidencia: `runtime/validation/minimax-h3-20261018-021440-retry1/shader-repair-check.json`.

Esta comprobación de primitivas no constituye una inferencia MiniMax ni un MP4 validado. Los dos intentos de video y sus fallos previos a la inferencia permanecen registrados. Tras corregir ambos problemas se autorizó un único intento final, sin más reintentos automáticos: `runtime/validation/minimax-h3-20261018-021950-final/`. Su `process.json` registra hashes del motor y adaptador, relación con los intentos anteriores y estado actual; el supervisor comprueba el MP4 antes de marcar `media-verified`. No se debe duplicar porque no aparezca en la cola HTTP: este proceso es autónomo y mantiene el bloqueo de generación.
