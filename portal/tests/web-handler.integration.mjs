import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWebHandler } from "../server/web-handler.mjs";
import { supabaseConfig } from "../server/supabase-store.mjs";
const config = {
    ...supabaseConfig(),
    csrfSecret: "Fictional-test-csrf-key-for-two-isolated-instances",
  },
  origin = "https://portal-demo.example.invalid";
const f = JSON.parse(readFileSync("work/supabase-hosted-fixtures.json"));
const one = createWebHandler({ config, origin }),
  two = createWebHandler({ config, origin });
const login = await one(
  new Request(origin + "/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(f.credentials.family),
  }),
);
assert.equal(login.status, 200);
const cookie = login.headers.get("Set-Cookie").split(";")[0],
  data = await login.json();
assert.ok(login.headers.get("Set-Cookie").includes("Secure"));
assert.ok(login.headers.get("Set-Cookie").includes("HttpOnly"));
assert.ok(cookie.length < 4096);
const state = await two(
  new Request(origin + "/api/session", { headers: { Cookie: cookie } }),
);
assert.equal(state.status, 200);
assert.equal((await state.json()).csrf, data.csrf);
const mutation = await two(
  new Request(origin + "/api/requests", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": data.csrf,
    },
    body: JSON.stringify({
      patient: f.patients.alex,
      center: "CENIT",
      reason: 1,
      description: "Prueba ficticia del adaptador Web API de Vercel.",
      audience: [f.users.family],
    }),
  }),
);
assert.equal(mutation.status, 201);
assert.equal((await mutation.json()).accepted_at, null);
const forbidden = await two(
  new Request("https://otra-demo.example.invalid/api/session", {
    headers: { Cookie: cookie },
  }),
);
assert.equal(forbidden.status, 403);
assert.equal(
  (await two(new Request(origin + "/api/public"))).headers.get("Cache-Control"),
  "no-store, private",
);
console.log(
  "OK: adaptador Web API, cookie segura, CSRF entre instancias, POST persistido, origen y caché. Vercel real no desplegado.",
);
