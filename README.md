# Señales que importan

Web del Dr. Denis Gómez Recabarren. La web pública sigue siendo `index.html`, servida por GitHub Pages desde `main`, con dominio `drdenisgomez.cl`. Esta rama incorpora un **portal local de prueba, exclusivamente con identidades ficticias**. No despliega ni modifica recursos de producción.

## Probar el portal

Requisitos: Node.js **24.14 o posterior de la rama 24 LTS** (verificado con 24.22.1). No hay dependencias de ejecución. SQLite usa `node:sqlite`; el módulo conserva carácter experimental en esta versión de Node.

```sh
npm ci
npm start
```

Abrir **http://127.0.0.1:4173/portal/**. En **http://127.0.0.1:4173/** se puede revisar la web existente con una entrada local al portal. El servidor elimina Analytics de esa copia local; el archivo público original queda intacto. El portal no carga recursos externos, ni analítica, ni almacenamiento en el navegador. Las fuentes originales Lora/DM Sans están alojadas localmente con sus licencias OFL.

Al primer arranque se crea `portal/data/demo.sqlite`, ignorado por Git. Los datos persisten al reiniciar. `NODE_ENV=production` impide arrancar el servidor de prueba; solo escucha en loopback. No introducir información real.

## Cuentas ficticias

Cada fila es una cuenta distinta. No hay selector de rol ni contraseñas compartidas por centro. Estas contraseñas son datos públicos de demostración, nunca credenciales utilizables con pacientes.

| Correo | Contraseña ficticia | Perfil |
| --- | --- | --- |
| family@example.invalid | Familia-Prueba-2026! | Elena, representante de Alex y Sol |
| adolescent@example.invalid | Alex-Prueba-2026! | Alex, paciente adolescente |
| limited@example.invalid | Tomas-Prueba-2026! | Solo enviar antecedentes de Alex; sin acceso a solicitudes ajenas |
| other@example.invalid | Lucia-Prueba-2026! | Representante de Leo; sin vínculo con Alex/Sol |
| cenit@example.invalid | Cenit-Prueba-2026! | Secretaría CENIT |
| cenepsi@example.invalid | Cenepsi-Prueba-2026! | Secretaría Cenepsi |
| personal@example.invalid | Personal-Prueba-2026! | Secretaria personal |
| doctor@example.invalid | Doctor-Prueba-2026! | Doctor ficticio |

**Profesionales:** se exige además TOTP individual (6 dígitos, 30 segundos, ventana ±1 paso, sin reutilización). Ejecutar en otra terminal local:

```sh
npm run demo:codes
```

El comando accede a los secretos de la base de datos local; no exponerlo como endpoint, ni copiar sus códigos a una página pública. Para uso real hace falta enrolamiento y recuperación de MFA con un proveedor aprobado; este comando es una herramienta de desarrollo.

Para crear otra secretaria ficticia con identidad propia, el operador autorizado del entorno puede escribir `work/nueva-cuenta.json` con `{ "email": "otra-cenit@example.invalid", "name": "Otra Secretaria Demo", "role": "cenit" }` y ejecutar:

```sh
node portal/server/admin.mjs provision work/nueva-cuenta.json
```

El procedimiento del servidor genera una contraseña individual y la guarda en `work/credentials/` con permisos 0600, sin imprimirla. Solo admite nombres Demo/Prueba y correos `@example.invalid`. No existe endpoint de asignación de roles ni se confía en campos del cliente. La creación/vinculación de pacientes reales y las invitaciones no están habilitadas.

## Verificar

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
node portal/server/evaluate.mjs
npm run backup
```

Si Chromium ya está instalado: `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. Playwright es la única dependencia de desarrollo. Las pruebas crean bases en memoria y no usan servicios reales; las capturas quedan en `work/screenshots`. Los controles de esta rama están documentados en [docs/VERIFICACION.md](docs/VERIFICACION.md).

## Documentación

- [Arquitectura, modelo, matriz de permisos y decisiones](docs/PORTAL.md).
- [Operación local, respaldo, restauración, exportación y bloqueos](docs/OPERACION.md).
- [Resultado de las verificaciones](docs/VERIFICACION.md).

La aprobación clínica de preguntas, reglas, advertencias y plazos sigue pendiente. Las prioridades solo organizan revisión y pueden equivocarse. Las notificaciones externas son simuladas; no hay proveedor de correo, SMS, IA ni ficha clínica conectado. No habilitar este prototipo para pacientes reales ni publicarlo como un portal operativo.
