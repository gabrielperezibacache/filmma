# Filmma 0.16 · Interfaz, modelos y voces

La revisión reúne una interfaz más clara y un flujo conectado del guion al montaje, sin sustituir los originales ni separar a los personajes de sus planos.

## Qué cambia

- Navegación, tipografía, formularios y estados vacíos revisados en los doce apartados. Guardado visible con reintento, retorno de foco y recorrido con teclado.
- Visor ampliado en Montaje y accesos directos entre guion, voces, biblioteca y continuidad.
- Modelos: Generación, Instalación y modelos y Pruebas de calidad en apartados separados. Resolución expresada en píxeles, duración editable y fps con valores recomendados. El acabado 4K permanece separado de la generación nativa.
- H3 GGUF: catálogo, descargas reanudables, procedencia y validación aislada. Las mediciones Q4/Q8 de 512 × 320 y 22 fotogramas no acreditan 720p ni 15 segundos.
- ElevenLabs: voces por personaje, búsqueda y muestra pública, ajustes por modelo y tiempos de habla para subtítulos. Clave fuera del proyecto; permisos privados en Mac y cifrado DPAPI por usuario en Windows. Qwen local continúa disponible.
- Empaquetado con lista explícita de recursos. Pruebas en carpetas y puertos aislados; perfiles de Electron de prueba separados del instalado.

## Datos y límites

Los instaladores no incluyen proyectos, credenciales ni pesos. Actualizar no requiere borrar `data/`, los originales, las referencias ni los modelos. Los ZIP de proyecto tampoco incluyen conexiones privadas.

Las capturas muestran un proyecto ficticio y el catálogo de ElevenLabs está simulado. La prueba con una cuenta real de ElevenLabs queda pendiente de conectarla. Los informes de cada release distinguen el arranque del paquete de una inferencia GPU: los adaptadores Metal/MLX requieren Apple Silicon y CUDA externo no se presenta como inferencia Windows verificada.

Las builds públicas incluyen DMG y ZIP arm64 para Mac, Setup y ZIP x64 para Windows, informes de arranque y SHA256. No tienen firma de editor ni notarización.
