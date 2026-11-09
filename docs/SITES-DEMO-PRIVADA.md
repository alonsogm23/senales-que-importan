# Demo privada publicada con Sites

Fecha: 9 de noviembre de 2026.

URL: https://portal-gomez-demo-privada.bloomyloom22.chatgpt.site

No se contrataron nuevas suscripciones. La web pública, main y el PR sin fusionar se conservan. La demo permanece privada para la cuenta propietaria de ChatGPT; no cambiar su audiencia mientras exista el selector de evaluación.

## Arquitectura

Supabase continúa como única identidad, base de datos y almacenamiento privado del proyecto ficticio existente. Se adaptó el límite HTTP a un Worker ESM con Web APIs y llamadas REST a Supabase; no necesita Vercel, Node ni SQLite en el alojamiento. Se preservaron frontend, RPC, RLS, destinatarios y contratos de API. Esta adaptación es para evaluación, no habilitación clínica.

El código desplegado está versionado en el repositorio de Sites asociado a `appgprj_6af21fa75ee08191a39023d6228ff62d`, commit `1fb51a33bbe5ae08d9b68035c5b605d97bf7526d`. Para editarlo, usar el complemento Sites con ese project_id y recuperar sus credenciales de escritura; no crear otra demo ni sobrescribir el adaptador de Vercel de esta rama. La documentación VERCEL.md describe la alternativa anterior, que no se contrató.

## Acceso de evaluación

Abrir la URL con la misma cuenta ChatGPT propietaria. El selector permite probar familia, CENIT, Cenepsi, secretaria personal y doctor. Solo para cuentas ficticias: el servidor autentica con sus contraseñas y factores TOTP de prueba, sin cambiar roles ni omitir las comprobaciones MFA/RLS de Supabase. Este selector no debe incorporarse a una versión pública ni sustituir el acceso individual de profesionales reales.

Se rotaron contraseñas y factores de esas cinco identidades ficticias; se cerraron sus sesiones previas. Los fixtures de acceso anteriores dejan de ser válidos. Los secretos nuevos están únicamente en variables secretas del servidor de Sites, no en este repositorio. El selector caduca el 16 de noviembre de 2026 y requiere identidad de Sites.

## Comprobaciones

Se verificaron build ESM, activos, cookies Secure/HttpOnly/SameSite, rechazo de orígenes ajenos, CSRF y bloqueo de rutas sin sesión. Se probó el adaptador contra Supabase con los cinco perfiles y sus bandejas, MFA profesional, denegación de recursos inexistentes y cierre de sesión. El despliegue HTTPS responde con frontend y `/api/public`; `/api/session` devuelve 401 sin sesión. Safari físico y la entrada interactiva con ChatGPT del evaluador requieren prueba del propietario.

## Límites

Solo datos ficticios; sin correo, SMS ni IA externos. Reglas clínicas ilustrativas. Sesiones de hasta una hora, con nuevo acceso al expirar. No hay evaluación jurídica ni prueba integral de restauración de Supabase completadas. El alojamiento de esta demo no demuestra aptitud para datos médicos reales ni garantiza disponibilidad de urgencias.
