# Acceso desde iPhone/iPad — estado y propuesta de demostración separada

## Estado real de este entorno

Comprobado el 9 de noviembre de 2026: el entorno no dispone de una herramienta para publicar puertos. Se inició el servidor y se intentó compartir mediante Cloudflare Quick Tunnel 2026.10.7. La conexión directa fue rechazada; la consulta al servicio a través del proxy del entorno devolvió HTTP 403, «Your request was blocked». No se eludió esa restricción ni se crearon túneles funcionales. **No hay una URL HTTPS externa operativa que pueda entregarse desde este entorno.** El escritorio compartido y la vista previa del entorno no convierten una dirección loopback en una dirección accesible desde Safari en otro dispositivo.

Con el servidor iniciado se comprobó realmente, sobre su base persistente ficticia: interfaz móvil en Chromium, ingreso de familia, creación y lectura de solicitud por API, ingreso individual con MFA de CENIT, Cenepsi, secretaria personal y doctor, rechazo de Cenepsi a la solicitud CENIT y aceptación explícita del doctor. No se verificó Safari físico ni una conexión externa. No se enviaron comunicaciones reales.

## Propuesta lista para revisar: servicio independiente en Render

Se prepararon `deploy/render-demo.yaml` y el punto de entrada `portal/server/shared-demo.mjs`. **No se aplicó el Blueprint, no se creó una cuenta/servicio ni se incurrió en gastos.** La configuración usa exclusivamente la rama `feat/portal-pacientes-prueba`, no conecta el dominio del doctor y desactiva despliegues automáticos. No requiere fusionar el PR ni cambiar GitHub Pages.

La propuesta sirve interfaz y API juntas en un hostname HTTPS de Render. Mantiene SQLite y adjuntos en un disco privado independiente. Añade una barrera HTTP Basic delante de interfaz, recursos, API y descargas; después se exige la cuenta individual y MFA profesional existentes. La barrera de revisión no asigna ningún rol. Su contraseña privada de al menos 32 caracteres se genera como secreto en Render; no se guarda en Git ni se incluye en URL. El servidor rechaza orígenes sin HTTPS, el dominio público del doctor, conjuntos de datos que no sean los de demostración y configuraciones sin una fecha de vencimiento dentro de 14 días. Después de esa fecha bloquea la demostración.

El endpoint `/health` solo devuelve un estado genérico, sin pacientes o solicitudes. La advertencia de urgencia sigue siendo legible antes de entrar. Las respuestas tienen `no-store` y las cookies del portal llevan Secure al utilizar el origen HTTPS configurado. El envío de correos/segundo canal sigue simulado y el proveedor de IA sigue desactivado. Este punto de entrada se habilita explícitamente con `PORTAL_DEMO_MODE=fictional-only`; el servidor local original conserva su bloqueo de uso como servidor de producción.

## Coste publicado y configuración pendiente

Tarifas consultadas en la página oficial https://render.com/pricing el 9 de noviembre de 2026:

| Componente | Tarifa publicada |
| --- | --- |
| Workspace Hobby | US$0/mes más recursos |
| Web service `0.5c-512mb`, 512 MB RAM | US$7/mes |
| Disco persistente 1 GB | US$0,25/mes |
| Base propuesta | **US$7,25/mes**, antes de impuestos y excesos |

El workspace Hobby incluye 5 GB de transferencia al mes; la tarifa publicada por exceso es US$0,15/GB. Los cargos de compute se prorratean según uso. La fecha de vencimiento de la aplicación **no elimina el servicio ni detiene por sí sola la facturación**: al terminar la prueba hay que eliminar o suspender los recursos según corresponda y revisar la facturación del disco.

Existe compute gratuito de US$0 con limitaciones, pero no admite el disco persistente propuesto: SQLite puede perder solicitudes, sesiones y secretos MFA al reiniciar/recrear el servicio; además se suspende después de 15 minutos sin tráfico y tarda en arrancar. No se presenta esa opción como equivalente a la demo persistente. Para usarla habría que retirar el disco y aceptar explícitamente esos reinicios de datos ficticios.

Falta una cuenta de Render conectada/autorizada para crear el servicio y aceptar su coste. No hay una conexión a Render disponible en esta sesión. No se deben pegar claves o contraseñas reales en el chat.

## Pasos concretos de activación, pendientes de configurar el alojamiento

1. En un workspace separado de pruebas de Render, crear un Blueprint desde el repositorio y la rama del PR; seleccionar `deploy/render-demo.yaml` como ruta. Revisar que solo crea el servicio y disco de demostración indicados y comprobar el precio antes de aplicar.
2. Confirmar el hostname HTTPS que asigna Render. Establecer `PORTAL_DEMO_ORIGIN` a ese origen exacto, sin barra final. El arranque falla de forma cerrada hasta que sea correcto. No utilizar `drdenisgomez.cl` ni alterar sus DNS.
3. Establecer `PORTAL_DEMO_EXPIRES_AT` como fecha/hora ISO con zona explícita, futura y a no más de 14 días. Render genera `PORTAL_DEMO_PASSWORD` como secreto. El Blueprint fija Node 24.22.1, `PORTAL_DEMO_DB=/var/data/demo.sqlite` y el modo exclusivamente ficticio.
4. Entregar por un canal privado la URL de revisión y la credencial de la barrera: usuario `revision` y el secreto `PORTAL_DEMO_PASSWORD`. No poner el secreto en enlaces ni en el PR.
5. Entrar por HTTPS y comprobar interfaz, login, creación, permisos y descarga en el servicio alojado antes de declararlo accesible. Estos controles de red externa y TLS **no se han realizado**, porque el servicio no existe todavía.
6. Para profesionales, obtener el TOTP de sus cuentas ficticias desde la consola privada del servicio mediante `npm run demo:codes`; el comando respeta `PORTAL_DEMO_DB`. No exponer ese comando o los secretos MFA mediante un endpoint público. El operador puede organizar el enrolamiento privado en un autenticador para una prueba más prolongada; no hay un procedimiento de enrolamiento de producción implementado.

## Entrar con cada perfil cuando exista el servicio

Primero se atraviesa la barrera privada de revisión. Después se usa la pantalla de acceso personal:

| Perfil de prueba | Correo | Contraseña ficticia | Segundo factor |
| --- | --- | --- | --- |
| Familia / representante | family@example.invalid | Familia-Prueba-2026! | No |
| Paciente adolescente | adolescent@example.invalid | Alex-Prueba-2026! | No |
| Representante con permiso de enviar antecedentes | limited@example.invalid | Tomas-Prueba-2026! | No |
| Representante de otro paciente | other@example.invalid | Lucia-Prueba-2026! | No |
| Secretaría CENIT | cenit@example.invalid | Cenit-Prueba-2026! | TOTP individual de la consola privada |
| Secretaría Cenepsi | cenepsi@example.invalid | Cenepsi-Prueba-2026! | TOTP individual de la consola privada |
| Secretaria personal | personal@example.invalid | Personal-Prueba-2026! | TOTP individual de la consola privada |
| Doctor | doctor@example.invalid | Doctor-Prueba-2026! | TOTP individual de la consola privada |

Estas contraseñas son semillas públicas de prueba: la barrera privada es obligatoria para compartirlas. El rol proviene de la cuenta de servidor, no de un selector ni de un código de centro. Al salir, «Cerrar sesión» cierra la cuenta del portal; Safari puede conservar temporalmente las credenciales de HTTP Basic hasta cerrar la sesión del navegador.

## Verificación del código preparado

Las pruebas específicas comprueban: arranque rechazado sin origen separado, secreto fuerte y vencimiento; datos ajenos a las semillas rechazados; bloqueo de HTML, API y archivos sin la barrera; login que exige sesión individual; cookie Secure; CSRF/origen; creación de solicitud sin aceptación automática; caducidad de la demo. Se ejecutaron mediante HTTP de prueba con los encabezados del origen HTTPS configurado. **No equivalen a una prueba de TLS o conectividad pública.**

Fuentes técnicas: https://render.com/docs/blueprint-spec, https://render.com/docs/compute-plans, https://render.com/docs/disks, https://render.com/docs/free y https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/.
