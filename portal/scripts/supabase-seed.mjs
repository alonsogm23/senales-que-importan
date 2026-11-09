import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { localSupabaseConfig } from "../server/supabase-store.mjs";
import { initialRules } from "../public/policy.js";
const c = localSupabaseConfig();
const admin = createClient(c.url, c.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const check = (r) => {
  if (r.error) throw Error("Fallo de aprovisionamiento local: " + r.error.code);
  return r.data;
};
// Provision only this local stack; no --remote flag and no hosted project key accepted.
const localEnv = { ...process.env };
for (const k of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete localEnv[k];
execFileSync(
  "npm",
  [
    "exec",
    "--",
    "supabase",
    "db",
    "query",
    "insert into portal_private.demo_auth_permits select x||'@example.invalid',now()+interval '10 minutes' from unnest(array['family','adolescent','limited','other','cenit','cenepsi','personal','doctor']) x on conflict(email) do update set expires_at=excluded.expires_at",
  ],
  { env: localEnv, stdio: ["ignore", "ignore", "pipe"] },
);
const existing = check(
  await admin.auth.admin.listUsers({ perPage: 1000 }),
).users;
const users = {};
for (const [alias, name, role, pw] of [
  ["family", "Elena Prueba", "family", "Familia"],
  ["adolescent", "Alex Prueba", "family", "Alex"],
  ["limited", "Tomás Prueba", "family", "Tomas"],
  ["other", "Lucía Prueba", "family", "Lucia"],
  ["cenit", "Carolina Demo · CENIT", "cenit", "Cenit"],
  ["cenepsi", "Paula Demo · Cenepsi", "cenepsi", "Cenepsi"],
  ["personal", "Isabel Demo · Coordinación", "personal", "Personal"],
  ["doctor", "Dr. Gómez · cuenta de prueba", "doctor", "Doctor"],
]) {
  const email = alias + "@example.invalid";
  const user =
    existing.find((u) => u.email === email) ||
    check(
      await admin.auth.admin.createUser({
        email,
        password: pw + "-Prueba-2026!",
        email_confirm: true,
      }),
    ).user;
  users[alias] = user.id;
  const found = check(
    await admin.from("portal_profiles").select("id").eq("id", user.id),
  );
  if (!found.length)
    check(
      await admin
        .from("portal_profiles")
        .insert({ id: user.id, email, name, role }),
    );
}
let patients = {};
const old = check(await admin.from("portal_patients").select("id,name"));
for (const [alias, name, birth_date, centers] of [
  ["alex", "Alex Prueba", "2011-03-12", ["CENIT", "Cenepsi"]],
  ["sol", "Sol Prueba", "2016-07-18", ["Cenepsi"]],
  ["leo", "Leo Prueba", "2013-05-01", ["Cenepsi"]],
]) {
  const found = old.find((p) => p.name === name);
  const pid = found?.id || randomUUID();
  patients[alias] = pid;
  if (!found) {
    check(
      await admin.from("portal_patients").insert({ id: pid, name, birth_date }),
    );
    check(
      await admin
        .from("portal_enrollments")
        .insert(centers.map((center) => ({ patient: pid, center }))),
    );
  }
}
for (const [who, pid, manage, submit, clinical, review_on] of [
  ["family", "alex", true, true, true, "2029-03-12"],
  ["family", "sol", true, true, false, "2034-07-18"],
  ["adolescent", "alex", true, true, true, null],
  ["limited", "alex", false, true, false, "2029-03-12"],
  ["other", "leo", true, true, true, "2031-05-01"],
]) {
  const found = check(
    await admin
      .from("portal_grants")
      .select("id")
      .eq("account", users[who])
      .eq("patient", patients[pid]),
  );
  if (!found.length)
    check(
      await admin
        .from("portal_grants")
        .insert({
          account: users[who],
          patient: patients[pid],
          manage,
          submit,
          clinical,
          review_on,
          verified_by: users.personal,
          evidence: "VERIFICACION_FICTICIA",
        }),
    );
}
for (const [key, value] of Object.entries({
  absence: { enabled: false, until: null },
  rules: initialRules.version,
  delivery: {
    retryMinutes: null,
    maxAttempts: 3,
    escalateMinutes: null,
    backup: null,
  },
})) {
  if (
    !check(await admin.from("portal_settings").select("key").eq("key", key))
      .length
  )
    check(await admin.from("portal_settings").insert({ key, value }));
}
if (
  !check(
    await admin
      .from("portal_rules")
      .select("version")
      .eq("version", initialRules.version),
  ).length
)
  check(
    await admin
      .from("portal_rules")
      .insert({
        version: initialRules.version,
        config: initialRules,
        author: users.doctor,
        change_reason: "Semilla ficticia sin validación clínica",
      }),
  );
const requests = {};
for (const [alias, pid, who, center, reason, priority, body, audience] of [
  [
    "demo-cenit",
    "alex",
    "family",
    "CENIT",
    0,
    0,
    "Necesito un justificante ficticio de asistencia para el colegio.",
    ["family"],
  ],
  [
    "demo-clinical",
    "alex",
    "adolescent",
    "CENIT",
    3,
    2,
    "Me ha costado dormir desde ayer. Prefiero conversar primero con el doctor. Este mensaje es ficticio.",
    ["adolescent"],
  ],
  [
    "demo-cenepsi",
    "sol",
    "family",
    "Cenepsi",
    1,
    0,
    "Quisiera coordinar una hora de control ficticia.",
    ["family"],
  ],
  [
    "demo-other",
    "leo",
    "other",
    "Cenepsi",
    2,
    1,
    "Tengo una duda sobre el horario del tratamiento ficticio.",
    ["other"],
  ],
]) {
  const previous = check(
    await admin
      .from("portal_requests")
      .select("id")
      .eq("patient", patients[pid])
      .eq("requester", users[who])
      .eq("reason", reason),
  ).find(() => true);
  const rid = previous?.id || randomUUID();
  requests[alias] = rid;
  if (!previous) {
    check(
      await admin
        .from("portal_requests")
        .insert({
          id: rid,
          patient: patients[pid],
          requester: users[who],
          center,
          reason,
          state: "Registrada",
          priority,
          rules_version: initialRules.version,
        }),
    );
    const mid = randomUUID();
    check(
      await admin
        .from("portal_messages")
        .insert({
          id: mid,
          request: rid,
          author: users[who],
          kind: "clinical",
          body,
          center,
        }),
    );
    check(
      await admin
        .from("portal_message_recipients")
        .insert(
          audience.map((alias) => ({ message: mid, account: users[alias] })),
        ),
    );
    check(
      await admin
        .from("portal_observations")
        .insert({ request: rid, status: "not_configured" }),
    );
    check(
      await admin
        .from("portal_audit")
        .insert({ actor: users[who], action: "request.seeded", target: rid }),
    );
  }
}
mkdirSync("work", { recursive: true, mode: 0o700 });
writeFileSync(
  "work/supabase-fixtures.json",
  JSON.stringify({ users, patients, requests }, null, 2),
  { mode: 0o600 },
);
console.log(
  "Identidades ficticias aprovisionadas en Supabase Auth, sin correos, SMS ni roles editables desde el cliente.",
);
