// Explicit integration suite: never silently falls back to SQLite or skips hosted checks.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseStore,
  supabaseConfig,
} from "../server/supabase-store.mjs";
import { createPortal } from "../server/http-server.mjs";
export function totp(secret) {
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(count).digest(),
    offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export async function hostedSessions() {
  const fixture = JSON.parse(
    readFileSync(
      process.env.PORTAL_FIXTURES || "work/supabase-hosted-fixtures.json",
    ),
  );
  const config = supabaseConfig(),
    store = createSupabaseStore(config);
  const secretsPath = "work/supabase-test-mfa.json",
    mfa = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath)) : {};
  const sessions = {};
  for (const alias of Object.keys(fixture.users)) {
    const cred = fixture.credentials[alias];
    let result = await store.login(cred.email, cred.password);
    let session = await store.session(result.token);
    if (result.mfaRequired) {
      if (result.enrollmentNeeded) {
        const enrolled = await store.as(session, () => store.enroll());
        mfa[alias] = { factorId: enrolled.factorId, secret: enrolled.secret };
        writeFileSync(secretsPath, JSON.stringify(mfa), { mode: 0o600 });
      }
      if (!mfa[alias])
        throw Error("Falta el autenticador de prueba del perfil " + alias);
      result = await store.as(session, () =>
        store.verify({
          factorId: mfa[alias].factorId,
          code: totp(mfa[alias].secret),
        }),
      );
      session = await store.session(result.token);
    }
    sessions[alias] = { ...session, token: result.token };
  }
  return { fixture, config, store, sessions, mfa };
}
if (process.argv[1]?.endsWith("/supabase.integration.mjs")) {
  const { fixture: f, config, store: s, sessions: a } = await hostedSessions();
  let passed = 0;
  async function test(name, fn) {
    await fn();
    console.log("OK " + ++passed + " " + name);
  }
  const run = (role, fn) => s.as(a[role], fn);
  const denied = async (fn) =>
    assert.rejects(fn, (e) => [401, 403, 404].includes(e.status));
  const sdk = (role) => a[role].client;
  const command = (role, op, b) => sdk(role).rpc("portal_command", { op, b });
  const { server } = createPortal({ store: s });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const http = async (role, path, body) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: "portal_session=" + a[role].token,
        ...(body
          ? {
              "Content-Type": "application/json",
              Origin: origin,
              "X-CSRF-Token": a[role].csrf,
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    await test("Auth real, MFA profesional y perfiles sin metadatos editables", async () => {
      for (const role of ["cenit", "cenepsi", "personal", "doctor"]) {
        assert.equal(a[role].profile.role, role);
        assert.equal(
          JSON.parse(
            Buffer.from(
              a[role].providerSession.access_token.split(".")[1],
              "base64url",
            ),
          ).aal,
          "aal2",
        );
      }
      const cred = f.credentials.cenit,
        lo = await s.login(cred.email, cred.password),
        pending = await s.session(lo.token);
      assert.equal(lo.mfaRequired, true);
      await denied(() => s.as(pending, () => s.bootstrap()));
      const raw = await pending.client.from("portal_requests").select("id");
      assert.deepEqual(raw.data, []);
      assert.ok(
        (
          await sdk("family").auth.updateUser({
            data: { role: "doctor", center: "CENIT" },
          })
        ).data.user,
      );
      assert.equal(
        (await run("family", () => s.bootstrap())).account.role,
        "family",
      );
      assert.ok(
        (
          await sdk("family")
            .from("portal_profiles")
            .update({ role: "doctor" })
            .eq("id", f.users.family)
        ).error,
      );
    });
    await test("RLS por centro y acceso conjunto sin conversaciones clínicas", async () => {
      for (const [role, center, foreign] of [
        ["cenit", "CENIT", "demo-cenepsi"],
        ["cenepsi", "Cenepsi", "demo-cenit"],
      ]) {
        const boot = await run(role, () => s.bootstrap());
        assert.ok(boot.requests.length);
        assert.ok(boot.requests.every((r) => r.center === center));
        await denied(() =>
          run(role, () => s.detail(null, f.requests[foreign])),
        );
        assert.equal(
          (await http(role, "/api/requests/" + f.requests[foreign])).status,
          404,
        );
        assert.deepEqual(
          (
            await sdk(role)
              .from("portal_requests")
              .select("id")
              .eq("id", f.requests[foreign])
          ).data,
          [],
        );
        const result = await command(role, "action", {
          id: f.requests[foreign],
          action: "center",
          center,
        });
        assert.ok(result.error);
      }
      for (const role of ["personal", "doctor"]) {
        const boot = await run(role, () => s.bootstrap());
        assert.ok(boot.requests.some((r) => r.center === "CENIT"));
        assert.ok(boot.requests.some((r) => r.center === "Cenepsi"));
      }
      assert.equal(
        (
          await run("personal", () =>
            s.detail(null, f.requests["demo-clinical"]),
          )
        ).messages.length,
        0,
      );
      assert.ok(
        (await run("doctor", () => s.detail(null, f.requests["demo-clinical"])))
          .messages.length,
      );
      assert.equal(
        (await run("family", () => s.detail(null, f.requests["demo-clinical"])))
          .messages.length,
        0,
      );
      assert.ok(
        (
          await run("adolescent", () =>
            s.detail(null, f.requests["demo-clinical"]),
          )
        ).messages.length,
      );
      await denied(() =>
        run("other", () => s.detail(null, f.requests["demo-cenit"])),
      );
    });
    let created, document, clinicalDoc;
    await test("Guardar solicitud y ampliar hilo sin aceptación médica automática", async () => {
      const response = await http("family", "/api/requests", {
        patient: f.patients.alex,
        center: "CENIT",
        reason: 1,
        description:
          "Coordinación ficticia. Necesito aclarar un trámite de prueba.",
        audience: [f.users.family],
      });
      assert.equal(response.status, 201);
      created = await response.json();
      assert.equal(created.state, "Registrada");
      assert.equal(created.accepted_at, null);
      const updated = await run("family", () =>
        s.message(null, created.id, {
          kind: "clinical",
          body: "Información adicional de prueba.",
          audience: [f.users.family],
        }),
      );
      assert.equal(updated.messages.length, 2);
      assert.equal(
        (await run("cenit", () => s.detail(null, created.id))).messages.length,
        0,
      );
      assert.equal(
        (await http("family", "/api/session")).headers.get("Cache-Control"),
        "no-store, private",
      );
    });
    await test("Storage privado, borrador, aprobación y ticket de un uso", async () => {
      const draft = await run("cenit", () =>
        s.upload(null, created.id, {
          filename: "justificante-demo.pdf",
          mime: "application/pdf",
          clinical: false,
          audience: [f.users.family],
          content: Buffer.from(
            "%PDF-1.4\n% Documento ficticio sin diagnóstico\n%%EOF",
          ).toString("base64"),
        }),
      );
      document = draft.documents.at(-1);
      assert.ok(document?.id);
      assert.equal(
        (await run("family", () => s.detail(null, created.id))).documents
          .length,
        0,
      );
      await denied(() => run("personal", () => s.approve(null, document.id)));
      await denied(() =>
        run("cenepsi", () => s.issueTicket(null, document.id)),
      );
      await run("doctor", () => s.approve(null, document.id));
      const ticket = await run("family", () =>
        s.issueTicket(null, document.id),
      );
      await denied(() => run("other", () => s.download(null, ticket)));
      assert.ok(
        (await run("family", () => s.download(null, ticket))).content
          .subarray(0, 5)
          .toString() === "%PDF-",
      );
      await denied(() => run("family", () => s.download(null, ticket)));
      for (const role of ["cenit", "cenepsi", "personal", "family", "other"]) {
        assert.ok(
          (
            await sdk(role)
              .storage.from("portal-documents")
              .download(document.id + "/file")
          ).error,
        );
        assert.ok(
          (
            await sdk(role)
              .storage.from("portal-documents")
              .createSignedUrl(document.id + "/file", 60)
          ).error,
        );
      }
    });
    await test("Documento clínico solo para doctor y destinatario autorizado", async () => {
      const detail = await run("doctor", () =>
        s.upload(null, f.requests["demo-clinical"], {
          filename: "informe-demo.pdf",
          mime: "application/pdf",
          clinical: true,
          audience: [f.users.adolescent],
          content: Buffer.from("%PDF-1.4\n% Ficticio\n%%EOF").toString(
            "base64",
          ),
        }),
      );
      clinicalDoc = detail.documents.at(-1);
      await run("doctor", () => s.approve(null, clinicalDoc.id));
      assert.ok(
        (
          await run("adolescent", () =>
            s.detail(null, f.requests["demo-clinical"]),
          )
        ).documents.some((d) => d.id === clinicalDoc.id),
      );
      for (const role of [
        "family",
        "limited",
        "cenit",
        "cenepsi",
        "personal",
        "other",
      ])
        await denied(() =>
          run(role, () => s.issueTicket(null, clinicalDoc.id)),
        );
    });
    await test("Revocación inmediata bloquea solicitud y ticket ya emitido", async () => {
      const ticket = await run("family", () =>
        s.issueTicket(null, document.id),
      );
      const boot = await run("personal", () => s.bootstrap());
      const grant = boot.grants.find(
        (g) => g.account === f.users.family && g.patient === f.patients.alex,
      );
      try {
        await run("personal", () => s.revoke(null, grant.id));
        await denied(() => run("family", () => s.detail(null, created.id)));
        await denied(() => run("family", () => s.download(null, ticket)));
        assert.deepEqual(
          (
            await sdk("family")
              .from("portal_requests")
              .select("id")
              .eq("id", created.id)
          ).data,
          [],
        );
      } finally {
        await run("personal", () =>
          s.reviewGrant(null, {
            id: grant.id,
            manage: true,
            submit: true,
            clinical: true,
            evidence: "REVERIFICACION_FICTICIA",
            review_on: "2029-03-12",
          }),
        );
      }
    });
    await test("Cambio de centro no revela conversaciones ni documentos anteriores", async () => {
      await run("cenit", () =>
        s.message(null, created.id, {
          kind: "administrative",
          body: "Gestión administrativa ficticia de CENIT.",
        }),
      );
      await denied(() =>
        run("cenit", () =>
          s.action(null, created.id, {
            action: "center",
            center: "Cenepsi",
            reason: "Prueba",
          }),
        ),
      );
      await run("personal", () =>
        s.action(null, created.id, {
          action: "center",
          center: "Cenepsi",
          reason: "Asignación ficticia revisada",
        }),
      );
      await denied(() => run("cenit", () => s.detail(null, created.id)));
      const detail = await run("cenepsi", () => s.detail(null, created.id));
      assert.equal(detail.messages.length, 0);
      assert.equal(detail.documents.length, 0);
      await denied(() =>
        run("cenepsi", () => s.issueTicket(null, document.id)),
      );
    });
    await test("Fallos de IA y notificaciones conservan solicitudes sin aceptación", async () => {
      await run("doctor", () => s.observe(null, created.id));
      const worker = await run("doctor", () => s.worker(null, "failed"));
      assert.equal(worker.externalMessagesSent, 0);
      const detail = await run("doctor", () => s.detail(null, created.id));
      assert.equal(detail.observation.status, "not_configured");
      assert.equal(detail.accepted_at, null);
      const notifications = await sdk("doctor")
        .from("portal_notifications")
        .select("*");
      for (const n of notifications.data || [])
        assert.ok(!("body" in n) && !("description" in n));
    });
    await test("Validación de adjuntos, CSRF, alta pública y privilegios", async () => {
      await assert.rejects(() =>
        run("doctor", () =>
          s.upload(null, created.id, {
            filename: "x.pdf",
            mime: "application/pdf",
            content: Buffer.from("no PDF").toString("base64"),
          }),
        ),
      );
      const c = createClient(config.url, config.key, {
        auth: { persistSession: false },
      });
      const signup = await c.auth.signUp({
        email: "no-autorizado@example.invalid",
        password: "Una-clave-ficticia-de-43-caracteres!",
      });
      assert.ok(signup.error);
      const response = await fetch(origin + "/api/preferences", {
        method: "POST",
        headers: {
          Cookie: "portal_session=" + a.doctor.token,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      assert.equal(response.status, 403);
      assert.ok((await c.rpc("portal_command", { op: "bootstrap" })).error);
      assert.ok(
        (await sdk("doctor").from("portal_messages").select("body")).error,
      );
      assert.ok(
        (await sdk("doctor").from("portal_documents").select("filename")).error,
      );
      assert.ok(
        (
          await sdk("family")
            .from("portal_audit")
            .insert({ actor: f.users.family, action: "forged" })
        ).error,
      );
    });
    await test("CENIT tampoco obtiene archivos Cenepsi y el ticket exige la misma sesión", async () => {
      const detail = await run("cenepsi", () =>
        s.upload(null, f.requests["demo-cenepsi"], {
          filename: "cenepsi-demo.pdf",
          mime: "application/pdf",
          clinical: false,
          audience: [f.users.family],
          content: Buffer.from(
            "%PDF-1.4\n% Solo datos ficticios\n%%EOF",
          ).toString("base64"),
        }),
      );
      const doc = detail.documents.at(-1);
      await denied(() => run("cenit", () => s.issueTicket(null, doc.id)));
      await run("doctor", () => s.approve(null, doc.id));
      const ticket = await run("family", () => s.issueTicket(null, doc.id));
      const cred = f.credentials.family;
      const fresh = await s.login(cred.email, cred.password),
        session = await s.session(fresh.token);
      await denied(() => s.as(session, () => s.download(null, ticket)));
      assert.ok(
        (await run("family", () => s.download(null, ticket))).content.length,
      );
    });
    await test("Prioridad calculada en PostgreSQL y aceptación médica separada", async () => {
      const detail = await run("family", () =>
        s.create(null, {
          patient: f.patients.alex,
          center: "CENIT",
          reason: 1,
          description:
            "Mensaje ficticio administrativo: no puedo mantenerlo a salvo.",
          audience: [f.users.family],
          priority: 0,
        }),
      );
      assert.equal(detail.priority, 3);
      assert.equal(detail.accepted_at, null);
      assert.equal(detail.rules_approved, false);
      await denied(() =>
        run("cenit", () => s.action(null, detail.id, { action: "accept" })),
      );
      await denied(() =>
        run("personal", () =>
          s.action(null, detail.id, {
            action: "priority",
            priority: 0,
            reason: "Prueba",
          }),
        ),
      );
      assert.equal(
        (await run("doctor", () => s.detail(null, detail.id))).priority,
        3,
      );
    });
    await test("Cerrar sesión invalida el acceso incluso con JWT anterior", async () => {
      const cred = f.credentials.other,
        result = await s.login(cred.email, cred.password),
        session = await s.session(result.token);
      await s.as(session, () => s.logout());
      await assert.rejects(() => s.session(result.token));
    });
    console.log(
      "RESULTADO: " +
        passed +
        " grupos de integración aprobados con Supabase alojado real.",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
