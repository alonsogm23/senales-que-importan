import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { openStore } from "../server/service.mjs";
import { createSharedDemo } from "../server/shared-demo.mjs";
const origin = "https://demo-privada.onrender.com";
const password = "solo-para-test-privado-12345678901234567890";
function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { method: options.method || "GET", headers: options.headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode,
            headers: {
              get: (key) =>
                Array.isArray(res.headers[key])
                  ? res.headers[key].join("; ")
                  : res.headers[key],
            },
            json: async () => JSON.parse(body),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
const expiresAt = () => new Date(Date.now() + 3600000).toISOString();
test("Demo compartida exige origen separado, barrera privada, vencimiento y solo ficticios", (t) => {
  const store = openStore();
  t.after(() => store.db.close());
  const options = { store, origin, password, expiresAt: expiresAt() };
  for (const bad of [
    { origin: "http://demo.test" },
    { origin: "https://drdenisgomez.cl" },
    { password: "corta" },
    { expiresAt: "2000-01-01" },
  ])
    assert.throws(() => createSharedDemo({ ...options, ...bad }));
  store.run(
    "UPDATE accounts SET email='no-permitido@real.test' WHERE id='family'",
  );
  assert.throws(() => createSharedDemo(options), /fictional/);
});
test("Barrera externa protege interfaz, API y archivos; login mantiene CSRF y cookie Secure", async (t) => {
  const store = openStore();
  t.after(() => store.db.close());
  let clock = Date.now();
  const { server } = createSharedDemo({
    store,
    origin,
    password,
    expiresAt: expiresAt(),
    clock: () => clock,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const local = `http://127.0.0.1:${server.address().port}`;
  for (const path of [
    "/portal/",
    "/portal/app.js",
    "/api/public",
    "/api/session",
    "/api/requests/demo-cenit",
    "/api/download/no-access",
  ])
    assert.equal((await fetchHttp(local + path)).status, 401);
  assert.equal((await fetchHttp(local + "/health")).status, 200);
  const headers = {
    Host: new URL(origin).host,
    Authorization:
      "Basic " + Buffer.from("revision:" + password).toString("base64"),
  };
  assert.equal((await fetchHttp(local + "/portal/", { headers })).status, 200);
  assert.equal(
    (await fetchHttp(local + "/api/session", { headers })).status,
    401,
  );
  const login = await fetchHttp(local + "/api/login", {
    method: "POST",
    headers: { ...headers, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "family@example.invalid",
      password: "Familia-Prueba-2026!",
    }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  const { csrf } = await login.json(),
    cookie = login.headers.get("set-cookie").split(";")[0];
  const session = await fetchHttp(local + "/api/session", {
    headers: { ...headers, Cookie: cookie },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).account.role, "family");
  const create = await fetchHttp(local + "/api/requests", {
    method: "POST",
    headers: {
      ...headers,
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({
      patient: "alex",
      center: "CENIT",
      reason: 1,
      description: "Coordinación ficticia de prueba externa.",
      audience: ["family"],
    }),
  });
  assert.equal(create.status, 201);
  assert.equal((await create.json()).accepted_at, null);
  const cross = await fetchHttp(local + "/api/requests", {
    method: "POST",
    headers: {
      ...headers,
      Cookie: cookie,
      Origin: "https://otro.test",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: "{}",
  });
  assert.equal(cross.status, 403);
  clock += 3600001;
  assert.equal((await fetchHttp(local + "/portal/", { headers })).status, 410);
});
