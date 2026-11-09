# Supabase: implementación y operación de la demostración

Actualización: 9 de noviembre de 2026. Proyecto nuevo `senales-portal-demo-ficticia`, ref `cpioegorrksyqlqllesu`, región `sa-east-1`, organización **Alonso org**, plan **Free**. Coste informado antes de crear: **US$0 mensuales**. No se activaron servicios de pago. Solo se hicieron lecturas de inventario del proyecto `ninis-sicue-amigo-secreto`; no se consultaron sus tablas, claves ni archivos y no se modificó.

## Qué se conserva y qué cambia

Se conserva la web pública, identidad visual, frontend del portal, formularios, hilos, bandejas, nueve estados, prioridades, horarios, auditoría y flujos de documentos. No se incorpora un framework para rehacer la web. El núcleo HTTP se separa de SQLite y admite operaciones asíncronas.

`npm start` utiliza Supabase. SQLite, su autenticación scrypt/TOTP local y sus adjuntos BLOB quedan limitados a comandos `legacy:*` y pruebas de regresión. No hay autenticación alternativa automática, doble escritura ni sincronización de perfiles. Las contraseñas/secretos de SQLite no se importaron: se crearon identidades ficticias nuevas en Auth y vínculos nuevos en PostgreSQL. No se transfirió información de pacientes reales.

## Identidad y sesión

Supabase Auth conserva usuarios, contraseñas, factores TOTP y sesiones. `portal_profiles.id` referencia `auth.users.id`: es un perfil de autorización del mismo usuario, no un segundo sistema de autenticación. Los roles provienen exclusivamente de esa tabla gestionada por el operador autorizado, nunca de `user_metadata`, formularios ni correos por centro.

El backend verifica el usuario con Auth; cada operación de datos comprueba además `auth.sessions`, cuenta activa, `session_id`, vencimiento y antigüedad máxima de una hora. Los profesionales requieren `aal2`, incluso al consultar directamente la API de datos. Antes de MFA solo se devuelve la identidad propia para completar el enrolamiento. Cookie HttpOnly, SameSite=Strict, Secure con origen HTTPS, CSRF ligado a la sesión y origen/Host exactos. El secreto CSRF debe ser estable entre instancias de Vercel. No se usa localStorage para tokens.

El registro de cuentas ficticias se hizo con Auth Admin en una función temporal, mediante un secreto aleatorio de un solo uso y caducidad corta. Los roles estaban fijados en el servidor. La función temporal fue sustituida por un endpoint inerte y se eliminaron el RPC y la tabla del secreto. Un trigger sobre Auth impide insertar identidades sin permiso administrativo temporal, correos reales, cambios de correo y teléfonos. La aplicación no ofrece registro, invitaciones ni asignación de roles. El interruptor de registro de Auth y la política de recuperación deberán revisarse también en el Dashboard antes de una entrega operativa; no se presenta esa configuración del proveedor como completada por una API inexistente en el complemento.

Las ocho cuentas alojadas tienen contraseñas aleatorias no versionadas. Las pruebas enrolaron los cuatro autenticadores profesionales; no son cuentas humanas definitivas. Para entregar una cuenta a un evaluador, el operador debe rotar su contraseña y restablecer únicamente su factor ficticio mediante Auth Admin; después el titular configura su autenticador en pantalla. La recuperación de factores y la invitación de profesionales reales requieren un procedimiento aprobado. No enviar contraseñas por este repositorio ni usar una clave compartida por centro.

## Modelo y permisos

Las migraciones en `supabase/migrations/` están aplicadas al proyecto nuevo. Todas las tablas públicas y las tablas privadas tienen RLS. No hay permisos de escritura directa para `anon`/`authenticated`. Las lecturas REST de metadatos administrativos tienen políticas por sesión, rol, centro, paciente, autorización y destinatario. El texto clínico, metadatos de documentos y resúmenes no se pueden leer directamente por REST, ni siquiera con token del doctor: se obtienen por el RPC autorizado que audita la consulta. Las mutaciones se ejecutan mediante `portal_command`, que valida cada acción dentro de una transacción.

| Recurso | CENIT | Cenepsi | Personal | Doctor | Paciente/representante |
| --- | --- | --- | --- | --- | --- |
| Metadatos de solicitud | Solo CENIT | Solo Cenepsi | Ambos | Ambos | Vínculo vigente según permiso |
| Mensajes administrativos | Centro y contexto original | Centro y contexto original | Ambos | Ambos | Solicitud autorizada |
| Mensajes clínicos originales/respuestas | No | No | No | Sí | Remitente o destinatario explícito con permiso clínico |
| Borradores administrativos | Su centro | Su centro | Ambos | Ambos | No, hasta aprobación |
| Documentos clínicos | No | No | No | Sí | Aprobados y destinatario clínico vigente |
| Aprobar documento / prioridad clínica | No | No | No | Sí | No |
| Resolver centro / revisar representación | No | No | Sí, revisión humana | Sí | No |
| Asignar rol profesional | No | No | No | No desde el portal | No |

Un paciente puede tener varios representantes; una cuenta, varios pacientes. Los permisos de tramitar, enviar y consultar clínica son independientes. Los destinatarios se seleccionan explícitamente. La revocación o fecha de revisión vencida bloquea también tickets ya emitidos. Los cambios de centro quedan auditados y no revelan notas/documentos previos al nuevo centro. No se usa RUT para autenticar ni vincular.

Los únicos wrappers RPC expuestos son `SECURITY INVOKER`. Las funciones privilegiadas necesarias para transiciones atómicas y auditoría están en `portal_private`, con `search_path` vacío, permisos limitados y autorización interna. Ese esquema no debe añadirse a los esquemas expuestos de Data API. Un administrador de infraestructura sigue teniendo poder sobre la base: la auditoría no es una garantía criptográfica frente al propietario del proyecto.

## Storage privado

Bucket `portal-documents`, privado, límite **2 MiB**, PDF/PNG/JPEG. El navegador no accede directamente a los objetos. La función `portal-files` valida el JWT con Auth y llama al mismo RPC autorizado del usuario. Solo después usa la clave privilegiada incorporada al entorno Edge para transferir el objeto. La clave nunca sale de ese entorno; el servidor de la aplicación utiliza una clave publicable.

La subida valida tamaño, tipo, cabecera binaria y destinatarios. Se prepara una versión pendiente, se carga en Storage y se confirma su existencia; un fallo intenta retirar el objeto y el borrador pendiente. Si falla también la limpieza, un operador debe reconciliar pendientes. No se reemplazan versiones ni se hereda aprobación. No hay análisis antimalware profundo ni emisión de licencias médicas.

La descarga exige un ticket de **60 segundos**, de un uso, ligado al usuario y a la misma sesión de Auth. Se recalculan permisos al consumirlo y se audita la descarga. La API devuelve el archivo con `no-store`, sin URL firmada reutilizable. RLS deniega lectura/escritura/listado directo de objetos; no basta con conocer una ruta ni con cambiar el centro en la petición.

## Prioridades, horarios y comunicaciones

Se conservan preguntas y reglas ilustrativas versionadas. PostgreSQL clasifica también el texto, sin confiar en la prioridad enviada por el navegador; la tarjeta roja funciona sin IA. No es un protocolo clínico validado. Horarios calculados con `America/Santiago` tanto en la base como en la interfaz, incluyendo cambios de hora y ausencias.

La cola de notificaciones se guarda en la misma transacción que la solicitud. Canales `internal`, `email-test`, `secondary-test`; solo los avisos internos son funcionales. Los otros canales simulan entrega/fallo, con reintentos configurables y sin envío. Fuera de cobertura los avisos médicos se conservan. No hay profesional de respaldo inventado. Guardar, entrega simulada y aceptación explícita siguen siendo hechos distintos. IA devuelve `not_configured`, sin perder el mensaje original.

El contacto propuesto es **Dr.denisgomezconsultas@gmail.com**. No se configuró Gmail, OAuth, contraseña de aplicación ni SMTP. Para utilizarlo habrá que autorizar/configurar el proveedor y verificar el remitente. Los correos externos deberán ser genéricos y sin datos clínicos. No se enviaron mensajes a esa dirección ni a personas reales.

## Desarrollo local opcional

La integración verificada en esta sesión usa Supabase alojado. La CLI oficial local requiere Docker y varios GB libres; el arranque completo no se verificó en este contenedor por su límite de disco. En una estación de desarrollo:

```sh
npm run supabase:setup
npm run supabase:seed:local
PORTAL_SUPABASE_CONFIG=work/supabase-local.json npm start
```

El archivo local de la CLI contiene claves locales, nunca se versiona. El servidor normaliza la salida de la CLI mediante `localSupabaseConfig`; para el arranque alojado se utiliza `{url,key}`. El seed rechaza URLs externas y obtiene permisos de alta solo mediante SQL administrativo local. No usar ese seed contra un proyecto alojado. Mailpit recoge correo local de prueba; no se conecta un proveedor real.

## Respaldo, restauración y exportación

No se contrató PITR ni se afirma que Free incluya respaldos diarios recuperables. Antes de cualquier uso real se necesitan respaldos PostgreSQL cifrados fuera del proyecto y una copia **separada** de los objetos Storage, con inventario de rutas, versiones, hashes y políticas. Un dump de PostgreSQL no contiene los bytes de Storage. La identidad Auth, factores y configuración del proveedor necesitan un plan específico: no basta con restaurar perfiles.

Procedimiento previsto: detener cambios o fijar un punto consistente, exportar base con la herramienta oficial y permisos administrativos, exportar objetos por el operador autorizado, cifrar ambos, registrar versión de migraciones/configuración y custodiar claves separadamente. Restaurar primero en un proyecto aislado, aplicar permisos/RLS/funciones, restaurar objetos y relacionarlos con metadatos; verificar integridad, conteos, MFA, centros, revocación y descargas antes de cambiar tráfico. No restaurar sobre la web pública ni sobre el otro proyecto.

La exportación de un paciente requiere autorización humana, auditoría y selección de conversaciones/documentos según permisos. No se añadió un endpoint masivo que eluda RLS. **No se ensayó una restauración completa de Supabase alojado** en esta etapa; la restauración SQLite anterior no cuenta como esa prueba.

## Advertencias verificadas

Los advisors finales no detectan tablas expuestas sin RLS ni funciones con `search_path` mutable. La revisión de los activos construidos y archivos versionados no encontró claves privilegiadas ni tokens de sesión. Queda la advertencia de protección contra contraseñas filtradas: [Supabase la ofrece desde Pro](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), por lo que no se activó con coste. Se utilizan contraseñas ficticias aleatorias y MFA. Los avisos informativos de índices sin uso son esperables en una base pequeña; se añadieron los índices de claves foráneas que faltaban.

No hay habilitación sanitaria/legal de esta demo. Antes de pacientes reales faltan aprobación clínica/operativa, contratos y normativa chilena aplicable, protección frente a abuso, recuperación, antimalware, monitoreo, retención y prueba de restauración. No se promete confidencialidad absoluta ni disponibilidad permanente.
