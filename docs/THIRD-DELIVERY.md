# Tercera entrega: guion y continuidad narrativa

La estructura **secuencia → escena narrativa → plano** organiza la película sin sustituir los planos existentes. El orden del montaje sigue siendo la fuente de verdad. La identidad, las voces y los originales conservan sus relaciones.

## Organizar el guion

En **Guion → Estructura de la historia**, crea una secuencia y sus escenas. Asigna el plano seleccionado a una escena, y añade lugar, momento y objetivo. Puedes dejar planos sin organizar e intercalar apariciones de una misma escena en el montaje. No se inventa una estructura al abrir un proyecto anterior.

Los números bajo cada escena identifican sus planos en el montaje. **Reunir y mover** desplaza todos los planos del bloque y conserva el orden relativo de los demás. Antes de aplicar, la revisión muestra el orden exacto, los estados efectivos antes y después, las voces que perderían vigencia, las sincronizaciones labiales que requerirían revisión, los subtítulos de un diálogo modificado y los planos con material que conviene volver a mirar. El análisis compara metadatos escritos; no reconoce rostros ni valida la imagen.

La propuesta deja de poder aplicarse si cambia el contenido del proyecto. Cancelar conserva el estado actual. Retirar una escena o secuencia de la estructura deja sus planos sin organizar: conserva planos, archivos, tiempos y adjuntos. Los cambios admiten Deshacer.

Al crear un plano desde Guion se conserva la escena narrativa del plano seleccionado. División y duplicación también conservan esa asociación. Buscar incluye títulos, texto, personajes y contexto de la escena.

## Qué está conectado con un plano

Bajo acción y diálogo aparece el contexto de escena y secuencia. **Qué está conectado con este plano** muestra intervenciones, subtítulos y clips adicionales, con acceso al mismo plano en Voces, Subtítulos, Pistas y Continuidad. Distingue grabaciones o textos que requieren revisión.

Los campos de guion siguen guardándose automáticamente. El panel explica qué depende de ellos; las operaciones sobre bloques y estados se revisan antes de aplicarse. Acortar un plano limita sus tramos visibles, conservando los archivos completos. Una voz anterior permanece disponible para escuchar aunque ya no corresponda al guion o al personaje.

## Estados de personajes, objetos y lugares

La ficha separa identidad y voz de sus **Estados narrativos**. Cada elemento admite veinte plantillas con nombre, vestuario/materiales, aspecto, objetos y notas. Crear o editar una plantilla no cambia las apariciones. El borrador del formulario se guarda mediante **Guardar estado**; **Descartar borrador** conserva la plantilla anterior.

**Apariciones en el guion** abre directamente la continuidad del elemento en el plano correspondiente. Elige un estado, escribe su motivo narrativo y revisa el efecto antes de aplicarlo. Se guarda una **copia editable**, identificada por el nombre que tenía la plantilla. Esa copia puede heredarse en apariciones posteriores hasta otro cambio explícito. Editar o retirar la plantilla no modifica las copias aplicadas.

Los campos vacíos del estado se aplican explícitamente vacíos; no recuperan accidentalmente un valor anterior. Aplicar el estado conserva descripción permanente, elección de voz, recursos y tomas. Si el estado efectivo cambia, las reglas existentes retiran la vigencia de las voces y copias labiales afectadas y de los informes visuales que dependan de él; no regeneran ni sustituyen medios automáticamente.

## Referencias de apoyo

Cada ficha admite doce imágenes de apoyo tomadas de la biblioteca. Retirarlas de la ficha conserva los originales. La **imagen principal** sigue siendo la referencia utilizada por el adaptador de generación; las imágenes de apoyo sirven para comparar y no se envían todas automáticamente. Se conserva el límite real del motor, sin prometer condicionamiento con una cantidad de imágenes que no admite.

## Documentos, generación y recuperación

El contexto narrativo acompaña al guion TXT, al storyboard visible y sus documentos HTML/CSV, al contexto entregado a Codex y al prompt real de generación. Los prompts históricos de tomas anteriores se conservan como registro de lo que recibió el modelo.

**Proyecto completo** guarda jerarquía, plantillas, copias aplicadas, referencias, voces y montaje con sus originales. Importarlo crea nuevos identificadores y reasigna padres narrativos, personajes, referencias y adjuntos. Fountain sigue siendo un intercambio de texto y planos: utiliza el paquete Filmma para conservar toda la estructura y los demás datos. Los puntos de recuperación del proyecto conservan estos campos opcionales; no requieren migrar ni mover originales.

## Verificación de esta entrega

Se ejecutaron **434 pruebas** sin omisiones ni fallos, con FFmpeg portable y concurrencia limitada a dos. Incluyen reordenación con escenas intercaladas, herencia, límites y referencias inválidas, detección de cambios durante una propuesta, división/duplicación, HTML escapado, exportación H.264/AAC real de 48 fotogramas a 24 fps en 720p y reimportación ZIP con originales intactos. La exportación de prueba no es una nueva generación de video ni una evaluación estética.

En la instancia aislada de QA se creó una secuencia y una escena, se asignó un plano y se deshicieron los tres cambios. Mover la cabina antes del exterior mostró una voz Qwen existente de 2,24 segundos como pendiente de revisión; Deshacer recuperó su vigencia sin cambiar el WAV. Crear y aplicar un estado, y editar después su plantilla, conservó la copia aplicada, la elección de voz, los clips y los subtítulos. No se descargaron modelos ni se generaron nuevas tomas o voces para esta entrega.

Escritorio 1440 × 1000 y móvil 390 × 844 cubren estructura, revisión, fichas, estados y accesos. En móvil, abrir una aparición enfoca el selector de estado dentro del viewport. Los registros y capturas viven en `output/qa/third-delivery/`; la película de producción 2038 permanece separada.
