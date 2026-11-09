# Señales que importan

Web del Dr. Denis Gómez Recabarren. La web pública (`index.html`, GitHub Pages desde `main`, `drdenisgomez.cl`) sigue intacta. Esta rama añade un **Portal de Pacientes de prueba con datos exclusivamente ficticios**. PR en borrador, sin publicación del portal en Vercel ni contratación de servicios.

## Arquitectura actual

GitHub conserva el código. El frontend existente del portal mantiene módulos ES, identidad visual Lora/DM Sans y diseño móvil. Supabase proporciona la **única identidad activa**, PostgreSQL con RLS y Storage privado. Node 24 sirve la API y mantiene las sesiones en cookies HttpOnly; la función `portal-files` comprueba permisos con el JWT del usuario antes de transferir archivos. No se entrega una clave privilegiada al servidor Vercel ni al navegador.

Proyecto aislado creado en **Alonso org / Free**: `senales-portal-demo-ficticia` (`cpioegorrksyqlqllesu`, São Paulo). Coste de creación confirmado por el complemento: **US$0/mes**. El proyecto `ninis-sicue-amigo-secreto` se conserva intacto. El plan gratuito tiene cuotas y puede pausar proyectos inactivos.

## Ejecutar la aplicación conectada a Supabase

```sh
npm ci
# Configurar las variables de .env.example en el entorno; nunca publicar sus valores privados.
node --env-file=.env portal/server/supabase-server.mjs
```

Node **24.14–24.x**, verificado con 24.22.1. `.env` no se carga automáticamente con `npm start`; exportar las variables o usar el comando anterior. Para desarrollo sin `.env`, `npm start` admite un archivo privado `work/supabase-hosted.json` con `{ "url": "…", "key": "clave publicable", "csrfSecret": "valor privado aleatorio" }`.

El servidor de desarrollo escucha solo en loopback. Eso no proporciona acceso desde un iPhone/iPad. La [guía de Vercel](docs/VERCEL.md) prepara un alojamiento HTTPS separado; **todavía no hay una URL pública de la interfaz**. La URL de Supabase es del backend, no de la página del portal.

## Cuentas y permisos

| Cuenta ficticia | Perfil | Alcance |
| --- | --- | --- |
| `cenit@example.invalid` | Secretaría CENIT | Gestión CENIT; sin conversaciones clínicas |
| `cenepsi@example.invalid` | Secretaría Cenepsi | Gestión Cenepsi; sin conversaciones clínicas |
| `personal@example.invalid` | Secretaria personal | Gestión de ambos centros; sin acceso clínico automático |
| `doctor@example.invalid` | Dr. Gómez, prueba | Ambos centros, contenido clínico y aprobación |
| `family@example.invalid` | Representante de Alex/Sol | Vínculos y destinatarios comprobados |
| `adolescent@example.invalid` | Alex Prueba | Su propio contenido autorizado |
| `limited@example.invalid` | Representante limitado | Enviar antecedentes; sin consulta clínica ajena |
| `other@example.invalid` | Representante de Leo | Sin acceso a Alex/Sol |

Las contraseñas alojadas son aleatorias e individuales; no se incluyen en Git ni en la pantalla de acceso. Las antiguas contraseñas de SQLite **no funcionan en Supabase**. Los profesionales usan MFA TOTP de Supabase con enrolamiento en pantalla; las pruebas automatizadas ya enrolaron factores ficticios. Las credenciales y autenticadores de pruebas permanecen en archivos privados de `work/` y deben rotarse/reaprovisionarse antes de entregar accesos a evaluadores. No compartir el archivo completo ni introducir datos reales. No hay selector de rol ni alta pública habilitada por la aplicación.

## Verificar

```sh
npm run check
npm test                              # 25 comprobaciones del prototipo conservado
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser   # 20 recorridos de regresión
npm run build:portal
# Con configuración y credenciales ficticias privadas del proyecto de prueba:
npm run test:supabase
npm run test:supabase:browser
npm run test:vercel-adapter
```

En este entorno los comandos Node que acceden a Supabase requieren `NODE_USE_ENV_PROXY=1` para utilizar el proxy configurado. No es una variable necesaria en Vercel. Ejecutar las suites alojadas secuencialmente, ya que comparten cuentas ficticias y factores MFA. Las suites alojadas no sustituyen Supabase por una simulación ni omiten silenciosamente las comprobaciones si faltan credenciales. Modifican solo datos ficticios. No publicar trazas, cookies, QR ni archivos de `work/`.

La opción de desarrollo local con la CLI oficial está en [operación Supabase](docs/SUPABASE.md). SQLite se conserva **solo como archivo de referencia/regresión y demostración sin conexión**, mediante `npm run start:legacy`. No comparte usuarios, sesiones ni permisos con la aplicación activa, no hay sincronización ni fallback automático. Sus comandos son `legacy:codes`, `legacy:backup` y `start:legacy:shared-demo`.

## Documentación

- [Supabase: implementación, permisos y operación](docs/SUPABASE.md).
- [Preparación de Vercel, costes y pendientes](docs/VERCEL.md).
- [Resultados de verificación](docs/VERIFICACION.md).
- [Diseño inicial y matriz de permisos del prototipo](docs/PORTAL.md).
- [Operación y respaldo SQLite de referencia](docs/OPERACION.md).
- [Propuesta Render anterior, no aplicada](docs/DEMO-EXTERNA.md).

`Dr.denisgomezconsultas@gmail.com` queda registrado como contacto propuesto. No hay conexión con Gmail/SMTP, envíos reales, proveedor de IA ni ficha clínica. Las reglas de prioridad siguen siendo ilustrativas y pendientes de aprobación médica. Esta infraestructura gratuita de demostración no habilita uso con pacientes reales.
