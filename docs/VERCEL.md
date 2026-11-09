# Despliegue de prueba separado en Vercel

Estado: preparado, **no desplegado**. No se creó un proyecto Vercel, no se activó una prueba Pro, no se contrató nada ni se modificó la web pública. La URL de Supabase es una API; no es el enlace de la interfaz para iPhone/iPad.

## Componentes que se complementan

- **GitHub** conserva código, revisiones y el PR en borrador. GitHub Pages sigue alojando la web pública estática.
- **Supabase** conserva la única identidad de usuario, roles relacionados, PostgreSQL y archivos privados. Proyecto gratuito aislado ya creado y comprobado con datos ficticios.
- **Vercel** ejecutaría la API Node y serviría el frontend del portal en otro subdominio HTTPS. No sustituye a Auth/PostgreSQL/Storage. No se necesita reescribir la web en Next.js.

Se han preparado `vercel.json`, `api/[...path].mjs`, un adaptador Web Request/Response y un build que publica solo `portal/public`. La región de funciones propuesta es São Paulo (`gru1`), junto al proyecto Supabase. Datos y usuarios no dependen del disco efímero de Vercel. La API de aplicación nunca necesita `service_role`; los archivos pasan por la función autorizada de Supabase.

## Pasos para el operador

1. Revisar el PR sin fusionarlo. Crear **otro proyecto Vercel** para esta demostración a partir de la rama `feat/portal-pacientes-prueba`. No enlazar `drdenisgomez.cl`, cambiar DNS de la web pública ni seleccionar el proyecto Supabase ajeno.
2. Comprobar que el plan elegido admite este uso. [Hobby restringe el uso a proyectos personales no comerciales](https://vercel.com/docs/plans/hobby#comparing-hobby-and-pro-plans). Una demo vinculada a una consulta profesional no queda automáticamente admitida por usar pacientes ficticios. Si requiere Pro, detenerse: **no hay autorización para contratarlo**. Tampoco activar un trial que genere una obligación posterior.
3. Configurar framework **Other**, Node **24.x**, raíz del repositorio, instalación `npm ci`, build `npm run build:portal` y salida `dist-portal`. `vercel.json` ya configura funciones, límites, región, cabeceras de privacidad y rutas. La integración Git está deshabilitada deliberadamente (`git.deploymentEnabled=false`): los pushes no deben publicar automáticamente. No ejecutar `vercel --prod`.
4. Usar un alias HTTPS estable y separado para la demo; configurar `PORTAL_ORIGIN` con ese origen exacto, sin `/` final. No derivarlo del Host recibido ni aceptar cualquier dominio de preview. Si cambia el alias, cambiar la variable y reconstruir la demo.
5. Configurar variables de servidor del entorno Preview según `.env.example`: `PORTAL_SUPABASE_URL=https://cpioegorrksyqlqllesu.supabase.co`, `PORTAL_SUPABASE_PUBLISHABLE_KEY` del **nuevo proyecto** y `PORTAL_CSRF_SECRET` aleatorio de al menos 32 caracteres, estable entre instancias. La clave publicable puede consultarse en el Dashboard del proyecto. El secreto CSRF se genera/custodia en el gestor de secretos del operador. No copiar contraseñas de pacientes, archivos de `work/`, claves `service_role` ni la contraseña de la base a Vercel.
6. Activar protección del despliegue para el grupo de evaluadores. Las cuentas personales del portal siguen siendo obligatorias. Verificar qué método de protección está incluido en el plan; no contratar protección por contraseña ni otros add-ons. `.vercelignore` y las exclusiones de funciones impiden empaquetar pruebas, bases locales o credenciales.
7. El backend Supabase ya tiene migraciones aplicadas, bucket privado y `portal-files` desplegada. No ejecutar `db reset`, el seed local ni migraciones contra el proyecto existente. Verificar en Dashboard que `portal_private` no está expuesto por Data API y revisar los ajustes de registro, proveedores y recuperación de Auth.
8. Rotar las credenciales/factores de las cuentas ficticias utilizadas por automatización antes de compartirlas con personas. Entregar accesos individuales por un canal privado y enrolar TOTP con cada evaluador. Los perfiles CENIT/Cenepsi/personal/doctor ya están definidos; no se eligen en la pantalla de acceso.
9. Ejecutar en el alojamiento real: advertencia sin sesión, inicio de sesión/MFA, solicitud e hilo, cada bandeja por centro, controles negativos de API y archivos, subida, aprobación, descarga, revocación, cookies Secure, CSRF entre instancias y falta de caché. Revisar límites/errores del runtime sin registrar contenido clínico.
10. Probar esa URL HTTPS desde **Safari real en iPhone/iPad**. La emulación Chromium de esta sesión no sustituye esa prueba. Publicar el enlace de la demo solo después de estas comprobaciones. Mantener datos ficticios y PR en borrador.

El adaptador Web API fue probado localmente con el backend Supabase alojado, cookies Secure y dos instancias con el mismo secreto CSRF. El build estático se verificó. **No se ejecutó el builder/infraestructura de Vercel ni se comprobó un dominio público de Vercel**; sus rutas, protección, límites y cookies deben validarse tras el despliegue autorizado. El limitador local de intentos de login no se comparte entre instancias: complementar con la limitación de Auth y definir protección distribuida antes de pacientes reales.

## Costes y condiciones

Fuentes oficiales consultadas el 9 de noviembre de 2026: [Supabase Pricing](https://supabase.com/pricing), [Vercel Pro](https://vercel.com/docs/plans/pro-plan#pro-plan-pricing), [Vercel Hobby](https://vercel.com/docs/plans/hobby). Importes en USD, sin impuestos, conversión de moneda ni consumos adicionales.

| Concepto | Demo actual | Escenario operativo orientativo, no contratado |
| --- | --- | --- |
| Código GitHub | Sin nuevo coste | Depende del plan de la cuenta |
| Base/Auth Supabase | **US$0/mes confirmado**, Free | Pro desde **US$25/mes** publicado para primer proyecto; la organización comparte el plan y otro proyecto puede añadir desde US$10/mes. No actualizar la organización sin evaluar el proyecto ajeno |
| Archivos privados | 1 GB incluido en Free | 100 GB incluidos en Pro; exceso publicado US$0,0213/GB-mes; egreso aparte |
| Alojamiento de la interfaz/API | No desplegado, **US$0 contratado** | Vercel Pro: tarifa publicada US$20/mes con un puesto de despliegue; consumo/add-ons aparte. Hobby US$0 solo si el caso cumple sus condiciones |
| Respaldo de PostgreSQL | Sin respaldo gestionado contratado | Pro publica copias diarias de 7 días. PITR, si se necesita, tiene coste adicional **no confirmado aquí** |
| Copia independiente de archivos | No contratada | Estimación de presupuesto **US$5–15/mes no cotizada**, según proveedor, volumen, retención y descargas |
| Correo y segundo canal | Avisos internos y simulaciones: US$0 | Estimación **US$0–20/mes no cotizada** a bajo volumen; SMS/WhatsApp y reintentos dependen del proveedor/país. Gmail no equivale a un canal clínico validado |
| IA | Sin proveedor, US$0 | Pendiente de proveedor, evaluación y consumo; sin importe confirmado |

Un presupuesto técnico inicial hipotético de un solo proyecto operativo sería **US$45/mes de bases publicadas** (25+20), más respaldos de objetos, notificaciones, impuestos y consumos. **No es un presupuesto sanitario completo** ni garantiza que ese plan/contrato sea suficiente. La organización actual tiene otro proyecto: convertir toda la organización a Pro puede cambiar su facturación; por eso no se hizo. Los profesionales del portal son usuarios de Auth, no necesitan cada uno un puesto de desarrollador de Vercel.

La demo actual mantiene Free y no debe recibir datos sanitarios reales. Para una versión operativa en Chile se necesitan evaluación legal de transferencias/encargados, contratos de tratamiento, seguridad, soporte, retención, disponibilidad, respaldo y recuperación. No se ha contratado ni confirmado un acuerdo sanitario de Vercel/Render/Supabase. HIPAA no sustituye la normativa chilena; si fuera aplicable por el contexto, Supabase publica disponibilidad como add-on de pago en Team (desde US$599/mes), y el importe/condiciones del add-on y de cualquier BAA de alojamiento **no están confirmados aquí**. No inferir aptitud sanitaria de disponer de HTTPS o RLS.

La propuesta Render anterior se conserva como documento histórico, no aplicada; no hay motivos para mantener a la vez un backend de usuarios SQLite en Render y otro de Supabase. La arquitectura propuesta tiene una sola identidad y autorización.
