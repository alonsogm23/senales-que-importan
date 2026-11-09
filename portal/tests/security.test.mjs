import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore, Fault, totp } from "../server/service.mjs";
import { createPortal } from "../server/server.mjs";
import { coverage, classify, initialRules } from "../public/policy.js";
const suite = (name, fn) =>
  test(name, async (t) => {
    const s = openStore();
    t.after(() => s.db.close());
    await fn(s, t);
  });
const denied = (fn) =>
  assert.throws(fn, (e) => e instanceof Fault && [403, 404].includes(e.status));
const document = {
  filename: "justificante-ficticio.pdf",
  mime: "application/pdf",
  content: Buffer.from("%PDF-1.4\n% Documento ficticio\n%%EOF").toString(
    "base64",
  ),
  audience: ["family"],
};
const request = {
  patient: "alex",
  center: "CENIT",
  reason: 0,
  description: "Justificante de asistencia ficticio",
  purpose: "Justificar asistencia",
  destination: "Colegio de prueba",
  needed: "2026-12-10",
  audience: ["family"],
};

suite(
  "Los dos centros se aíslan en servidor y vistas de base de datos",
  (s) => {
    assert.deepEqual(
      new Set(s.bootstrap("cenit").requests.map((r) => r.center)),
      new Set(["CENIT"]),
    );
    assert.deepEqual(
      new Set(s.bootstrap("cenepsi").requests.map((r) => r.center)),
      new Set(["Cenepsi"]),
    );
    denied(() => s.detail("cenit", "demo-cenepsi"));
    denied(() => s.detail("cenepsi", "demo-cenit"));
    assert.equal(
      s.as("cenit", () =>
        s.all("SELECT * FROM visible_requests WHERE center='Cenepsi'"),
      ).length,
      0,
    );
    assert.equal(
      s.as("cenepsi", () =>
        s.all("SELECT * FROM visible_messages WHERE request='demo-clinical'"),
      ).length,
      0,
    );
    denied(() =>
      s.action("cenit", "demo-cenit", {
        action: "center",
        center: "Cenepsi",
        reason: "Intento",
      }),
    );
    assert.throws(
      () =>
        s.as("cenit", () =>
          s.run("UPDATE requests SET center='Cenepsi' WHERE id='demo-cenit'"),
        ),
      /request_update_denied/,
    );
  },
);
suite(
  "Coordinación ve ambos centros sin recibir conversaciones clínicas; doctor ve todos",
  (s) => {
    assert.equal(s.bootstrap("personal").requests.length, 4);
    assert.equal(s.bootstrap("doctor").requests.length, 4);
    for (const aid of ["cenit", "personal"])
      assert.equal(s.detail(aid, "demo-clinical").messages.length, 0);
    assert.equal(s.detail("doctor", "demo-clinical").messages.length, 1);
    assert.equal(s.detail("family", "demo-clinical").messages.length, 0);
    assert.equal(s.detail("adolescent", "demo-clinical").messages.length, 1);
    denied(() =>
      s.message("personal", "demo-clinical", {
        kind: "clinical",
        body: "No autorizado",
        audience: [],
      }),
    );
  },
);
suite(
  "No se puede elevar el rol desde el usuario ni aprobar documentos como secretaria",
  (s) => {
    assert.throws(
      () =>
        s.as("family", () =>
          s.run("UPDATE accounts SET role='doctor' WHERE id='family'"),
        ),
      /server_provisioning_only/,
    );
    const d = s.upload("cenit", "demo-cenit", document).documents[0];
    denied(() => s.approve("cenit", d.id));
    denied(() => s.approve("personal", d.id));
    assert.throws(
      () =>
        s.as("cenit", () =>
          s.run("UPDATE documents SET approved_by=? WHERE id=?", "cenit", d.id),
        ),
      /doctor_approval_required/,
    );
  },
);
suite(
  "Representantes: paciente, trámites, antecedentes y lectura clínica son permisos distintos",
  (s) => {
    denied(() => s.detail("family", "demo-other"));
    denied(() =>
      s.create("family", { ...request, patient: "leo", center: "Cenepsi" }),
    );
    assert.throws(
      () => s.create("family", { ...request, center: "Otro centro" }),
      (e) => e.status === 400,
    );
    assert.equal(s.bootstrap("limited").requests.length, 0);
    denied(() => s.create("limited", { ...request, audience: [] }));
    const own = s.create("limited", {
      ...request,
      reason: 2,
      since: "Ayer",
      current: "No",
      contact: "Contacto seguro ficticio",
      audience: [],
    });
    assert.equal(s.detail("limited", own.id).messages.length, 1);
    denied(() => s.detail("limited", "demo-cenit"));
    denied(() =>
      s.message("family", "demo-cenit", {
        kind: "clinical",
        body: "Un texto",
        audience: ["other"],
      }),
    );
  },
);
suite(
  "Revocación y revisión al cumplir mayoría de edad bloquean acceso y descargas",
  (s) => {
    const r = s.upload("cenit", "demo-cenit", document);
    const d = r.documents[0];
    s.approve("doctor", d.id);
    const ticket = s.issueTicket("family", d.id, "sesion");
    const gid = s.get(
      "SELECT id FROM grants WHERE account='family' AND patient='alex'",
    ).id;
    s.revoke("personal", gid);
    denied(() => s.detail("family", "demo-cenit"));
    denied(() => s.download("family", ticket, "sesion"));
    s.as("system", () =>
      s.run(
        "UPDATE grants SET review_on='2000-01-01' WHERE account='adolescent'",
      ),
    );
    denied(() => s.detail("adolescent", "demo-clinical"));
    denied(() => s.reviewGrant("cenit", { id: gid }));
  },
);
suite(
  "Documentos privados: borrador, versión, destinatarios, enlaces temporales y centros",
  (s) => {
    const d = s.upload("cenit", "demo-cenit", document).documents[0];
    assert.equal(s.detail("family", "demo-cenit").documents.length, 0);
    denied(() => s.issueTicket("cenepsi", d.id, "x"));
    denied(() => s.issueTicket("family", d.id, "x"));
    s.approve("doctor", d.id);
    assert.equal(s.detail("family", "demo-cenit").documents.length, 1);
    const token = s.issueTicket("family", d.id, "a");
    denied(() => s.download("family", token, "b"));
    assert.ok(s.download("family", token, "a").content.length);
    denied(() => s.download("family", token, "a"));
    const expired = s.issueTicket("family", d.id, "a");
    s.run("UPDATE tickets SET expires=0");
    denied(() => s.download("family", expired, "a"));
    const d2 = s
      .upload("cenit", "demo-cenit", { ...document, previous: d.id })
      .documents.find((d) => d.version === 2);
    assert.ok(d2);
    assert.equal(d2.approved_by, null);
    assert.throws(
      () => s.approve("doctor", d.id),
      (e) => e.status === 409,
    );
    assert.throws(
      () => s.upload("cenit", "demo-cenit", { ...document, mime: "text/html" }),
      (e) => e.status === 400,
    );
    assert.throws(
      () =>
        s.upload("cenit", "demo-cenit", {
          ...document,
          content: Buffer.from("fake PDF").toString("base64"),
        }),
      (e) => e.status === 400,
    );
  },
);
suite(
  "Documentos clínicos no aparecen en coordinación y solo se entregan a destinatarios",
  (s) => {
    const d = s.upload("doctor", "demo-clinical", {
      ...document,
      clinical: true,
      audience: ["adolescent"],
    }).documents[0];
    s.approve("doctor", d.id);
    assert.equal(s.detail("personal", "demo-clinical").documents.length, 0);
    assert.equal(s.detail("cenit", "demo-clinical").documents.length, 0);
    assert.equal(s.detail("family", "demo-clinical").documents.length, 0);
    assert.equal(s.detail("adolescent", "demo-clinical").documents.length, 1);
    denied(() => s.issueTicket("personal", d.id, "x"));
  },
);
suite(
  "Reasignar centro no abre conversaciones administrativas previas ni contenido clínico",
  (s) => {
    s.message("cenit", "demo-cenit", {
      body: "Nota administrativa anterior",
      kind: "administrative",
    });
    const d = s.upload("cenit", "demo-cenit", document).documents[0];
    s.action("personal", "demo-cenit", {
      action: "center",
      center: "Cenepsi",
      reason: "Relación verificada de prueba",
    });
    denied(() => s.detail("cenit", "demo-cenit"));
    const r = s.detail("cenepsi", "demo-cenit");
    assert.equal(r.messages.length, 0);
    assert.equal(r.documents.length, 0);
    denied(() => s.issueTicket("cenepsi", d.id, "x"));
    assert.ok(s.detail("doctor", "demo-cenit").messages.length >= 2);
    assert.ok(s.get("SELECT 1 FROM audit WHERE action='request.center'"));
  },
);
suite(
  "Guardar, avisar y simular entrega nunca equivalen a aceptación médica",
  (s) => {
    const r = s.create("family", request);
    assert.equal(r.accepted_by, null);
    s.worker("doctor", "delivered");
    assert.equal(s.detail("doctor", r.id).accepted_at, null);
    s.action("cenit", r.id, { action: "assign", assigned: "doctor" });
    assert.equal(s.detail("doctor", r.id).accepted_by, null);
    assert.throws(
      () => s.action("cenit", r.id, { action: "accept" }),
      (e) => e.status === 409,
    );
    s.action("doctor", r.id, { action: "accept" });
    assert.equal(s.detail("doctor", r.id).accepted_by, "doctor");
    assert.ok(
      s.get(
        "SELECT 1 FROM audit WHERE action='request.accept' AND target=?",
        r.id,
      ),
    );
  },
);
suite(
  "Prioridad independiente del motivo, reglas versionadas y alerta determinista sin IA",
  (s) => {
    assert.equal(
      classify("Necesito certificado. No puedo mantenerlo a salvo.", 0),
      3,
    );
    assert.equal(classify("No kiero vivir", 1), 2);
    const r = s.create("family", {
      ...request,
      description: "Trámite urgente. No puedo mantenerlo a salvo.",
    });
    assert.equal(r.priority, 3);
    s.message("family", r.id, {
      body: "Añado información",
      kind: "clinical",
      audience: ["family"],
    });
    assert.equal(s.detail("doctor", r.id).priority, 3);
    denied(() =>
      s.updateRules("personal", { config: initialRules, reason: "Intento" }),
    );
    s.updateRules("doctor", {
      config: { ...initialRules, version: "ilustrativa-test" },
      reason: "Evaluación ficticia",
    });
    assert.equal(s.rules().version, "ilustrativa-test");
    assert.equal(s.all("SELECT * FROM rule_versions").length, 2);
    assert.equal(s.detail("doctor", r.id).rules_version, "ilustrativa-1");
  },
);
suite(
  "IA ausente, fallida o con propuesta insegura no pierde solicitudes ni cambia prioridad",
  async (s) => {
    const r = s.create("family", request);
    await s.observe("doctor", r.id);
    assert.equal(
      s.get("SELECT status FROM observations WHERE request=?", r.id).status,
      "not_configured",
    );
    await s.observe("doctor", r.id, async () => {
      throw Error("sensitive simulated error");
    });
    assert.equal(
      s.get("SELECT status FROM observations WHERE request=?", r.id).status,
      "failed",
    );
    await s.observe("doctor", r.id, async () => ({
      summary: "Resumen ficticio",
      fragments: ["Justificante"],
      missing: [],
      suggestedPriority: 2,
    }));
    assert.equal(
      s.get("SELECT status FROM observations WHERE request=?", r.id).status,
      "observation_only",
    );
    assert.equal(s.detail("doctor", r.id).priority, 0);
    await s.observe("doctor", r.id, async () => ({
      summary: "Resumen",
      fragments: ["Texto inventado"],
      missing: [],
      suggestedPriority: 0,
    }));
    assert.equal(
      s.get("SELECT status FROM observations WHERE request=?", r.id).status,
      "failed",
    );
    assert.ok(
      s.detail("doctor", r.id).messages[0].body.includes("Justificante"),
    );
  },
);
suite(
  "Fallo de alertas, ausencia y escalamiento sin respaldo conservan pendientes",
  (s) => {
    const r = s.create("family", {
      ...request,
      description: "peligro inmediato",
    });
    s.updateSettings("doctor", { absence: { enabled: true, until: null } });
    s.worker("doctor", "failed");
    assert.ok(
      s
        .all(
          "SELECT * FROM notifications WHERE account='doctor' AND channel<>'internal'",
        )
        .every((n) => n.status === "held_coverage"),
    );
    assert.equal(s.cover().nextStart, null);
    assert.equal(s.detail("doctor", r.id).accepted_by, null);
    s.updateSettings("doctor", {
      delivery: {
        retryMinutes: 1,
        maxAttempts: 2,
        escalateMinutes: 1,
        backup: null,
      },
    });
    assert.throws(
      () =>
        s.updateSettings("doctor", {
          delivery: {
            retryMinutes: 1,
            maxAttempts: 2,
            escalateMinutes: 1,
            backup: "inventado",
          },
        }),
      (e) => e.status === 400,
    );
    assert.equal(s.detail("doctor", r.id).state, "Registrada");
  },
);
suite(
  "Cuentas personales, MFA profesional obligatorio, no reutilizable y sesiones vigentes",
  (s) => {
    assert.throws(
      () => s.login("cenit@example.invalid", "Cenit-Prueba-2026!"),
      (e) => e.status === 401,
    );
    const secret = s.get("SELECT totp FROM accounts WHERE id='cenit'").totp,
      code = totp(secret);
    const login = s.login("cenit@example.invalid", "Cenit-Prueba-2026!", code);
    assert.equal(s.session(login.token).mfa, 1);
    assert.throws(
      () => s.login("cenit@example.invalid", "Cenit-Prueba-2026!", code),
      (e) => e.status === 401,
    );
    s.run(
      "UPDATE accounts SET session_version=session_version+1 WHERE id='cenit'",
    );
    assert.throws(
      () => s.session(login.token),
      (e) => e.status === 401,
    );
  },
);
suite(
  "Auditoría inmutable y ausencia de contenido clínico en avisos y metadatos de gestión",
  (s) => {
    const body = "MARCADOR_CLINICO_ABC123";
    const r = s.create("family", { ...request, description: body });
    assert.ok(!JSON.stringify(s.bootstrap("cenit")).includes(body));
    assert.ok(!JSON.stringify(s.detail("personal", r.id)).includes(body));
    assert.ok(
      !JSON.stringify(s.all("SELECT * FROM notifications")).includes(body),
    );
    assert.ok(!JSON.stringify(s.all("SELECT * FROM audit")).includes(body));
    assert.throws(() => s.run("DELETE FROM audit"), /append_only/);
    assert.throws(
      () => s.run("UPDATE audit SET detail='otra cosa'"),
      /append_only/,
    );
  },
);

test("Cobertura en límites de jornada y fin de semana de Santiago", () => {
  for (const [instant, active] of [
    ["2026-11-09T10:59:00Z", false],
    ["2026-11-09T11:00:00Z", true],
    ["2026-11-09T22:59:59Z", true],
    ["2026-11-09T23:00:00Z", false],
    ["2026-11-07T15:59:59Z", true],
    ["2026-11-07T16:00:00Z", false],
    ["2026-11-08T16:00:00Z", false],
  ])
    assert.equal(coverage(new Date(instant)).active, active, instant);
  assert.equal(
    coverage(new Date("2026-11-07T16:00:00Z")).nextStart,
    "2026-11-08T11:00:00.000Z",
  );
});
test("Cambios de hora de Chile: retorno a invierno y salto de primavera", () => {
  for (const instant of [
    "2026-04-05T02:59:00Z",
    "2026-04-05T03:00:00Z",
    "2026-04-05T03:30:00Z",
  ])
    assert.equal(
      coverage(new Date(instant)).nextStart,
      "2026-04-05T12:00:00.000Z",
    );
  for (const instant of ["2026-09-06T03:59:00Z", "2026-09-06T04:00:00Z"])
    assert.equal(
      coverage(new Date(instant)).nextStart,
      "2026-09-06T11:00:00.000Z",
    );
  assert.equal(coverage(new Date("2026-04-06T11:59:00Z")).active, false);
  assert.equal(coverage(new Date("2026-04-06T12:00:00Z")).active, true);
});

suite(
  "API HTTP: centro, URL, adjuntos, CSRF, escalamiento y caché",
  async (s, t) => {
    const { server } = createPortal({ store: s });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => new Promise((r) => server.close(r)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "cenit@example.invalid",
        password: "Cenit-Prueba-2026!",
        code: totp(s.get("SELECT totp FROM accounts WHERE id='cenit'").totp),
        role: "doctor",
      }),
    });
    assert.equal(login.status, 200);
    const { csrf } = await login.json(),
      cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    };
    for (const path of [
      "/api/requests/demo-cenepsi",
      "/api/requests/demo-other",
      "/portal/server/service.mjs",
      "/portal/data/demo.sqlite",
      "/portal/../server/schema.sql",
    ])
      assert.equal((await fetch(origin + path, { headers })).status, 404, path);
    const cross = await fetch(origin + "/api/requests/demo-cenepsi/actions", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "accept" }),
    });
    assert.equal(cross.status, 404);
    const noCsrf = await fetch(origin + "/api/requests/demo-cenit/actions", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "accept" }),
    });
    assert.equal(noCsrf.status, 403);
    const role = await fetch(origin + "/api/accounts/role", {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "doctor" }),
    });
    assert.equal(role.status, 404);
    const otherOrigin = await fetch(origin + "/api/requests", {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.invalid" },
      body: "{}",
    });
    assert.equal(otherOrigin.status, 403);
    const session = await fetch(origin + "/api/session", { headers });
    assert.equal((await session.json()).account.role, "cenit");
    assert.equal(session.headers.get("cache-control"), "no-store, private");
    assert.ok(
      session.headers
        .get("content-security-policy")
        .includes("connect-src 'self'"),
    );
    const pub = await fetch(origin + "/api/public");
    assert.equal(pub.status, 200);
    assert.ok(
      (await pub.json()).emergency.includes("No esperes una respuesta"),
    );
    const clinicalDoc = s.upload("doctor", "demo-cenepsi", {
      ...document,
      clinical: false,
      audience: ["family"],
    }).documents[0];
    const file = await fetch(
      origin + `/api/documents/${clinicalDoc.id}/ticket`,
      { method: "POST", headers, body: "{}" },
    );
    assert.equal(file.status, 404);
  },
);

suite(
  "Respaldo y restauración consistente incluyen adjuntos y permisos",
  async (s, t) => {
    const { backup } = await import("node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const folder = mkdtempSync(join(tmpdir(), "portal-backup-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const doc = s.upload("cenit", "demo-cenit", document).documents[0];
    s.approve("doctor", doc.id);
    const path = join(folder, "restored.sqlite");
    await backup(s.db, path);
    const restored = openStore(path);
    t.after(() => restored.db.close());
    assert.equal(restored.get("PRAGMA integrity_check").integrity_check, "ok");
    assert.equal(
      restored.get("SELECT count(*) n FROM requests").n,
      s.get("SELECT count(*) n FROM requests").n,
    );
    assert.deepEqual(
      Buffer.from(
        restored.get("SELECT content FROM documents WHERE id=?", doc.id)
          .content,
      ),
      Buffer.from(document.content, "base64"),
    );
    denied(() => restored.detail("cenepsi", "demo-cenit"));
    assert.equal(restored.detail("family", "demo-cenit").documents.length, 1);
  },
);
test("Casos de observación de IA conservan límites y no se presentan como validación clínica", async () => {
  const { cases, evaluateObserver } = await import("../server/evaluate.mjs");
  const report = await evaluateObserver();
  assert.equal(report.clinicalAccuracyAssessed, false);
  assert.equal(report.results.length, 8);
  assert.ok(report.results.every((r) => r.observerStatus === "not_configured"));
  for (const c of cases)
    assert.equal(classify(c.text, c.reason), c.illustrativeRulePriority, c.id);
  const failed = await evaluateObserver(async () => {
    throw Error("provider unavailable");
  });
  assert.ok(failed.results.every((r) => r.observerStatus === "failed"));
});
test("Ausencia con retorno durante jornada y a largo plazo usa apertura real sin offsets fijos", () => {
  assert.equal(
    coverage(new Date("2026-11-09T12:00:00Z"), {
      enabled: true,
      until: "2026-11-09T16:30:00Z",
    }).nextStart,
    "2026-11-09T16:30:00.000Z",
  );
  assert.equal(
    coverage(new Date("2026-11-09T12:00:00Z"), {
      enabled: true,
      until: "2028-11-09T02:00:00Z",
    }).nextStart,
    "2028-11-09T11:00:00.000Z",
  );
});
suite(
  "Servidor provisiona varias secretarias individuales y bloquea inserción de rol desde SQL de usuario",
  (s) => {
    assert.throws(
      () =>
        s.as("family", () =>
          s.provision({
            email: "x@example.invalid",
            name: "X Demo",
            role: "doctor",
            password: "Prueba",
          }),
        ),
      /server_provisioning_only/,
    );
    const second = s.as("system", () =>
      s.provision({
        email: "otra@example.invalid",
        name: "Otra Secretaria Demo",
        role: "cenit",
        password: "Prueba-Otra-2026!",
      }),
    );
    assert.equal(s.account(second).role, "cenit");
    assert.equal(s.bootstrap(second).requests.length, 2);
  },
);

suite('Gestionar trámites no concede permiso de enviar consultas clínicas nuevas', s => {
 s.as('system',()=>s.run("UPDATE grants SET submit=0,clinical=0 WHERE account='family' AND patient='alex'"));
 const r=s.create('family',{...request,audience:[]});assert.equal(r.reason,0);
 s.message('family',r.id,{kind:'clinical',body:'Aclaro el destinatario administrativo.',audience:[]});
 denied(()=>s.create('family',{...request,reason:2,since:'Ayer',current:'No',contact:'Contacto de prueba',audience:[]}));
});
suite('Reintentos y escalamiento manual respetan configuración y no aceptan la solicitud', (s,t) => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-09T12:00:00Z')});
 s.updateSettings('doctor',{delivery:{retryMinutes:1,maxAttempts:2,escalateMinutes:1,backup:null}});
 const r=s.create('family',{...request,description:'No puedo mantenerlo a salvo.'});
 s.worker('doctor','failed');
 let job=s.get("SELECT * FROM notifications WHERE request=? AND account='doctor' AND channel='secondary-test'",r.id);
 assert.equal(job.status,'failed_test');assert.equal(job.attempts,1);
 s.worker('doctor','delivered');assert.equal(s.get('SELECT attempts FROM notifications WHERE id=?',job.id).attempts,1);
 t.mock.timers.tick(60001);s.worker('doctor','delivered');
 job=s.get('SELECT * FROM notifications WHERE id=?',job.id);assert.equal(job.status,'provider_reported_test');assert.equal(job.attempts,2);
 assert.equal(s.detail('doctor',r.id).accepted_at,null);
 assert.equal(s.get("SELECT status FROM notifications WHERE request=? AND account='doctor' AND channel='internal'",r.id).status,'needs_manual_escalation');
 assert.equal(s.get('SELECT count(*) n FROM requests WHERE id=?',r.id).n,1);
});
