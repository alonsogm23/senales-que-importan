# Verificaciones de la versión de prueba

Fecha: 9 de noviembre de 2026. Entorno: Node.js 24.22.1, SQLite nativo, Chromium del entorno mediante Playwright 1.65.0. No había controles automatizados previos en el repositorio. Se añadieron pruebas de permisos y recorridos, sin servicios reales.

## Resultados ejecutados

| Control | Resultado |
| --- | --- |
| `npm run check` | Correcto: sintaxis de servidor, servicio y cliente |
| `npm test` | **23 pruebas aprobadas**, 0 fallos |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` | **20 pruebas aprobadas**, 0 fallos; 10 escritorio + 10 móvil |
| `npm audit` | 0 vulnerabilidades informadas al consultar el registro |
| Arranque con `npm start` y consulta HTTP local | Correcto; HTML del portal accesible |
| `npm run backup` | Copia SQLite local creada, sin subir ni imprimir contenido |
| Restauración en base independiente | Integridad `ok`, solicitudes, adjuntos binarios y permisos conservados |
| `node portal/server/evaluate.mjs` | Ocho casos ficticios; proveedor IA `not_configured`; no se calcula exactitud clínica |
| Revisión visual | Capturas de 1440×1000 y 390×844, sin desbordamiento global; fuentes y recursos locales |

## Acceso y aislamiento comprobados

- CENIT y Cenepsi reciben solo solicitudes de su centro. La interfaz restringe filtros y acciones. API/URL directa rechazan solicitudes ajenas; vistas SQL no devuelven sus filas.
- Secretaría no puede alterar centro para ampliar acceso. Trigger SQL también rechaza esa escritura. Cambio autorizado por coordinación no abre notas/documentos anteriores al nuevo centro.
- La secretaria personal ve metadatos de ambos centros y filtra Todos/CENIT/Cenepsi; no recibe conversaciones ni documentos clínicos. El doctor accede a todas las solicitudes y originales.
- Rol del cliente ignorado, ruta de elevación inexistente, actualización/creación de rol bloqueada por trigger fuera de aprovisionamiento de servidor. Se probaron dos secretarias individuales del mismo centro.
- Paciente ajeno, destinatario sin autorización, borrador, documento clínico restringido y archivo del otro centro quedan denegados. Se verificaron versiones, aprobación exclusiva médica, firma básica de tipo, expiración y un solo uso del enlace ligado a sesión.
- Representante con permiso de enviar no obtiene solicitudes de otro remitente si no puede gestionar. Gestionar trámites no habilita consultas clínicas nuevas. Acceso clínico exige autorización y destinatarios; un representante no recibe la conversación privada del adolescente por defecto.
- Revocación de vínculo bloquea API y descargas con sesión previa. Revisión vencida bloquea. Cambios de versión de sesión invalidan sesiones. MFA profesional obligatorio y código TOTP no reutilizable.
- CSRF/origen ajeno rechazados, backend y archivo SQLite no servidos por URL. Cookies HttpOnly y SameSite; respuestas privadas `no-store`, CSP y ausencia de peticiones externas del portal en navegador.
- Texto de prueba sensible ausente de metadatos de secretaría, notificaciones y auditoría. El servidor solo imprime el mensaje fijo de arranque; no registra cuerpos, URLs o excepciones de peticiones. Auditoría append-only mediante triggers.

## Flujos y resiliencia comprobados

- Familia: ingreso, formulario dinámico, revisión de paciente/centro/resumen/destinatarios, guardado, seguimiento y ampliación del hilo sin crear duplicado.
- Secretaría: bandeja autorizada, carga de borrador privado y selección de destinatario. Doctor: original, aceptación explícita, aprobación. Familia: descarga después de aprobación.
- Señal roja en motivo administrativo activa la advertencia antes de enviar. Sin login también está disponible. Guardar o simular entrega no crea aceptación médica.
- Asignación no confirma recepción profesional; doctor acepta con actuación auditada y puede registrar incorporación manual a ficha. La ficha externa no está conectada.
- Límite 08:00/20:00 en semana y 08:00/13:00 de fin de semana. Cambios de hora de Chile en abril y septiembre de 2026; siguiente apertura con offset correcto. Ausencia indefinida, retorno en mitad de jornada y retorno a largo plazo.
- Fallo simulado de alertas conserva la solicitud. Reintento no se adelanta al intervalo configurado; segundo intento puede simular entrega. Escalamiento sin respaldo solo marca coordinación manual. Ninguno acepta automáticamente la solicitud.
- IA ausente, proveedor que falla, fragmento inventado y salida válida en observación; se conserva original y prioridad. Las sugerencias no se aplican. Casos incluyen negaciones, pasado, lenguaje indirecto, errores, incompletitud y trámite con señal.
- Navegación por teclado, campos etiquetados, errores accesibles, layouts desktop/móvil y ausencia de errores JavaScript en recorrido revisado.

## Límites de lo comprobado

No se desplegó ni se probó con pacientes reales. No hubo entrega real de email/SMS/segundo canal, identidad de producción, proveedor IA, ficha clínica, cifrado de una infraestructura externa, RLS de Postgres, recuperación de cuenta real, ni pruebas de cargas clínicas o de desastre cloud. Las pruebas de notificación y proveedor son simulaciones explícitas; no acreditan integración operativa. Las reglas son ilustrativas con omisiones y falsas alertas conocidas; no se ha medido precisión ni seguridad clínica. No se efectuó auditoría legal, pentest independiente, evaluación WCAG completa ni prueba con Safari/Firefox, lector de pantalla o dispositivos físicos.

La arquitectura y matriz están en [PORTAL.md](PORTAL.md). Los bloqueos y pasos pendientes para otra etapa figuran en [OPERACION.md](OPERACION.md). Nada de esta entrega autoriza habilitar el uso con personas reales.

Capturas de la versión probada: [escritorio](previews/portal-desktop.png) y [móvil](previews/portal-mobile.png). También se verificó que `NODE_ENV=production` bloquea el arranque. `git diff --check` pasó y `main` permaneció en `1a2d3a395f48d505d167290ccbbcb8d7cc2f9a8f` al cerrar la implementación.
