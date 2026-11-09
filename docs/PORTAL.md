# Portal de pacientes — diseño técnico de prueba

## Inspección antes de editar

Repositorio: `alonsogm23/senales-que-importan`, base `main` en `1a2d3a3`. Clonado limpio; sin cambios ajenos. No se encontró `AGENTS.md` en el repositorio ni en sus directorios superiores del espacio de trabajo. README original: un título. No había framework, gestor de dependencias, backend, autenticación, base de datos, pruebas ni componentes de aplicación reutilizables. HTML, CSS y JavaScript estaban concentrados en `index.html`; imágenes locales, Google Fonts, Lucide CDN y Google Analytics. Alojamiento confirmado mediante API de Pages: rama `main`, raíz, dominio `drdenisgomez.cl`.

Se conservaron la paleta (`#1e6b5e`, `#2d8b7a`, `#e8f4f1`, `#f5ece3`), las fuentes Lora/DM Sans y el logo. No se modifica `index.html`, CNAME ni configuración de Pages. El enlace de integración se inserta únicamente en la copia servida por el servidor local. El portal no hereda Analytics, Lucide ni fuentes externas. No se crearon recursos remotos, migraciones de producción ni despliegues.

## Arquitectura

- Cliente sin framework, módulos ES, formularios semánticos, navegación móvil, teclado, estados vacíos, carga y error. Compatible con la arquitectura estática existente.
- API HTTP local Node 24 LTS; dependencias nativas HTTP, crypto, AsyncLocalStorage y SQLite. No incorpora una plataforma cloud que el repositorio no tiene contratada/configurada.
- SQLite persistente local, sentencias parametrizadas, transacciones para escritura y cola; adjuntos privados como BLOB. El cliente jamás recibe la base ni las tablas originales.
- Identidad de sesión en cookie HttpOnly/SameSite=Strict; un token aleatorio de 256 bits, almacenado solo como hash, duración de una hora, CSRF, comprobación de origen/Host, límites de cuerpo e intentos. Segundo factor TOTP obligatorio para profesionales. Cada petición revisa cuenta activa, versión de sesión y permisos vigentes.
- Vistas SQL `visible_requests`, `visible_messages`, `visible_documents`, con actor enlazado por contexto de servidor; triggers protegen mutaciones, roles, versiones y auditoría. El navegador no puede elegir ese actor. No se usa Supabase y no se requiere credencial cloud para esta prueba.
- SQLite no tiene roles/RLS de Postgres. Las vistas y triggers son defensa en profundidad dentro de un único proceso confiable; el propietario del archivo y el proceso pueden acceder a tablas base. No equivale a aislamiento frente a un administrador de base. Antes de uso real, evaluar Postgres con RLS y credenciales separadas o una arquitectura equivalente auditada. El prototipo no se presenta como backend sanitario listo para producción.

## Modelo

| Entidad | Función |
| --- | --- |
| accounts, sessions | Cuenta individual, rol provisionado por servidor, MFA y sesión revocable |
| patients | Identidad ficticia; no se usa RUT como vínculo ni credencial |
| enrollments | Relación administrativa verificada paciente–centro |
| grants | Cuenta–paciente; gestionar, enviar antecedentes y consultar clínico por separado; verificador, expediente, revisión, revocación |
| requests | Paciente, centro, motivo, estado, prioridad, versión de reglas, responsable, aceptación, plazo y registro manual de ficha |
| messages | Texto libre restringido o nota administrativa; autor, destinatarios, centro de origen y fecha |
| documents | Serie, versión inmutable, BLOB, tipo, tamaño validado, centro de origen, destinatarios y aprobación médica |
| tickets | Acceso temporal de descarga ligado a sesión, hash, vencimiento de 60 s y un uso |
| notifications, preferences | Canal, evento, cola, intentos, entrega simulada, preferencias personales |
| rule_versions, settings | Reglas inmutables/versionadas, ausencia y configuración operativa |
| observations | Salida de IA solo para el doctor; sin impacto en el flujo |
| audit | Registro append-only de accesos, descargas y acciones, sin texto de mensajes |

Los pacientes nuevos, altas legales, verificaciones de identidad/representación y restricciones judiciales no se automatizan. Las semillas representan verificaciones administrativas ficticias. El procedimiento local de aprovisionamiento solo crea cuentas de demostración, no vínculos por conocer un identificador. Coordinación puede revisar permisos de los vínculos existentes tras registrar una referencia administrativa de verificación. Al vencimiento de `review_on` se bloquea acceso. En las representaciones ficticias coincide con la mayoría de edad. Revisión vencida, revocación y cambios de permisos se comprueban sin esperar a que caduque la sesión.

## Matriz de permisos

| Acción/dato | Paciente/representante | Secretaría de centro | Secretaria personal | Doctor |
| --- | --- | --- | --- | --- |
| Metadatos de solicitud | Grant vigente: gestiona, o propia con permiso de enviar | Solo su centro | Ambos centros y dudosos | Todos |
| Crear solicitud | Gestionar para trámites; enviar para antecedentes; centro verificado o por resolver | No en nombre ajeno | No en nombre ajeno | No en nombre ajeno |
| Texto libre original | Remitente y destinatarios clínicos autorizados | No | No | Sí |
| Conversación clínica | Ser remitente o destinatario con grant clínico vigente; alcance por solicitud | No | No | Sí |
| Hilo administrativo | En solicitudes autorizadas | Centro actual y notas del mismo centro | Ambos centros | Todos |
| Preparar documento administrativo | No | Su centro | Ambos | Sí |
| Preparar documento clínico | No | No | No | Sí |
| Aprobar documento | No | No | No | Sí, versión actual |
| Descargar borrador | No | Administrativo de su centro y origen | Administrativo | Todos |
| Descargar aprobado | Destinatario explícito + grant de tipo correspondiente | Según tipo y centro | Solo administrativo | Todos |
| Asignar o derivar | No | Su centro, coordinación o doctor | Centros autorizados | Todos |
| Reasignar centro | No | No | Sí, relación verificada | Sí, relación verificada |
| Cambiar prioridad clínica | No | No | No | Sí, motivo restringido y auditado |
| Roles profesionales | No | No | No | Sin endpoint; solo operador del servidor |
| Vínculos y revocación | Sin elevación propia | No | Revisión humana de vínculos ficticios | Revisión humana |
| Cobertura, reglas y simulación de alertas | No | Preferencias propias | Preferencias propias | Configuración y preferencias |

Todo texto libre de pacientes se guarda como clínico restringido, incluso al seleccionar «certificado» o «administrativo». La secretaría recibe motivo/estado/centro y puede pedir una aclaración administrativa; el doctor puede registrar una nota administrativa apta para gestión. Es una decisión conservadora para evitar exponer síntomas escondidos en un trámite. El autor puede consultar sus propios antecedentes enviados, aun sin permiso de consultar conversaciones ajenas. El permiso clínico tampoco comparte automáticamente todas las conversaciones: se exige figurar entre los destinatarios. No se afirma confidencialidad absoluta.

Los documentos clínicos nunca aparecen en la bandeja de secretaría ni coordinación. Los documentos administrativos requieren destinatarios explícitos y aprobación del doctor para entregarse a familias. Nueva versión no hereda aprobación. Las versiones aprobadas anteriores permanecen como historial; la más reciente necesita nueva aprobación. El contenido, destinatarios y clasificación de una versión son inmutables.

Al cambiar centro se retiran las tareas externas pendientes del centro previo; los permisos de solicitud se recalculan. Las notas y documentos conservan su centro de origen; la nueva secretaría no los recibe. La representación clínica no cambia por cambiar centro. La secretaria personal conserva la coordinación administrativa, no gana acceso clínico.

## Flujo y estados

Crear → revisar paciente, centro, resumen y destinatarios → guardar en transacción → seguimiento por hilo. Se recogen finalidad, destinatario y fecha del documento; en motivos clínicos, desde cuándo, actualidad y contacto seguro. Preguntas pendientes de aprobación clínica.

Motivo, estado y prioridad son campos distintos. Se implementan los nueve estados solicitados. Asignar no acepta. El botón de aceptación crea `accepted_by/accepted_at` y actuación de auditoría. No se deduce aceptación de una entrega, lectura de correo o apertura de pantalla. En revisión médica requiere aceptación explícita. El doctor puede responder, pedir información, señalar que hace falta una consulta, delegar gestión, revisar prioridad y registrar manualmente que incorporó la actuación a ficha. No hay integración con ficha externa.

Plazos operativos configurados por solicitud, sin valores médicos por defecto; bandejas de nuevas, propias, pendientes de información, documentos por aprobar, derivaciones sin aceptación y plazos vencidos. Filtros por centro, motivo, prioridad, estado, responsable y antigüedad.

## Prioridad y urgencia

Cuatro tarjetas con texto/icono/color. Las reglas léxicas de `policy.js` se cargan desde versiones persistentes de base de datos; cambios del doctor requieren nueva versión y motivo. En esta prueba ninguna versión puede marcarse clínicamente aprobada. Los cambios de versión y prioridad quedan auditados. Los mensajes nuevos de familias solo elevan prioridad; bajarla requiere doctor y justificación restringida.

La advertencia roja está incluida en el código local, disponible sin login y no usa IA. Aparece en la escritura, revisión previa y en el hilo cuando corresponde. No incluye números de teléfono, cuenta atrás ni cierre automático. No informa a todos los familiares. Guardar una alerta no significa lectura.

Las reglas ilustrativas no interpretan correctamente todas las negaciones, tiempos o lenguaje indirecto. Se documentan falsas alertas y omisiones en `ai-cases.json`; **no constituyen protocolo clínico validado ni predicción de riesgo**. Una etiqueta verde no prueba que sea seguro esperar. Se necesita aprobación del texto rojo, preguntas, destinatarios en situaciones sensibles y criterios de elevación por el doctor.

## Horarios y notificaciones

`Intl.DateTimeFormat` con `America/Santiago`; no se fijan offsets ni se usa la zona horaria del servidor. Quillota y Viña del Mar usan esta zona. L–V 08:00 inclusive–20:00 exclusive; S–D 08:00 inclusive–13:00 exclusive. Las próximas aperturas se calculan sobre instantes reales y reglas DST. Se pueden registrar solicitudes fuera de cobertura; se informa la siguiente apertura, sin prometer respuesta. Ausencia sin fecha deja el retorno pendiente de confirmar.

Notificaciones internas reales dentro de la base de prueba. Email y segundo canal usan **adaptadores exclusivamente simulados**, sin librerías de envío ni llamadas de red. Plantilla genérica, sin paciente, centro, texto, diagnóstico, asunto clínico ni enlace con información sensible. La entrega simulada se etiqueta como tal. Aceptación sigue siendo acción distinta.

La cola se crea en la misma transacción que la solicitud; la caída de un canal no borra solicitudes. Preferencias individuales por prioridad y ámbito de centro; secretarías pueden tener avisos 24 h, sin prometer presencia humana. Doctor: alertas prioritarias externas en cobertura; fuera quedan retenidas. La ausencia también retiene los avisos. Los fallos quedan marcados. Reintentos, máximo de intentos y umbral de coordinación manual son configurables, sin plazos médicos por defecto. El procesador de prueba se ejecuta manualmente con «simular entrega/fallo»; no hay worker operativo ni envíos reales. Sin respaldo autorizado, el escalamiento solo señala una revisión manual interna al doctor. No se inventa otro profesional.

## IA opcional

`observe(actor, request, provider)` define el contrato opcional: originales, motivo, prioridad → resumen, fragmentos literales, información faltante, motivo sugerido y prioridad sugerida igual o superior. Valida longitud, fragmentos presentes y prioridades; timeout y fallos conservan solicitud y texto original. Persistencia separada y visible solo para el doctor. El proveedor no está configurado ni se ha llamado a un modelo real. La ruta UI lo informa explícitamente. La IA no decide permisos, envío a representantes ni cierre; tampoco aplica automáticamente sus sugerencias.

`evaluateObserver` ofrece un arnés para casos ficticios con negación, historia pasada, lenguaje indirecto, errores y señales en trámites. Informa que no evalúa exactitud clínica. La ejecución sin proveedor devuelve `not_configured`, no resultados inventados de IA. Cualquier conexión real exige aprobación de proveedor, privacidad, retención y evaluación clínica antes de intervenir en el flujo.

## Fuentes oficiales consultadas

Consultadas el 9 de noviembre de 2026; dependencias y APIs contrastadas antes de utilizarlas:

- Node 24 SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html — DatabaseSync, funciones SQL, prepared statements y backup.
- Node crypto: https://nodejs.org/docs/latest-v24.x/api/crypto.html — scrypt, HMAC y comparación de tiempo constante (contraste adicional con documentación actual del índice).
- SQLite vistas: https://www.sqlite.org/lang_createview.html y triggers: https://www.sqlite.org/lang_createtrigger.html.
- Playwright: https://playwright.dev/docs/test-use-options y https://playwright.dev/docs/api/class-browsertype.
- Fuentes oficiales Google Fonts: https://github.com/google/fonts/tree/main/ofl/lora y https://github.com/google/fonts/tree/main/ofl/dmsans. Licencias OFL incluidas en `portal/public/fonts`.
