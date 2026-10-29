# Configuración y modelos locales

Abre **Configuración** en la navegación o con **⌘,**. El tema, acento, idioma (español/inglés), tamaño, movimiento reducido, densidad y pantalla inicial se guardan en `data/application-settings.json`, separados de la película. Los temas no aplican filtros al visor. El catálogo de inglés sólo transforma literales de interfaz; nunca reescribe guiones, prompts o nombres del proyecto.

## Formato y FPS

El botón **16:9 · 24 fps** en la cabecera abre un borrador con vista del encuadre. Cancelar conserva el proyecto; Aplicar actualiza toda la película. Hay seis proporciones y 24/25/30/48/50/60 fps. Los valores iniciales recomendados son 16:9 y 24 fps. La generación de MiniMax y LTX es nativa a 24 fps; exportar a otra cadencia adapta fotogramas sin cambiar la velocidad. La comprobación rechaza cambios que hagan desaparecer subtítulos, clips o fotogramas clave. Se conserva la duración en segundos.

## Preparar un modelo

1. Abre **Motores**. Revisa el chip, memoria y modelos integrados. LTX 2B destilado es la opción ligera; MiniMax H3 es una opción avanzada con lectura desde SSD. Estas son recomendaciones de compatibilidad del adaptador, no una clasificación general de todos los modelos existentes.
2. Selecciona una carpeta absoluta. El instalador ofrece selector nativo. Para un modelo ya instalado, usa **Conectar carpeta existente**. No se mueve ni elimina ningún archivo.
3. **Revisar espacio y descarga** calcula los bytes pendientes, incluye parciales y reserva 20 GiB. Un SSD desconectado no se trata como una carpeta interna para descargar otra copia.
4. Revisa la licencia y confirma **Preparar y descargar / reanudar**. Se instala el motor aislado y después los pesos de una revisión fijada. MiniMax requiere las herramientas de compilación de Apple; LTX prepara Python 3.12 y MLX en su propio entorno con uv. No se instala software global automáticamente. Si falta una herramienta de Apple, el error conserva la descarga y explica la dependencia pendiente.
5. La tarea muestra progreso y se puede pausar. Al reanudar se reutilizan archivos completos comprobados y parciales HTTP. Las solicitudes simultáneas de preparación del mismo modelo comparten una tarea.
6. **Verificar integridad** lee todos los archivos, comprueba tamaño y SHA256 donde el catálogo publica hash. Es una tarea cancelable; no descarga ni repara archivos silenciosamente. Un archivo inesperado se conserva al completar un reemplazo, con sufijo `.previous-*`.
7. Elige un perfil, genera opcionalmente una **prueba breve** independiente y activa el modelo. La prueba se guarda en `data/model-validation/` y `data/media/`, sin añadir planos a la película. La activación aplica el perfil a los controles de generación; el formato del proyecto se conserva.

Las revisiones oficiales se consultan manualmente desde Hugging Face. Las variantes sin adaptador validado aparecen como pendientes de compatibilidad y no se sustituyen automáticamente. Un archivo presente no demuestra por sí solo calidad ni inferencia válida.

El selector de objetivo recomienda perfiles por detalle nativo, referencias de personajes o vista previa de movimiento. Distingue lo preparado ahora de lo que requiere conectar o preparar un modelo. Una prueba registrada sólo acredita dimensiones, fotogramas, fps, pasos y perfil coincidentes; no garantiza identidad ni calidad estética. La comparación de resoluciones conserva muestras fuera de la película: [primera entrega](FIRST-DELIVERY.md).

### M4 Max con 36 GB

Se recomiendan primero perfiles cortos. MiniMax HD 1280×736 con 22 fotogramas tuvo una prueba histórica verificada; una toma HD de 14,375 s alcanzó presión crítica de memoria. La aplicación mantiene un máximo de 15 s, pero ese máximo no garantiza que todas las resoluciones quepan. Exportación 4K y resolución nativa son decisiones distintas. No se relajan los límites del supervisor.

## Aplicación de macOS y actualizaciones

`npm run desktop:build` crea una aplicación Electron arm64 y un DMG. Incluye Python 3.12 portable, FFmpeg/FFprobe, gh y uv; excluye proyectos, credenciales, entornos de inferencia y pesos. El paquete actual se construyó para macOS 27 o posterior y utiliza firma ad hoc; no tiene firma Developer ID ni notarización Apple.

La aplicación reutiliza el servidor local Filmma en 4318 si lo reconoce. Si no hay servidor y existe la instalación de Documents/Filmma IA, conserva sus datos y motor. En instalaciones nuevas guarda el estudio fuera del paquete, en Application Support. Cerrar la ventana con tareas activas mantiene el proceso; salir ofrece conservarlo trabajando o cancelar explícitamente.

El repositorio y las releases son públicos. El comprobador usa GitHub CLI; si el acceso del entorno lo requiere, ofrece conexión mediante código de dispositivo. Sólo una release con instalador compatible con el equipo (DMG arm64 para Mac o Setup x64 para Windows) y `SHA256SUMS.txt` se ofrece como actualización instalable. Los cambios de main sin release se muestran por separado. La descarga verifica nombre, tamaño, tipo de archivo y SHA256; antes de abrir vuelve a comprobar la huella y espera a que no haya trabajos activos. La instalación es manual y conserva los datos externos al paquete.

GitHub Actions compila una release al actualizar main, al crear una etiqueta v* o bajo ejecución manual. La ejecución remota puede quedar sujeta a permisos o minutos de GitHub Actions de la cuenta; una configuración de workflow no demuestra por sí sola que la compilación remota haya terminado.
