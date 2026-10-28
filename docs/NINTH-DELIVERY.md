# Novena entrega · Biblioteca, procedencia y actividad

**Archivos** reúne búsqueda por nombre, etiqueta, plano o personaje; filtros por tipo, etiqueta, favoritos, disponibilidad y ausencia de vínculos actuales. La biblioteca muestra inicialmente hasta 24 resultados y permite cargar más. Seleccionar un archivo abre su ficha junto al material en escritorio y encima de él en móvil.

## Organizar sin cambiar el montaje

Cada archivo admite hasta 24 etiquetas de 40 caracteres y un favorito. Se guardan como organización del proyecto, separadas de los parámetros visuales. Un guardado antiguo del editor no elimina estos datos. Cambiar etiquetas o favoritos no invalida una revisión visual vigente.

**Dónde se usa** identifica imágenes iniciales/finales, tomas seleccionadas y conservadas, referencias principales y de apoyo de personajes, referencias Qwen, diálogos, pistas, banda sonora y versiones que utilizan ese archivo como fuente. Sus acciones abren el plano, la ficha del personaje, Voces o la fuente correspondiente. Seleccionar material no lo aplica; **Usar en plano seleccionado** y **Usar como banda sonora** mantienen las acciones explícitas existentes.

## Procedencia

La ficha distingue originales importados, ejemplos, tomas generadas, mejoras, grabaciones, referencias de voz y copias labiales cuando sus registros existen. Presenta nombre al importar, fecha, modelo, fuentes y parámetros de generación disponibles; se puede seguir el vínculo de una copia a su fuente y descargar un informe JSON.

Un archivo antiguo sin registro dice **Procedencia no registrada**. No se inventan prompts, autores ni fechas. Los registros describen lo guardado por Filmma; no acreditan autoría o autenticidad externa.

## Comprobar y reconectar

**Comprobar archivos** inicia un trabajo local cancelable que lee una fuente a la vez y calcula SHA256. Diferencia archivo verificado, por comprobar, ausente, no legible y contenido distinto. La primera comprobación de un archivo antiguo disponible registra su huella actual; no demuestra cómo era antes de ese registro. Una diferencia respecto de una huella conocida no reemplaza la huella ni el archivo.

Las importaciones nuevas guardan automáticamente huella, tamaño, nombre y fecha. Importar copia los bytes dentro de Filmma: mover después el archivo externo no rompe la copia interna. Si esa copia interna queda ausente, **Elegir original para reconectar** acepta una copia de hasta 2 GB y exige el mismo SHA256 y tipo. Recupera la ruta interna manteniendo identificador, tiempos, fuentes seleccionadas, guion, personajes, voz y subtítulos. El archivo externo elegido permanece intacto.

El destino se crea de forma exclusiva, se verifica de nuevo y nunca se sobrescribe un archivo existente. El progreso, el rechazo y la confirmación aparecen junto a la acción de reconexión y se revelan sin cambiar el foco. Una copia distinta se rechaza; un archivo existente con contenido cambiado se conserva para revisión. Sin huella conocida no se puede demostrar que una copia sea idéntica: debe importarse como material nuevo y vincularse explícitamente. Los ejemplos incluidos en la aplicación no se sobrescriben mediante este mecanismo. La reconexión espera a que terminen los trabajos activos; no reinicia ni cancela procesos automáticamente.

Desde **Mis películas → Abrir para reconectar** se puede abrir explícitamente un proyecto con fuentes ausentes y entrar en Archivos. La apertura normal conserva su comprobación previa. Antes de cambiar de proyecto se guarda el anterior. La recuperación de un punto conserva la organización y las huellas actuales de los archivos, además de los originales y tomas posteriores.

## Actividad con contexto

Actividad filtra por película, estado, proceso y texto, muestra fecha completa y conserva los últimos 300 trabajos. Los trabajos nuevos registran película, plano o fuente cuando corresponde, incluso si fallan o se cancelan. El contexto permanece separado del resultado: un fallo no se presenta como un resultado generado.

Los accesos abren el plano, Voces, las comparaciones o la ficha de material disponible. Los fallos por archivo ausente ofrecen una explicación y acceso a la biblioteca; **Detalles y resultados** conserva el diagnóstico completo y los informes de audio/acabado existentes. Los registros antiguos sin contexto permanecen accesibles en **Todo el estudio** o **Sin película registrada**, sin asignarles una película inventada. Se puede descargar el registro filtrado en JSON.

No existe un reintento automático de inferencia. Los originales y resultados completados se conservan; el usuario vuelve al contexto para decidir cómo continuar.

## Paquetes y verificación

El paquete Filmma conserva organización, huellas y procedencia. Al reimportarlo se verifican los bytes, se asignan identificadores nuevos y se remapean etiquetas, favoritos, fuentes y vínculos al guion y personajes. Un original cuya huella no corresponde al paquete se rechaza sin sustituir el proyecto abierto.

La prueba aislada en `output/qa/ninth-delivery/` incluye una copia incorrecta rechazada, una reconexión idéntica, un fallo real de exportación por fuente ausente y recuperación posterior, una mejora convencional con procedencia, exportación MP4 1280×720 a 24 fps con 288 fotogramas y audio, decodificación completa y exportación/reimportación de paquete. No produce imágenes, voces ni videos nuevos con IA. Se verifican los hashes de siete archivos de producción y de las quince fuentes QA iniciales; las copias trasladadas para probar la reconexión permanecen conservadas.

Las pruebas cubren fuentes cambiadas, enlaces simbólicos, destino existente, trabajo activo, nombres con acentos, guardados antiguos, reconexión sin huella, apertura explícita con ausencias y persistencia de organización y referencias. Esta entrega no certifica identidad visual, calidad nativa de imagen ni ejecución del instalador Mac.
