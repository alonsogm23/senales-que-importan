import { openStore, totp } from "./service.mjs";
import { randomBytes } from "node:crypto";
import { backup } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
const root = new URL("../../", import.meta.url).pathname;
const store = openStore(resolve(root, "portal/data/demo.sqlite"));
if (process.argv[2] === "codes") {
  console.log(
    "Segundo factor de cuentas ficticias. No es un servicio de autenticación de producción.",
  );
  for (const a of store.all(
    "SELECT email,totp FROM accounts WHERE role<>'family'",
  ))
    console.log(`${a.email}: ${totp(a.totp)}`);
} else if (process.argv[2] === "provision") {
  const config = JSON.parse(readFileSync(process.argv[3], "utf8"));
  if (
    typeof config.email !== "string" ||
    !config.email.endsWith("@example.invalid") ||
    typeof config.name !== "string" ||
    !/Demo|Prueba/.test(config.name)
  )
    throw Error(
      "Solo se admiten identidades ficticias @example.invalid con nombre Demo o Prueba.",
    );
  const password = randomBytes(24).toString("base64url");
  const account = store.as("system", () =>
    store.provision({ ...config, password }),
  );
  const folder = resolve(root, "work/credentials");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const output = resolve(folder, `${account}.json`);
  writeFileSync(
    output,
    JSON.stringify({ account, email: config.email, password }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "Cuenta ficticia creada. Credenciales privadas guardadas en work/credentials, sin imprimirlas.",
  );
} else if (process.argv[2] === "backup") {
  const folder = resolve(root, "work/backups");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = resolve(folder, `portal-${Date.now()}.sqlite`);
  await backup(store.db, path);
  chmodSync(path, 0o600);
  console.log("Respaldo local completo (incluye adjuntos) en work/backups.");
} else
  console.log(
    "Usa: npm run demo:codes | npm run backup. El aprovisionamiento de roles solo existe en el servidor, sin endpoint público.",
  );
store.db.close();
