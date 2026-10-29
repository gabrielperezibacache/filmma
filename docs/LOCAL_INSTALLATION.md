# Instalación local: RAM, SSD y GPU

Revisión de documentación oficial: **28 de octubre de 2026**. Filmma conserva los originales, la biblioteca de personajes y los paquetes de guion al cambiar de motor. Instalar Filmma y disponer de una GPU capaz de ejecutar H3 son requisitos distintos.

## Elegir antes de descargar

| Equipo | Opción aconsejada | Estado en Filmma |
| --- | --- | --- |
| Mac Apple Silicon, 32–48 GiB | H3 Metal BF16 con SSD streaming; pruebas cortas | Integrado; probado en M4 Max 36 GB |
| Mac Apple Silicon, 64 GiB | SSD como inicio; RAM residente para una prueba breve, vigilando presión | Selector integrado; RAM residente pendiente de validación en ese equipo |
| Mac Apple Silicon, 96–128+ GiB | Transformador residente en RAM; comenzar con el perfil breve | Integrado; automático desde 96 GiB, todavía requiere prueba local |
| Windows/Linux NVIDIA, 64+ GiB RAM y 24–32 GiB VRAM | ComfyUI H3 pruned INT8 ConvRot + codificador cuantizado | Opción externa más compacta; comprobar CUDA y workflow |
| Windows/Linux NVIDIA, 48+ GiB RAM y 12–16 GiB VRAM | ComfyUI H3 GGUF Q4 + codificador cuantizado | Experimental; margen de Filmma, no mínimo oficial |
| Windows/Linux NVIDIA, 96+ GiB RAM y 24–32 GiB VRAM | Diffusers, INT8 y offload por bloques desde RAM | Receta externa; no motor integrado ni inferencia comprobada por Filmma |
| Windows/Linux NVIDIA, 96+ GiB RAM y 12–16 GiB VRAM | Misma receta, VAE también descargado de GPU, lienzo pequeño | Experimental y mucho más lento; receta externa |
| Windows/Linux NVIDIA, 192+ GiB RAM y GPU 80 GiB | Diffusers BF16 con offload de componentes | Receta externa; 192 GiB es margen de planificación de Filmma |
| NVIDIA con poca RAM, AMD, Intel o CPU | Elegir una variante ligera de LTX/Wan en ComfyUI compatible con esa GPU; importar la toma | Entorno externo; no recomendar H3 a ciegas |
| Windows ARM64 / Mac Intel | Editor en navegador con servidor compatible; paquete de escritorio ARM64/Intel pendiente | No se ofrece un instalador nativo para esas arquitecturas |

La RAM y la VRAM dedicada no se suman como si fueran memoria unificada. Los valores de esta tabla son criterios conservadores de selección, no una garantía de velocidad o compatibilidad de kernels. No se declara inferencia Windows validada por haber compilado el instalador.

## Mac: reducir lecturas sin cambiar los pesos

En **Modelos → Memoria y compatibilidad**, el selector de H3 ofrece Automática, SSD streaming y Transformador en RAM. Automática conserva SSD en equipos de menos de 96 GiB. La opción RAM se habilita desde 64 GiB y recomienda 96 GiB; exige el perfil breve (hasta 22 fotogramas y una superficie de 512 × 512), presión normal y una estimación conservadora de 48 GiB libres. Los perfiles largos/HD conservan el supervisor existente y SSD streaming. Filmma no reduce capas, resolución ni precisión para hacer pasar un equipo insuficiente.

El motor h3.c mantiene dos bloques en streaming. Al omitir `--ssd-streaming`, el transformador permanece residente; la carga inicial y el codificador siguen leyendo archivos. El sistema operativo puede usar intercambio: RAM residente no equivale a «cero SSD». [Referencia del motor y límites de sus mediciones](https://github.com/antirez/h3.c#weight-residency-and-streamed-prompt-encoding).

Configuración por terminal, con Filmma sin tareas activas:

```sh
python3 runtime/filmma_runtime.py doctor --json
python3 runtime/filmma_runtime.py configure-memory --mode auto --json
# Sólo con Apple Silicon y >=64 GiB; empezar con el perfil breve:
python3 runtime/filmma_runtime.py configure-memory --mode ram --json
# Volver al consumo conservador:
python3 runtime/filmma_runtime.py configure-memory --mode ssd --json
```

El cambio se protege con el mismo bloqueo de generación. No convierte, mueve ni vuelve a descargar los pesos. En el M4 Max de 36 GB se rechaza RAM residente antes de cargar el modelo. No se crea un RAM disk: duplicaría archivos y agotaría memoria. El SSD interno puede mejorar la lectura frente a uno externo lento, pero sólo se debe copiar el modelo si caben la copia y la reserva de 20 GiB; nunca borrar automáticamente el original.

## Windows: instalar Filmma

1. Descarga **Filmma-…-win-x64-Setup.exe** y `SHA256SUMS.txt` de [Releases del repositorio privado](https://github.com/gabrielperezibacache/filmma/releases). Debes entrar con la cuenta que tiene acceso.
2. Comprueba el hash: `Get-FileHash .\Filmma-…-win-x64-Setup.exe -Algorithm SHA256` en PowerShell.
3. Ejecuta el instalador por usuario. Permite elegir carpeta y no solicita privilegios de administrador. Windows 10/11 x64 compatible con Electron; Windows 11 actualizado es el destino preferido. No desactives SmartScreen: la distribución aún no tiene firma Authenticode.
4. Abre Filmma. Proyectos y configuración se guardan en el perfil del usuario, fuera del directorio de instalación. Desinstalar o actualizar la aplicación conserva esos datos y los modelos externos.
5. En **Modelos**, reconoce RAM y GPU NVIDIA mediante `nvidia-smi`. Si no existe ese diagnóstico, Filmma muestra capacidad desconocida y no inventa VRAM. El motor Metal/MLX aparece como no compatible.

También hay ZIP x64 para extraer y ejecutar. Incluye Python aislado, FFmpeg/FFprobe, uv y GitHub CLI; no incluye cientos de GB de modelos, CUDA ni controladores. Las actualizaciones eligen el instalador del sistema y verifican SHA256 antes de abrirlo.

## H3 con RAM del sistema en Windows o Linux

La receta oficial de Diffusers cuantiza transformador y codificador a INT8 y mueve bloques desde RAM a CUDA. Estima unos **75 GB de RAM** para los pesos; Filmma recomienda **96 GiB** para dejar margen. Con 12–16 GB de VRAM también descarga el VAE de GPU. Con 24–32 GB hay más margen. La ruta BF16 y la de dos GPU son opciones diferentes. [Recetas oficiales y carga de un solo workflow](https://huggingface.co/docs/diffusers/main/en/api/pipelines/minimax_h3#memory).

Para NVIDIA en Windows se recomienda preparar primero **WSL2 + Ubuntu**, manteniendo Filmma nativo de Windows. Instala manualmente el controlador NVIDIA compatible y WSL siguiendo [Microsoft](https://learn.microsoft.com/en-us/windows/ai/directml/gpu-cuda-in-wsl). Filmma no modifica controladores, virtualización ni el límite de memoria de WSL. Comprueba `free -h` dentro de WSL: Windows puede tener 128 GiB y WSL disponer sólo de una fracción. Ajusta su presupuesto conscientemente dejando margen a Windows.

Preparación del entorno, dentro de Ubuntu/WSL2 o Linux:

```sh
python3 -m venv ~/filmma-h3-cuda
source ~/filmma-h3-cuda/bin/activate
python -m pip install --upgrade pip
nvidia-smi
# Instala primero PyTorch con la orden que corresponde a tu GPU/controlador:
# https://pytorch.org/get-started/locally/
python -c "import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(), torch.cuda.get_device_properties(0).total_memory)"
python -m pip install 'git+https://github.com/huggingface/diffusers.git@40e551a4380c0a48333f3eeb032ed7da1f361297' transformers accelerate torchao safetensors pillow imageio imageio-ffmpeg
```

Después abre la receta oficial de **Memory → consumer card** enlazada arriba, elige **un solo workflow** (`t2va`, `fl2va` o `ref2va`) y una carpeta nueva para la caché (`HF_HOME=/ruta/con/espacio/filmma-h3-diffusers`). El formato Diffusers no es intercambiable con la vista FL2VA/Ref2VA del motor Metal: **no sobrescribas el SSD actual**. La primera carga descarga componentes y puede tener un pico de RAM superior a su tamaño cuantizado. Revisa la licencia, espacio, RAM de WSL y compatibilidad de TorchAO antes de ejecutarla. La revisión de Diffusers está fijada; registra con `pip freeze` las versiones realmente resueltas y prueba antes de actualizarlas.

No se proporciona una descarga INT4/GGUF como si estuviera verificada: el adaptador h3.c integrado usa BF16 y estas variantes requieren un motor y una prueba propios. INT8 puede cambiar detalle e identidad; usa las mismas referencias y compara varios fotogramas antes de dar la toma por buena.

## Variantes cuantizadas más compactas

**ComfyUI es la primera alternativa externa que evaluaría en un PC de consumo.** Instala la distribución oficial correspondiente al equipo y actualiza sus plantillas; abre el workflow MiniMax H3 de la [guía oficial de Comfy](https://docs.comfy.org/tutorials/video/minimax/minimax-h3). Descarga cada componente desde [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3): DiT a `models/diffusion_models`, codificador a `models/text_encoders` y ambos VAE a `models/vae`, siguiendo los nombres de la plantilla. Para CUDA 13 compatible, Comfy-Org prioriza INT8 ConvRot frente a FP8 scaled. Elige **FL2VA** para imagen inicial/final o **Ref2VA** para referencias ordenadas; conserva ambos modos separados.

Para menos VRAM, el [índice de integraciones del repositorio de MiniMax](https://github.com/MiniMax-AI/awesome-minimax-h3-integration#recipes-vram) recoge GGUF Q4 con un codificador cuantizado y nodos adicionales. Es un índice comunitario, no una certificación. Las cifras de tamaño son **por componente**; el nodo, el codificador, los VAE y las activaciones también consumen memoria. Filmma propone 48 GiB RAM/12 GiB VRAM como reserva conservadora para explorar esta ruta; no afirma que sea un mínimo medido ni garantiza compatibilidad. Evita instalar nodos desconocidos sin revisar su código; guarda el workflow y las revisiones realmente usadas con cada prueba.

En Mac existe [PipeNetwork/minimax-h3-mlx](https://github.com/PipeNetwork/minimax-h3-mlx): publica DiT de 4/6/8 bits, pero su codificador aún ronda 50 GB en BF16. La cifra de 11,5 GB residente de 4 bits **no describe todo el pipeline**. El propio proyecto distingue el recorrido de texto probado de la ruta de keyframes todavía sin prueba completa. Por eso no lo activo como reemplazo para tu Mac de 36 GB ni para continuidad de personajes. Es una alternativa de investigación para Macs de más memoria. Los tiempos publicados por sus autores no se extrapolan al M4 Max.

Las variantes pruned/GGUF, INT8 de Diffusers y el BF16 de h3.c son formatos diferentes. Ninguna se instala encima del directorio actual. Guarda las descargas nuevas en una carpeta independiente, respeta la licencia y valida un plano breve con las referencias originales antes de invertir en una toma larga.

## Otros equipos y regreso al guion

[ComfyUI documenta sus combinaciones de sistema, GPU y PyTorch](https://docs.comfy.org/installation/system_requirements). Su soporte de una GPU no garantiza que un workflow concreto de H3 funcione en ella. Para AMD/Intel/CPU, selecciona un modelo y un workflow que indiquen soporte explícito; CPU es una posibilidad de experimentación lenta, no una recomendación para rodaje H3.

Para cualquier motor externo: abre el plano correcto en Filmma, conserva el paquete del prompt y las referencias, genera una salida nueva de hasta 15 s y usa **importar toma** en ese plano. Comprueba duración, proporción y fps reales; después revisa continuidad y prepara el acabado 4K. La importación conserva los bytes nativos y no sustituye las referencias de personajes. La procedencia se registra como importación, no como una generación verificada del motor interno. El 4K de postproducción sigue siendo un derivado; nunca se etiqueta como generación nativa 4K.

### MiniMax H3 GGUF en el M4 Max de 36 GiB

Filmma incorpora un adaptador Metal separado del BF16 original, basado en
[H3cApp](https://github.com/JunzoKamahara/H3cApp) y los pesos
[MiniMax-H3-GGUF de Unsloth](https://huggingface.co/unsloth/MiniMax-H3-GGUF).
Las revisiones y hashes están fijados en `runtime/h3-gguf-catalog.json`.
La descarga no cambia la variante activa ni elimina el modelo anterior.

En **Motores → MiniMax H3 · GGUF** se pueden descargar, verificar y activar las
variantes. Q4 necesita unos 46,9 GB con FL2VA, Ref2VA, codificador visual y ambos
VAE. Q8 completo necesita unos 66,9 GB; los componentes idénticos pueden
compartirse mediante enlaces físicos en el mismo volumen. Se conservan 20 GiB
libres. La descarga reanuda sus rangos y comprueba SHA256 antes de instalar.
El adaptador necesita macOS 15 o posterior, Apple Silicon y las herramientas de
compilación de Xcode. No es un motor CUDA para Windows.

El flujo se completa desde ese apartado:

1. Elige una carpeta local o del SSD y descarga/verifica los pesos.
2. Selecciona un personaje con imagen original y pulsa **Probar con este personaje**.
3. Reproduce el video independiente y **aprueba o rechaza** su calidad. La prueba
   no añade ni sustituye planos del proyecto y una prueba pendiente no borra
   la validación anterior.
4. Pulsa **Usar esta variante**. Cambiar el catálogo o el adaptador exige revisar
   una nueva prueba. La cancelación detiene el proceso hijo antes de liberar
   el bloqueo de generación.

La activación exige una toma revisada, los hashes de todos los pesos y la misma
versión del motor probado. Los controles BF16 conservan su carpeta y su modo de
memoria. Se puede volver a BF16 desde el mismo apartado, incluso si su SSD no
está conectado; para generar con BF16 habrá que conectarlo.

Los bloques GGUF se descomprimen a BF16 cuando se usan. Esta implementación
**reduce lecturas del SSD; no mantiene todo H3 residente en 36 GiB**. macOS puede
conservar parte de los pesos comprimidos en la caché de archivos. La memoria de
esa caché no queda descrita por el RSS o el footprint del proceso. El puerto MLX
con carga por etapas es otra línea experimental, pero su ejecutable por etapas
es de texto a video y no ofrece las referencias de identidad de este flujo:
[fuente del puerto MLX](https://github.com/yshenaw/ComfyUI-MiniMax-H3-MLX-SolAttn).

La prueba local y sus límites se documentan en
[H3_QUANTIZATION.md](H3_QUANTIZATION.md). Cada toma registra variante, revisiones,
semilla y referencias originales. Se mantienen las alertas de continuidad,
los límites de 15 segundos y la supervisión de presión, footprint y swap.
