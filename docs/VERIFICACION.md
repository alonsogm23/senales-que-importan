# Verificación del Portal de Pacientes

Actualización: 9 de noviembre de 2026. Solo identidades, solicitudes y documentos ficticios. El PR sigue en borrador; `main`, Pages y `drdenisgomez.cl` no se modificaron.

## Supabase alojado real

Proyecto `senales-portal-demo-ficticia` (`cpioegorrksyqlqllesu`), Alonso org, plan Free, estado ACTIVE_HEALTHY. Se verificaron ocho usuarios en Auth, cuatro perfiles profesionales y cuatro factores TOTP verificados. PostgreSQL confirmó RLS en todas las tablas públicas del portal y bucket `portal-documents` privado. No se consultó contenido del proyecto existente.

La suite `portal/tests/supabase.integration.mjs` agrupa 12 pruebas de integración. Accede a Auth, REST, RPC y Storage reales; no usa SQLite, mocks ni un fallback. Comprueba:

- Inicio de sesión y MFA con Supabase. Sesión profesional AAL1 sin acceso a solicitudes. Cambiar `user_metadata.role` no cambia el perfil; la escritura directa de perfiles está denegada.
- CENIT y Cenepsi ven solo su centro mediante API de aplicación y REST. Se rechazan IDs del otro centro y el intento de cambiar centro para ampliar acceso.
- La secretaria personal coordina ambos centros sin conversaciones clínicas; doctor ve ambos y el original. El representante no obtiene el hilo privado del adolescente ni información de pacientes ajenos.
- Crear una solicitud por HTTP y ampliar el hilo persiste en PostgreSQL, con estado Registrada y aceptación nula.
- Subida a Storage privado, borrador invisible a familia, aprobación exclusiva del doctor, descarga autorizada y ticket de un solo uso. Lectura directa y creación de URL firmada con tokens de usuario denegadas.
- Documentos clínicos solo para doctor y destinatarios aprobados. Revocar un vínculo bloquea API, REST y un ticket ya emitido con sesión anterior; el fixture se restituye después de comprobarlo.
- Cambio autorizado de centro sin revelar mensajes ni documentos administrativos anteriores. Cambio no autorizado denegado.
- IA no configurada y fallo simulado de notificaciones conservan la solicitud, texto original y falta de aceptación. El worker informa cero mensajes externos enviados. La cola no incluye cuerpos clínicos. El texto y los metadatos de documentos no se leen directamente por REST, incluso con token médico: se exige el RPC que audita la consulta.
- Aislamiento de archivos comprobado en ambas direcciones CENIT/Cenepsi. Un ticket emitido para una sesión no sirve en otra sesión del mismo representante. Una frase roja en una gestión administrativa eleva prioridad desde PostgreSQL aunque el cliente envíe prioridad verde; secretaría no puede aceptarla como actuación médica.
- Rechazo de tipo de adjunto falso, CSRF ausente, registro público no autorizado, RPC anónimo y escritura de auditoría. Logout invalida la sesión anterior.

También se consultó la función PostgreSQL de cobertura en diez instantes: antes y al abrir/cerrar jornada, sábado y cambios de hora de abril/septiembre de 2026. Resultados coincidentes con `America/Santiago`. Las pruebas de regresión conservan casos de ausencia y próxima apertura.

Los advisors finales no detectan tablas sin RLS ni funciones con búsqueda mutable. Queda una advertencia: [protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), disponible desde Pro y no activada para respetar US$0. Los índices de claves foráneas que faltaban se añadieron; los avisos restantes de rendimiento son índices todavía sin uso en esta base pequeña.

## Navegador y adaptador de alojamiento

Pasaron **11/11 recorridos** en Chromium con backend Supabase alojado desde el servidor de desarrollo. Los recorridos de familia comprueban selección explícita de paciente, formulario, revisión, envío y ampliación de hilo. Los profesionales comprueban MFA, bandejas por centro y rechazo de API ajena. Las suites alojadas deben ejecutarse secuencialmente: la verificación MFA puede invalidar otras sesiones pendientes del mismo usuario; no se cambió esa protección del proveedor para facilitar las pruebas. El enrolamiento desde interfaz comprueba que se carga el QR y que Auth acepta el código. Las pruebas no generan trazas ni capturas de secretos. Se comprobó la carga de la imagen QR y la verificación con código TOTP; no se probó escanear el QR con un teléfono físico.

El flujo de documentos se verificó en **1440×1000 y 390×844**: secretaria sube PDF ficticio, doctor aprueba esa versión y familia descarga desde el botón de la interfaz. Se comprobó además el adaptador Web Request/Response previsto para Vercel: login real, cookie Secure/HttpOnly de tamaño válido, CSRF entre dos instancias con secreto estable, POST persistido, origen incorrecto rechazado y `no-store`.

El build `npm run build:portal` produce únicamente activos del portal y logo; no incluye bases locales, credenciales ni la página pública. `npm run check` y `git diff --check` pasaron. El esquema de `vercel.json` y la documentación vigente de funciones Node se consultaron al preparar el adaptador.

## Regresión conservada

`npm test`: **25/25** comprobaciones de servidor/seguridad del prototipo SQLite, incluidas barrera externa legacy, aislamiento, representación, documentos, sesiones, horarios, fallos y observación de IA.

`CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`: **20/20** recorridos de escritorio/móvil del prototipo conservado. Estas pruebas usan SQLite en memoria y se identifican como regresión, no como evidencia de Supabase.

## Límites y pendientes

No se desplegó la interfaz en Vercel, no se probó su builder/runtime alojado, dominio HTTPS ni protección de despliegue. No se dispone todavía de un enlace público para el dispositivo del usuario. No se probó Safari en iPhone/iPad, Firefox, lector de pantalla ni accesibilidad con familias reales.

No hay Gmail/SMTP, SMS, segundo canal, IA o ficha clínica operativos. Fallos/entregas externas son simulaciones explícitas. El Gmail proporcionado queda como contacto propuesto, sin mensajes enviados. No se verificó restauración completa de PostgreSQL/Auth/Storage ni recuperación de cuentas en una infraestructura operativa. Tampoco se efectuó pentest independiente, prueba de carga, auditoría legal ni aprobación de preguntas/reglas por el doctor. No se utilizaron datos reales.

Las credenciales y los secretos MFA de automatización se conservan fuera de Git, con permisos privados. Antes de compartir accesos deben rotarse y enrolarse factores personales. La configuración gratuita no se presenta como habilitación para pacientes reales. Los pasos siguientes están en [VERCEL.md](VERCEL.md) y [SUPABASE.md](SUPABASE.md).
