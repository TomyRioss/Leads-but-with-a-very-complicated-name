# Leadtita: memoria de cuenta, skills y progreso de herramientas

Fecha: 2026-11-14
Estado: diseño aprobado, pendiente de revisión de la especificación

## Objetivo

Leadtita debe recordar contexto útil de la cuenta entre conversaciones, incorporar conocimiento y guías de producto en cada llamada al modelo y ejecutar automáticamente herramientas gratuitas de lectura o análisis. Mientras una herramienta trabaja, el chat mostrará estados breves, por ejemplo «Analizando dolores…» y luego «Analizó dolores».

La memoria es por cuenta de usuario: ayuda al modelo a entender quién le habla, qué ofrece, sus preferencias y datos de negocio expresados explícitamente. No es memoria de un lead ni se comparte con otras cuentas.

## Experiencia

- Las herramientas gratuitas de lectura y análisis se ejecutan sin pedir confirmación. Esto incluye el análisis de dolores, actualmente de costo cero.
- Las acciones que modifican datos, envían mensajes o consumen créditos conservan la confirmación existente.
- Durante cada ejecución, el chat presenta un estado accesible con el nombre de la acción y una indicación visual de actividad. Al finalizar, el estado pasa a una confirmación breve dentro del mismo turno. Los fallos muestran un estado de error y permiten continuar la conversación.
- El estado inicial puede cambiar a medida que se ejecutan varias herramientas. No se transmiten tokens del modelo en esta entrega.

## Memoria de cuenta

- Se persiste un conjunto acotado de hechos y preferencias estructurados, aislado por el identificador autenticado de la cuenta.
- La memoria se actualiza automáticamente a partir de datos que el usuario expresa explícitamente en sus mensajes. No se guardan transcripciones completas, secretos, inferencias no confirmadas ni contenido de leads como memoria de cuenta.
- La memoria incorpora procedencia y fecha de actualización para permitir reemplazar datos desactualizados y resolver conflictos dando prioridad a la información explícita más reciente.
- El modelo recibe la memoria en cada conversación junto con el perfil comercial existente. La memoria se etiqueta como contexto del usuario, no como instrucciones del sistema.
- Fallos al leer o guardar memoria no bloquean la conversación; se registran de forma segura y la llamada continúa sin memoria cuando corresponda.

## Bundle de conocimiento y skills

- Crear un bundle confiable, versionado y del lado del servidor con conocimiento de Leadta y guías reutilizables por modo: Vendedor, Generador y Planificador.
- El conocimiento de Leadta describe capacidades, límites y herramientas disponibles. Las guías por modo orientan el estilo y el tipo de ayuda sin reemplazar permisos ni reglas de seguridad.
- El servidor compone el prompt en secciones separadas: instrucciones del sistema, bundle de skills, perfil comercial, memoria de cuenta, contexto del lead/conversación y solicitud actual.
- Los textos de memoria, lead y conversación se consideran datos no confiables. Nunca pueden redefinir instrucciones, habilitar herramientas ni cruzar aislamiento entre cuentas.
- El bundle se carga una vez por proceso o mediante el mecanismo de caché existente; no se hace una lectura de archivos por cada herramienta o cada iteración del modelo.

## Progreso de herramientas y transporte

- Cambiar la respuesta del chat a eventos SSE para comunicar estados de herramientas sin esperar al JSON final.
- Emitir eventos tipados de inicio, éxito, error y respuesta final, asociados a un identificador de turno. No incluir secretos, prompts internos ni datos de otra cuenta.
- El cliente valida eventos, actualiza el estado del turno correspondiente y cierra la conexión al recibir la respuesta final o un error terminal.
- Si SSE no está disponible, presentar el error de turno existente; no duplicar la ejecución con reintentos automáticos del POST.
- Cada turno tiene un identificador de idempotencia. Una reconexión no vuelve a ejecutar herramientas ni a persistir dos veces una misma actualización de memoria.

## Arquitectura y responsabilidades

- `lib/server`: repositorio/caso de uso de memoria de cuenta y composición versionada del contexto de modelo.
- `lib/server/lead-suite-agent.ts`: decidir ejecución automática solo para herramientas gratuitas permitidas, emitir eventos de progreso y devolver el resultado final.
- `app/api/lead-suite/chat/route.ts`: autenticar, validar entrada y transmitir SSE; mantener la autorización dentro del servidor.
- `app/[locale]/lead-suite/chat-panel.tsx` y sus estilos: consumir eventos y representar estados de herramienta accesibles en el turno activo.
- Perfil de cuenta existente: reutilizar los datos comerciales actuales sin duplicarlos en la memoria. Mantener memoria y perfil como secciones distintas del prompt.
- Persistencia: usar PocketBase y migraciones versionadas según el patrón del proyecto; cada lectura y escritura se filtra por la cuenta autenticada.

## Errores, privacidad y límites

- Las herramientas automáticas permitidas deben tener costo cero y no producir efectos externos irreversibles.
- Nunca confiar en la selección de herramientas enviada por el cliente: validar costo, alcance y permisos en servidor.
- Una herramienta fallida informa su error de forma útil y no marca la acción como completada.
- Limitar el tamaño de memoria y el número de hechos; reemplazar o resumir elementos redundantes en lugar de acumular texto sin límite.
- No exponer el bundle interno ni datos de memoria a otras cuentas o a registros de aplicación innecesarios.

## Fuera de alcance

- Streaming de tokens del modelo.
- Ejecución automática de envíos por WhatsApp o Gmail, cambios de leads o herramientas que consuman créditos.
- Memoria individual por lead o memoria compartida entre integrantes de una organización.
- Entrenamiento o ajuste de modelos con conversaciones.

## Criterios de aceptación

1. Una preferencia explícita de una cuenta queda persistida y se incluye en una conversación nueva de esa misma cuenta.
2. Otra cuenta no puede consultar, reemplazar ni borrar esa memoria.
3. La memoria se actualiza automáticamente solo con datos explícitos del usuario; sin memoria disponible, el chat responde normalmente.
4. Las instrucciones de Leadta y la guía del modo elegido llegan al modelo en secciones separadas de los datos de memoria y lead.
5. Una herramienta gratuita permitida empieza sin tarjeta de confirmación y el cliente muestra inicio y resultado/error antes del mensaje final.
6. Las acciones mutables y con costo siguen requiriendo confirmación.
7. Un reintento de conexión no duplica escrituras, análisis persistidos ni envíos externos.
8. La interfaz de progreso es usable con teclado y lector de pantalla, y el error permite seguir conversando.

## Casos de validación

- Normal: una cuenta indica su servicio y tono preferido; luego una conversación nueva los recibe en el contexto del modelo.
- Herramienta gratuita: se solicita analizar dolores; el chat muestra estado activo, resultado y respuesta final sin confirmación intermedia.
- Límite de permisos: se pide enviar un mensaje o modificar un lead; el flujo conserva la confirmación.
- Aislamiento: una cuenta no puede leer ni modificar la memoria de otra.
- Fallo: PocketBase de memoria o una herramienta no responde; el chat muestra un error recuperable y no anuncia éxito.
- Inyección: texto de lead o memoria pide ignorar instrucciones; el bundle confiable conserva prioridad.
- No activación: una petición general no relacionada con Leadta no incorpora datos de leads de otras cuentas ni dispara una herramienta por accidente.
