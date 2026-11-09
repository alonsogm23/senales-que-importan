# Operación y límites de la prueba

## Entornos

Este servidor solo escucha en `127.0.0.1`, no tiene configuración de producción y rechaza `NODE_ENV=production`. No usar un túnel público para recibir información real. La rama no debe fusionarse ni desplegarse como portal sanitario operativo. GitHub Pages seguirá sirviendo la web pública desde `main` y no ejecuta Node/SQLite. Un enlace local al portal permite revisar la integración sin cambiar esa web.

Sin credenciales externas no hay bloqueo para probar solicitudes, sesiones, permisos, documentos, horarios y flujos locales. Los bloqueos concretos de integración real son: no hay alojamiento backend/BD privado aprobado, proveedor de identidad y recuperación MFA, proveedor de correo y segundo canal, modelo de IA contratado, ni ficha clínica conectada. No se han solicitado ni utilizado secretos de producción. No se han creado recursos remotos.

## Respaldo local

`npm run backup` utiliza la API de backup de SQLite y guarda una copia consistente en `work/backups/` con permisos 0600. Incluye documentos BLOB, versiones, auditoría, sesiones y secretos de MFA ficticios. La base y el directorio de trabajo están ignorados por Git. La carpeta de datos tiene permisos 0700. Respaldo puede ejecutarse con el servidor abierto; para restaurar se debe detener.

Se verificó la recuperación de un respaldo local en una base separada: integridad SQLite, conteo de solicitudes, contenido binario de documentos y lectura autorizada. No equivale a prueba de restauración de una infraestructura cloud.

## Restaurar

1. Detener `npm start` y todos los procesos que usan la base.
2. Conservar una copia del estado actual fuera de `portal/data` en una carpeta privada.
3. Reemplazar `portal/data/demo.sqlite` por la copia elegida; retirar del directorio de datos los archivos WAL/SHM de la instancia detenida, si quedaron, después de respaldarlos. Nunca mezclar WAL de otra base.
4. Mantener permisos 0700 en directorio y 0600 en archivos.
5. Ejecutar `PRAGMA integrity_check` mediante `node:sqlite`, comprobar conteos de tablas y adjuntos y probar acceso con una cuenta ficticia autorizada. Reiniciar el servidor. Si falla, volver a la copia anterior con el servidor detenido.

No restaurar sobre una instancia en ejecución ni sobre un sistema de producción. El prototipo no implementa migraciones automáticas entre versiones del esquema. Una base de una versión incompatible requiere conservar respaldo y recrear exclusivamente los datos ficticios, o preparar una migración explícita.

## Exportación

El backup SQLite es la exportación completa local, incluye BLOB y relaciones. Para exportaciones de paciente hay que usar un procedimiento de servidor con autorización humana, permisos de paciente vigentes y auditoría, incluyendo versiones y destinatarios; no se ofrece un endpoint de descarga masiva que eluda restricciones. La exportación interoperable a ficha clínica o formatos institucionales queda pendiente de especificación/aprobación. No se ha enviado información a terceros.

Si en una etapa posterior se separan los archivos en Storage, el respaldo de la base no respaldará automáticamente los objetos: se necesita copia independiente cifrada, inventario de claves/versiones, control de acceso, restauración conjunta y prueba de enlaces. En esta prueba los BLOB están dentro de la copia SQLite.

## Antes de habilitar personas reales

No se solicita aprobación para avanzar en la prueba. Los siguientes son trabajos pendientes para otra etapa, no integraciones ya operativas:

- Infraestructura sanitaria privada, HTTPS, cookies Secure, cifrado en reposo de BD/adjuntos/backups con gestión de claves y rotación. En la prueba se usa HTTP de loopback y permisos del sistema de archivos; no se afirma cifrado en tránsito de la conexión local ni cifrado en reposo del SQLite.
- Proveedor de identidad con alta/recuperación individual, enrolamiento de MFA, política de sesiones y operación de revocación de cuentas; sustitución de las identidades y herramientas de demostración. No exponer el comando de códigos de prueba.
- Verificación administrativa/legal de vínculos, permisos por adolescente/documento, restricciones judiciales, cambios de cuidador y revisión de mayoría de edad. Diseñar alta y revisión de casos dudosos; no se usa RUT como contraseña.
- Evaluar separación de credenciales/roles de base de datos y RLS en Postgres si se elige esa arquitectura. Auditoría externa con retención/tamper resistance frente al administrador; los triggers locales solo protegen escrituras normales, no frente al dueño del archivo.
- Comprobación profunda y análisis antimalware de adjuntos, límites de almacenamiento, custodia y eliminación según políticas aprobadas. El prototipo valida tipo declarado, firma básica, tamaño y autorización, no garantiza que un PDF sea inocuo.
- Proveedor de correo y canal prioritario aprobados; autenticación de webhooks, idempotencia, procesamiento durable, reintentos, supervisión, cobertura organizada y profesional de respaldo solo cuando exista designación autorizada. Los avisos externos actuales son simulados y se ejecutan manualmente.
- Aprobación del doctor de preguntas, reglas, tarjeta roja, límites de confidencialidad y procedimientos. Aprobación operativa de plazos, escalamiento, ausencias y respuesta a fallos. Sin valores presentados como estándar médico.
- Evaluación de accesibilidad con usuarios, lector de pantalla y dispositivos reales. Las pruebas realizadas cubren Chromium automatizado móvil/escritorio y teclado; no sustituyen validación humana completa ni auditoría WCAG.
- Evaluación clínica y de privacidad de IA en observación, proveedor/región/retención, acuerdo de tratamiento y mecanismo de suspensión. No se ha verificado un modelo ni se anuncia detección clínica validada.
- Respaldos fuera del servidor, cifrados, con retención y ensayo de desastre; exportación institucional y protección de registros. Monitoreo sin contenido clínico en logs, URL o analítica.

Los recursos de producción, cuentas de pacientes y comunicaciones con personas reales no se han tocado.
