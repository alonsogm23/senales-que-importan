import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  openSync,
  closeSync,
  chmodSync,
} from "node:fs";
mkdirSync("work", { recursive: true, mode: 0o700 });
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
const log = openSync("work/supabase-setup.log", "w", 0o600);
try {
  execFileSync(
    "npm",
    [
      "exec",
      "--",
      "supabase",
      "start",
      "--exclude",
      "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ],
    { env, stdio: ["ignore", log, log] },
  );
  const result = execFileSync(
    "npm",
    ["exec", "--", "supabase", "status", "-o", "json"],
    { env, stdio: ["ignore", "pipe", log], maxBuffer: 1024 * 1024 },
  );
  JSON.parse(result.toString());
  writeFileSync("work/supabase-local.json", result, { mode: 0o600 });
  chmodSync("work/supabase-local.json", 0o600);
  console.log(
    "Supabase local disponible. Configuración privada guardada sin imprimir claves.",
  );
} catch {
  console.error(
    "No se pudo preparar Supabase local. Revisa work/supabase-setup.log; puede contener claves ficticias y no debe publicarse.",
  );
  process.exitCode = 1;
} finally {
  closeSync(log);
}
