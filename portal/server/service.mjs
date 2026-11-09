import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { deliverTest } from "./adapters.mjs";
import {
  reasons,
  states,
  initialRules,
  classify,
  coverage,
} from "../public/policy.js";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
const id = () => randomUUID();
import {Fault,fail,text} from "./errors.mjs";
export {Fault,fail,text} from "./errors.mjs";
export function totp(secret, instant = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(instant / 30000)));
  const digest = createHmac("sha1", Buffer.from(secret, "hex"))
    .update(counter)
    .digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
export function openStore(path = ":memory:") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  const ctx = new AsyncLocalStorage();
  db.function("current_actor", () => ctx.getStore() || "anonymous");
  db.function("santiago_today", () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const as = (actor, fn) => ctx.run(actor, fn);
  const audit = (actor, action, target, detail = {}) =>
    run(
      "INSERT INTO audit(actor,action,target,at,detail) VALUES(?,?,?,?,?)",
      actor,
      action,
      target,
      now(),
      JSON.stringify(detail),
    );
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const account = (actor) =>
    get(
      "SELECT id,name,email,role FROM accounts WHERE id=? AND active=1",
      actor,
    ) || fail(401, "La sesión ya no está vigente.");
  const req = (actor, rid) => {
    const r = as(actor, () =>
      get("SELECT * FROM visible_requests WHERE id=?", rid),
    );
    if (!r) {
      audit(actor, "request.denied", rid);
      fail(404, "Solicitud no disponible.");
    }
    return r;
  };
  const grant = (actor, patient) =>
    get(
      "SELECT * FROM active_grants WHERE account=? AND patient=?",
      actor,
      patient,
    );
  const professional = (actor) => {
    const a = account(actor);
    if (a.role === "family") fail();
    return a;
  };
  const doctor = (actor) => {
    if (account(actor).role !== "doctor") fail();
  };
  const coordinator = (actor) => {
    if (!["doctor", "personal"].includes(account(actor).role)) fail();
  };
  const setting = (key) =>
    JSON.parse(get("SELECT value FROM settings WHERE key=?", key).value);
  const rules = () =>
    JSON.parse(
      get("SELECT config FROM rule_versions WHERE version=?", setting("rules"))
        .config,
    );
  const cover = () => coverage(new Date(), setting("absence"));
  function provision({ id: aid = id(), email, name, role, password }) {
    if (!["family", "cenit", "cenepsi", "personal", "doctor"].includes(role))
      fail(400);
    const salt = randomBytes(16).toString("hex");
    run(
      "INSERT INTO accounts(id,email,name,role,password,salt,totp) VALUES(?,?,?,?,?,?,?)",
      aid,
      email,
      name,
      role,
      scryptSync(password, salt, 64).toString("hex"),
      salt,
      role === "family" ? null : randomBytes(20).toString("hex"),
    );
    audit("system", "account.provisioned", aid, { role });
    return aid;
  }
  function seed() {
    if (get("SELECT id FROM accounts LIMIT 1")) return;
    transaction(() => {
      for (const [aid, name, role, pw] of [
        ["family", "Elena Prueba", "family", "Familia-Prueba-2026!"],
        ["adolescent", "Alex Prueba", "family", "Alex-Prueba-2026!"],
        ["limited", "Tomás Prueba", "family", "Tomas-Prueba-2026!"],
        ["other", "Lucía Prueba", "family", "Lucia-Prueba-2026!"],
        ["cenit", "Carolina Demo · CENIT", "cenit", "Cenit-Prueba-2026!"],
        ["cenepsi", "Paula Demo · Cenepsi", "cenepsi", "Cenepsi-Prueba-2026!"],
        [
          "personal",
          "Isabel Demo · Coordinación",
          "personal",
          "Personal-Prueba-2026!",
        ],
        [
          "doctor",
          "Dr. Gómez · cuenta de prueba",
          "doctor",
          "Doctor-Prueba-2026!",
        ],
      ])
        provision({
          id: aid,
          email: `${aid}@example.invalid`,
          name,
          role,
          password: pw,
        });
      for (const [pid, name, birth] of [
        ["alex", "Alex Prueba", "2011-03-12"],
        ["sol", "Sol Prueba", "2016-07-18"],
        ["leo", "Leo Prueba", "2013-05-01"],
      ])
        run("INSERT INTO patients VALUES(?,?,?)", pid, name, birth);
      for (const [pid, center] of [
        ["alex", "CENIT"],
        ["alex", "Cenepsi"],
        ["sol", "Cenepsi"],
        ["leo", "Cenepsi"],
      ])
        run("INSERT INTO enrollments VALUES(?,?)", pid, center);
      for (const [aid, pid, m, s, c, review] of [
        ["family", "alex", 1, 1, 1, "2029-03-12"],
        ["family", "sol", 1, 1, 0, "2034-07-18"],
        ["adolescent", "alex", 1, 1, 1, null],
        ["limited", "alex", 0, 1, 0, "2029-03-12"],
        ["other", "leo", 1, 1, 1, "2031-05-01"],
      ])
        run(
          "INSERT INTO grants VALUES(?,?,?,?,?,?,?,?,?,NULL)",
          id(),
          aid,
          pid,
          m,
          s,
          c,
          "personal",
          "VERIFICACIÓN FICTICIA",
          review,
        );
      for (const [key, value] of Object.entries({
        absence: { enabled: false, until: null },
        rules: initialRules.version,
        delivery: {
          retryMinutes: null,
          maxAttempts: 3,
          escalateMinutes: null,
          backup: null,
        },
      }))
        run("INSERT INTO settings VALUES(?,?)", key, JSON.stringify(value));
      run(
        "INSERT INTO rule_versions VALUES(?,?,?,?,?)",
        initialRules.version,
        JSON.stringify(initialRules),
        now(),
        "system",
        "Semilla ilustrativa de prueba",
      );
      for (const [rid, pid, aid, center, reason, priority, body, audience] of [
        [
          "demo-cenit",
          "alex",
          "family",
          "CENIT",
          0,
          0,
          "Necesito un justificante de asistencia para el colegio. Finalidad: asistencia, sin diagnóstico. Destinatario: colegio ficticio. Fecha: 2026-12-01.",
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
          "Quisiera coordinar una hora de control.",
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
        const at = now();
        run(
          "INSERT INTO requests(id,patient,requester,center,reason,state,priority,rules_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          rid,
          pid,
          aid,
          center,
          reason,
          "Registrada",
          priority,
          initialRules.version,
          at,
          at,
        );
        run(
          "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
          id(),
          rid,
          aid,
          "clinical",
          body,
          center,
          at,
          JSON.stringify(audience),
        );
        run(
          "INSERT INTO observations VALUES(?,?,?)",
          rid,
          "not_configured",
          null,
        );
        audit("system", "request.seeded", rid);
        queue(rid);
      }
    });
  }
  function queue(rid) {
    const r = get("SELECT * FROM requests WHERE id=?", rid);
    const accounts = all("SELECT id,role FROM accounts WHERE active=1");
    const insert = (aid, channel, status) =>
      run(
        "INSERT OR IGNORE INTO notifications(id,request,account,channel,event,status,created_at) VALUES(?,?,?,?,?,?,?)",
        id(),
        rid,
        aid,
        channel,
        r.updated_at,
        status,
        now(),
      );
    insert(r.requester, "internal", "available");
    for (const a of accounts) {
      const allowed =
        a.role === "personal" ||
        a.role === "doctor" ||
        (a.role === "cenit" && r.center === "CENIT") ||
        (a.role === "cenepsi" && r.center === "Cenepsi");
      const prefs = get(
        "SELECT priorities FROM preferences WHERE account=?",
        a.id,
      );
      if (
        !allowed ||
        (prefs && !JSON.parse(prefs.priorities).includes(r.priority))
      )
        continue;
      insert(a.id, "internal", "available");
      if (a.role !== "doctor" || r.priority >= 2) {
        const status =
          a.role === "doctor" && !cover().active
            ? "held_coverage"
            : "queued_test";
        insert(a.id, "email-test", status);
        if (a.role === "doctor" && r.priority >= 2)
          insert(a.id, "secondary-test", status);
      }
    }
  }
  function recipients(actor, r, audience, clinical = true) {
    if (!Array.isArray(audience) || audience.length > 20)
      fail(400, "Selecciona destinatarios autorizados.");
    const result = [...new Set(audience)];
    for (const aid of result) {
      const g = grant(aid, r.patient);
      if (!g || !(clinical ? g.clinical : g.manage))
        fail(403, "Un destinatario no tiene autorización vigente.");
    }
    if (
      account(actor).role === "family" &&
      result.some((a) => a !== actor) &&
      !grant(actor, r.patient)?.clinical
    )
      fail();
    return JSON.stringify(result);
  }
  function detail(actor, rid) {
    const r = req(actor, rid),
      a = account(actor);
    const messages = as(actor, () =>
      all(
        "SELECT m.id,m.author,a.name AS author_name,a.role AS author_role,m.kind,m.body,m.created_at,m.audience FROM visible_messages m JOIN accounts a ON a.id=m.author WHERE m.request=? ORDER BY m.created_at,m.id",
        rid,
      ),
    );
    const documents = as(actor, () =>
      all(
        "SELECT id,series,version,clinical,filename,mime,approved_by,approved_at,created_at,audience FROM visible_documents WHERE request=? ORDER BY created_at",
        rid,
      ),
    );
    audit(actor, "request.read", rid);
    return {
      ...r,
      patient_name: get("SELECT name FROM patients WHERE id=?", r.patient).name,
      messages,
      documents,
      administrativeRecipients: all(
        "SELECT g.account,a.name FROM active_grants g JOIN accounts a ON a.id=g.account WHERE g.patient=? AND g.manage=1",
        r.patient,
      ),
      recipients:
        a.role === "doctor" ||
        (a.role === "family" && grant(actor, r.patient)?.clinical)
          ? all(
              "SELECT g.account,a.name,g.manage,g.submit,g.clinical FROM active_grants g JOIN accounts a ON a.id=g.account WHERE g.patient=?",
              r.patient,
            )
          : [],
      timeline: all(
        "SELECT actor,action,at,detail FROM audit WHERE target=? AND action NOT IN ('request.read','document.download') ORDER BY seq",
        rid,
      ).map((e) => (a.role === "doctor" ? e : { action: e.action, at: e.at })),
      notifications: all(
        "SELECT channel,status,attempts,delivered_at FROM notifications WHERE request=? AND account=?",
        rid,
        actor,
      ),
      observation:
        a.role === "doctor"
          ? get("SELECT status,payload FROM observations WHERE request=?", rid)
          : undefined,
      permissions: {
        clinical:
          a.role === "doctor" ||
          (a.role === "family" && !!grant(actor, r.patient)?.clinical),
        professional: a.role !== "family",
        doctor: a.role === "doctor",
      },
      rules_approved: rules().approved,
    };
  }
  function bootstrap(actor) {
    const a = account(actor);
    const patients =
      a.role === "family"
        ? all(
            "SELECT p.*,g.manage,g.submit,g.clinical,g.review_on FROM patients p JOIN active_grants g ON g.patient=p.id WHERE g.account=?",
            actor,
          )
        : [];
    for (const p of patients) {
      p.centers = all(
        "SELECT center FROM enrollments WHERE patient=?",
        p.id,
      ).map((c) => c.center);
      p.recipients = p.clinical
        ? all(
            "SELECT g.account,a.name FROM active_grants g JOIN accounts a ON a.id=g.account WHERE g.patient=? AND g.clinical=1",
            p.id,
          )
        : [];
    }
    const requests = as(actor, () =>
      all(
        "SELECT r.*,p.name patient_name FROM visible_requests r JOIN patients p ON p.id=r.patient ORDER BY r.updated_at DESC",
      ),
    );
    const notices = as(actor, () =>
      all(
        "SELECT n.id,n.request,n.channel,n.status,n.created_at FROM notifications n WHERE n.account=? AND EXISTS(SELECT 1 FROM visible_requests r WHERE r.id=n.request) ORDER BY n.created_at DESC",
        actor,
      ),
    );
    return {
      account: a,
      patients,
      requests,
      coverage: cover(),
      rules: rules(),
      notices,
      staff:
        a.role === "family"
          ? []
          : all(
              "SELECT id,name,role FROM accounts WHERE active=1 AND role<>'family'",
            ).filter(
              (s) =>
                a.role === "doctor" ||
                a.role === "personal" ||
                s.role === a.role ||
                ["doctor", "personal"].includes(s.role),
            ),
      settings:
        a.role === "doctor"
          ? { absence: setting("absence"), delivery: setting("delivery") }
          : undefined,
      grants: ["doctor", "personal"].includes(a.role)
        ? all(
            "SELECT g.*,p.name patient_name,a.name account_name FROM grants g JOIN patients p ON p.id=g.patient JOIN accounts a ON a.id=g.account",
          )
        : [],
      preferences: JSON.parse(
        get("SELECT priorities FROM preferences WHERE account=?", actor)
          ?.priorities || "[0,1,2,3]",
      ),
    };
  }
  function create(actor, b) {
    const a = account(actor);
    if (a.role !== "family") fail();
    const reason = Number(b.reason);
    if (!Number.isInteger(reason) || !reasons[reason]) fail(400);
    const g = grant(actor, b.patient);
    if (!g || !([0, 1].includes(reason) ? g.manage : g.submit)) fail();
    const center = b.center || null;
    if (
      center &&
      !get(
        "SELECT 1 FROM enrollments WHERE patient=? AND center=?",
        b.patient,
        center,
      )
    )
      fail(400, "El centro debe corresponder a una relación verificada.");
    const description = text(b.description);
    const fields =
      reason === 0
        ? `Finalidad: ${text(b.purpose, 300)}\nDestinatario del documento: ${text(b.destination, 300)}\nSe necesita: ${text(b.needed, 10)}`
        : [2, 3].includes(reason)
          ? `Desde cuándo: ${text(b.since, 300)}\nOcurre actualmente: ${text(b.current, 50)}\nContacto seguro: ${text(b.contact, 300)}`
          : "";
    if (reason === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(b.needed)) fail(400);
    const body = [description, fields].filter(Boolean).join("\n");
    const rule = rules(),
      priority = classify(body, reason, rule),
      rid = id(),
      at = now();
    const aud = recipients(
      actor,
      { patient: b.patient },
      b.audience || [],
      true,
    );
    transaction(() => {
      run(
        "INSERT INTO requests(id,patient,requester,center,reason,state,priority,rules_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        rid,
        b.patient,
        actor,
        center,
        reason,
        center ? "Registrada" : "Pendiente de asignación",
        priority,
        rule.version,
        at,
        at,
      );
      run(
        "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
        id(),
        rid,
        actor,
        "clinical",
        body,
        center,
        at,
        aud,
      );
      run("INSERT INTO observations VALUES(?,?,NULL)", rid, "not_configured");
      audit(actor, "request.saved", rid, { priority, version: rule.version });
      queue(rid);
    });
    return detail(actor, rid);
  }
  function message(actor, rid, b) {
    const r = req(actor, rid),
      a = account(actor),
      body = text(b.body);
    if (r.state === "Cerrada") fail(409, "La solicitud está cerrada.");
    if (a.role === "family") {
      const g = grant(actor, r.patient);
      if (!g || !(g.submit || ([0, 1].includes(r.reason) && g.manage))) fail();
    }
    const kind = b.kind;
    if (!["clinical", "administrative"].includes(kind)) fail(400);
    if (kind === "clinical" && !["doctor", "family"].includes(a.role)) fail();
    if (kind === "administrative" && classify(body, 0, rules()) >= 2)
      fail(
        400,
        "Este texto requiere un canal clínico restringido. Deriva al doctor.",
      );
    if (kind === "administrative" && a.role === "family")
      fail(
        400,
        "Los antecedentes de la familia se envían al doctor para proteger su privacidad.",
      );
    const aud =
      kind === "clinical" ? recipients(actor, r, b.audience || [], true) : "[]";
    transaction(() => {
      run(
        "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
        id(),
        rid,
        actor,
        kind,
        body,
        r.center,
        now(),
        aud,
      );
      // All family text is scanned, regardless of selected reason. Rules can only elevate here.
      const priority =
        a.role === "family"
          ? Math.max(r.priority, classify(body, r.reason, rules()))
          : r.priority;
      run(
        "UPDATE requests SET updated_at=?,priority=?,rules_version=? WHERE id=?",
        now(),
        priority,
        rules().version,
        rid,
      );
      audit(actor, "message.added", rid, { kind });
      queue(rid);
    });
    return detail(actor, rid);
  }
  function action(actor, rid, b) {
    const r = req(actor, rid),
      a = professional(actor);
    transaction(() => {
      if (b.action === "accept") {
        if (r.accepted_by === actor) fail(409, "Ya aceptaste esta solicitud.");
        if (r.assigned && r.assigned !== actor)
          fail(409, "La derivación está asignada a otra persona.");
        if (
          (r.priority >= 2 || r.state.includes("médica")) &&
          a.role !== "doctor"
        )
          fail();
        run(
          "UPDATE requests SET accepted_by=?,accepted_at=?,assigned=?,state=? WHERE id=?",
          actor,
          now(),
          actor,
          a.role === "doctor"
            ? "En revisión médica"
            : "En revisión administrativa",
          rid,
        );
      } else if (b.action === "assign") {
        const target = professional(b.assigned);
        if (
          !["doctor", "personal"].includes(a.role) &&
          ![a.role, "doctor", "personal"].includes(target.role)
        )
          fail();
        if (
          (target.role === "cenit" && r.center !== "CENIT") ||
          (target.role === "cenepsi" && r.center !== "Cenepsi")
        )
          fail();
        run(
          "UPDATE requests SET assigned=?,accepted_by=NULL,accepted_at=NULL,state=? WHERE id=?",
          target.id,
          target.role === "doctor"
            ? "Pendiente de revisión médica"
            : "Asignada",
          rid,
        );
      } else if (b.action === "state") {
        if (!states.includes(b.state)) fail(400);
        if (
          ["En revisión médica", "Respondida", "Cerrada"].includes(b.state) &&
          a.role !== "doctor"
        )
          fail();
        if (b.state === "En revisión médica" && r.accepted_by !== actor)
          fail(409, "Primero acepta explícitamente la solicitud.");
        run("UPDATE requests SET state=? WHERE id=?", b.state, rid);
      } else if (b.action === "priority") {
        doctor(actor);
        text(b.reason, 500);
        if (![0, 1, 2, 3].includes(b.priority)) fail(400);
        run("UPDATE requests SET priority=? WHERE id=?", b.priority, rid);
        // Reasons are kept clinical, not leaked into shared audit metadata.
        run(
          "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
          id(),
          rid,
          actor,
          "clinical",
          `Cambio de prioridad: ${b.reason}`,
          r.center,
          now(),
          "[]",
        );
      } else if (b.action === "center") {
        coordinator(actor);
        if (
          !get(
            "SELECT 1 FROM enrollments WHERE patient=? AND center=?",
            r.patient,
            b.center,
          )
        )
          fail(400);
        text(b.reason, 500);
        run(
          "UPDATE requests SET center=?,assigned=NULL,accepted_by=NULL,accepted_at=NULL,state=? WHERE id=?",
          b.center,
          "Pendiente de asignación",
          rid,
        );
        // Old center's delivery jobs must not survive a reassignment.
        run(
          "UPDATE notifications SET status='cancelled_access' WHERE request=? AND status IN ('queued_test','held_coverage','failed_test') AND account IN(SELECT id FROM accounts WHERE role IN('cenit','cenepsi'))",
          rid,
        );
      } else if (b.action === "record") {
        doctor(actor);
        run("UPDATE requests SET recorded_at=? WHERE id=?", now(), rid);
      } else if (b.action === "due") {
        if (
          b.due &&
          (!Number.isFinite(Date.parse(b.due)) ||
            Date.parse(b.due) < Date.now())
        )
          fail(400, "Indica un plazo futuro.");
        run("UPDATE requests SET due_at=? WHERE id=?", b.due || null, rid);
      } else fail(400);
      run("UPDATE requests SET updated_at=? WHERE id=?", now(), rid);
      audit(actor, `request.${b.action}`, rid, {
        ...(b.action === "center"
          ? { from: r.center, to: b.center, reason: b.reason }
          : {}),
        ...(b.action === "priority"
          ? { from: r.priority, to: b.priority }
          : {}),
        ...(b.action === "state" ? { state: b.state } : {}),
        ...(b.action === "assign" ? { to: b.assigned } : {}),
      });
      queue(rid);
    });
    return detail(actor, rid);
  }
  function upload(actor, rid, b) {
    const r = req(actor, rid),
      a = professional(actor);
    const clinical = b.clinical === true;
    if (clinical && a.role !== "doctor") fail();
    const filename = text(b.filename, 120);
    if (/[\/\\\r\n]/.test(filename)) fail(400);
    if (
      typeof b.content !== "string" ||
      b.content.length > 2800000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(b.content)
    )
      fail(400, "Adjunto inválido. Máximo 2 MB.");
    const bytes = Buffer.from(b.content, "base64");
    const types = {
      "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
      "image/png": bytes
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex")),
      "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    };
    if (!types[b.mime] || !bytes.length || bytes.length > 2 * 1024 * 1024)
      fail(400, "Solo PDF, PNG o JPEG válidos de hasta 2 MB.");
    const aud = recipients(actor, r, b.audience || [], clinical),
      did = id();
    let series = did,
      version = 1;
    if (b.previous) {
      const d = as(actor, () =>
        get(
          "SELECT * FROM visible_documents WHERE id=? AND request=?",
          b.previous,
          rid,
        ),
      );
      if (!d) fail(404);
      if (d.clinical !== Number(clinical)) fail(400);
      series = d.series;
      version =
        get("SELECT max(version) v FROM documents WHERE series=?", series).v +
        1;
    }
    transaction(() => {
      run(
        "INSERT INTO documents(id,request,series,version,uploader,center,clinical,filename,mime,content,audience,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        did,
        rid,
        series,
        version,
        actor,
        r.center,
        Number(clinical),
        filename,
        b.mime,
        bytes,
        aud,
        now(),
      );
      audit(actor, "document.draft", rid, { document: did, version });
    });
    return detail(actor, rid);
  }
  function approve(actor, did) {
    doctor(actor);
    const d = as(actor, () =>
      get("SELECT * FROM visible_documents WHERE id=?", did),
    );
    if (!d) fail(404);
    recipients(
      actor,
      req(actor, d.request),
      JSON.parse(d.audience),
      !!d.clinical,
    );
    if (!JSON.parse(d.audience).length)
      fail(
        400,
        "Selecciona destinatarios autorizados antes de subir el documento.",
      );
    if (
      d.version !==
      get("SELECT max(version) v FROM documents WHERE series=?", d.series).v
    )
      fail(409, "Aprueba la versión más reciente.");
    transaction(() => {
      run(
        "UPDATE documents SET approved_by=?,approved_at=? WHERE id=?",
        actor,
        now(),
        did,
      );
      audit(actor, "document.approved", d.request, {
        document: did,
        version: d.version,
      });
    });
    return detail(actor, d.request);
  }
  function issueTicket(actor, did, sessionHash) {
    const d = as(actor, () =>
      get("SELECT id FROM visible_documents WHERE id=?", did),
    );
    if (!d) fail(404);
    const token = randomBytes(32).toString("hex");
    run(
      "INSERT INTO tickets VALUES(?,?,?,?)",
      hash(token),
      did,
      sessionHash,
      Date.now() + 60000,
    );
    return token;
  }
  function download(actor, token, sessionHash) {
    const ticket = get(
      "SELECT * FROM tickets WHERE hash=? AND session=? AND expires>?",
      hash(token),
      sessionHash,
      Date.now(),
    );
    if (!ticket) fail(404);
    const d = as(actor, () =>
      get("SELECT * FROM visible_documents WHERE id=?", ticket.document),
    );
    if (!d) fail(404);
    run("DELETE FROM tickets WHERE hash=?", hash(token));
    audit(actor, "document.download", d.request, { document: d.id });
    return d;
  }
  function revoke(actor, gid) {
    coordinator(actor);
    const g = get("SELECT * FROM grants WHERE id=?", gid);
    if (!g) fail(404);
    transaction(() => {
      run("UPDATE grants SET revoked_at=? WHERE id=?", now(), gid);
      run(
        "DELETE FROM tickets WHERE session IN(SELECT hash FROM sessions WHERE account=?)",
        g.account,
      );
      audit(actor, "grant.revoked", g.patient, { grant: gid });
    });
  }
  function reviewGrant(actor, b) {
    coordinator(actor);
    const existing = get("SELECT * FROM grants WHERE id=?", b.id);
    if (!existing) fail(404);
    const evidence = text(b.evidence, 120);
    if (!/^[A-Z0-9_-]{4,120}$/i.test(evidence))
      fail(400, "Usa una referencia administrativa sin contenido sensible.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(b.review_on) ||
      b.review_on <=
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Santiago",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date())
    )
      fail(400, "La próxima revisión debe ser futura.");
    for (const flag of ["manage", "submit", "clinical"])
      if (typeof b[flag] !== "boolean") fail(400);
    transaction(() => {
      run(
        "UPDATE grants SET manage=?,submit=?,clinical=?,verified_by=?,evidence=?,review_on=?,revoked_at=NULL WHERE id=?",
        +b.manage,
        +b.submit,
        +b.clinical,
        actor,
        evidence,
        b.review_on,
        b.id,
      );
      audit(actor, "grant.reviewed", existing.patient, {
        grant: b.id,
        manage: b.manage,
        submit: b.submit,
        clinical: b.clinical,
      });
    });
  }
  function updateSettings(actor, b) {
    doctor(actor);
    if (b.absence) {
      if (
        typeof b.absence.enabled !== "boolean" ||
        (b.absence.until && !Number.isFinite(Date.parse(b.absence.until)))
      )
        fail(400);
      run(
        "UPDATE settings SET value=? WHERE key=?",
        JSON.stringify({
          enabled: b.absence.enabled,
          until: b.absence.until || null,
        }),
        "absence",
      );
    }
    if (b.delivery) {
      const v = b.delivery;
      for (const key of ["retryMinutes", "escalateMinutes"])
        if (
          v[key] !== null &&
          (!Number.isInteger(v[key]) || v[key] < 1 || v[key] > 10080)
        )
          fail(400);
      if (
        !Number.isInteger(v.maxAttempts) ||
        v.maxAttempts < 1 ||
        v.maxAttempts > 10 ||
        v.backup
      )
        fail(
          400,
          "No hay un profesional de respaldo autorizado en esta prueba.",
        );
      run(
        "UPDATE settings SET value=? WHERE key=?",
        JSON.stringify({
          retryMinutes: v.retryMinutes,
          escalateMinutes: v.escalateMinutes,
          maxAttempts: v.maxAttempts,
          backup: null,
        }),
        "delivery",
      );
    }
    audit(actor, "settings.changed", "coverage");
    return cover();
  }
  function updateRules(actor, b) {
    doctor(actor);
    const v = b.config;
    text(b.reason, 500);
    if (
      !v ||
      !/^ilustrativa-[a-z0-9-]{1,40}$/.test(v.version) ||
      v.approved !== false
    )
      fail(
        400,
        "Esta prueba solo admite reglas ilustrativas sin aprobación clínica.",
      );
    for (const key of ["red", "orange", "yellow"])
      if (
        !Array.isArray(v[key]) ||
        v[key].length > 30 ||
        v[key].some((s) => typeof s !== "string" || !s.trim() || s.length > 100)
      )
        fail(400);
    transaction(() => {
      run(
        "INSERT INTO rule_versions VALUES(?,?,?,?,?)",
        v.version,
        JSON.stringify(v),
        now(),
        actor,
        b.reason,
      );
      run(
        "UPDATE settings SET value=? WHERE key=?",
        JSON.stringify(v.version),
        "rules",
      );
      audit(actor, "rules.versioned", v.version);
    });
    return rules();
  }
  function worker(actor, outcome = "delivered") {
    doctor(actor);
    if (!["delivered", "failed"].includes(outcome)) fail(400);
    const config = setting("delivery");
    const c = cover();
    const jobs = all(
      "SELECT n.*,a.role FROM notifications n JOIN accounts a ON a.id=n.account WHERE channel<>'internal' AND status IN ('queued_test','held_coverage','failed_test') AND (next_at IS NULL OR next_at<=?)",
      now(),
    );
    transaction(() => {
      if (config.escalateMinutes && c.active) {
        const threshold = new Date(
          Date.now() - config.escalateMinutes * 60000,
        ).toISOString();
        const pending = all(
          "SELECT r.id FROM requests r WHERE r.priority>=2 AND r.accepted_at IS NULL AND r.created_at<=? AND r.state<>'Cerrada'",
          threshold,
        );
        for (const p of pending) {
          const result = run(
            "UPDATE notifications SET status='needs_manual_escalation' WHERE request=? AND account=? AND channel='internal' AND status<>'needs_manual_escalation'",
            p.id,
            actor,
          );
          if (result.changes)
            audit(actor, "notification.manual_escalation", p.id, {
              backupConfigured: false,
            });
        }
      }
      for (const j of jobs) {
        if (
          !as(j.account, () =>
            get("SELECT id FROM visible_requests WHERE id=?", j.request),
          )
        ) {
          run(
            "UPDATE notifications SET status='cancelled_access' WHERE id=?",
            j.id,
          );
          continue;
        }
        if (j.role === "doctor" && !c.active) {
          run(
            "UPDATE notifications SET status='held_coverage' WHERE id=?",
            j.id,
          );
          continue;
        }
        if (
          j.attempts >= config.maxAttempts ||
          (j.status === "failed_test" && !config.retryMinutes)
        )
          continue;
        const delivery = deliverTest(j.channel, outcome);
        const status = delivery.providerReported
          ? "provider_reported_test"
          : "failed_test";
        run(
          "UPDATE notifications SET status=?,attempts=attempts+1,next_at=?,delivered_at=? WHERE id=?",
          status,
          config.retryMinutes
            ? new Date(Date.now() + config.retryMinutes * 60000).toISOString()
            : null,
          outcome === "delivered" ? now() : null,
          j.id,
        );
        audit(actor, "notification.test", j.request, {
          channel: j.channel,
          status,
        });
      }
    });
    return { processed: jobs.length, mode: "test", externalMessagesSent: 0 };
  }
  async function observe(actor, rid, provider) {
    doctor(actor);
    const r = req(actor, rid),
      messages = as(actor, () =>
        all(
          "SELECT body FROM visible_messages WHERE request=? AND kind='clinical' ORDER BY created_at",
          rid,
        ),
      );
    // Optional dependency: disabled by default. No provider is bundled, and no network calls happen here.
    try {
      if (!provider) {
        run(
          "INSERT OR REPLACE INTO observations VALUES(?,?,NULL)",
          rid,
          "not_configured",
        );
        return;
      }
      const value = await Promise.race([
        provider({
          original: messages.map((m) => m.body),
          reason: r.reason,
          priority: r.priority,
        }),
        new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error("timeout")), 3000);
          t.unref();
        }),
      ]);
      text(value.summary, 2000);
      if (
        value.suggestedReason !== undefined &&
        (!Number.isInteger(value.suggestedReason) ||
          value.suggestedReason < 0 ||
          value.suggestedReason > 4)
      )
        fail(400);
      if (
        !Array.isArray(value.fragments) ||
        value.fragments.some(
          (f) =>
            typeof f !== "string" || !messages.some((m) => m.body.includes(f)),
        )
      )
        fail(400);
      if (
        !Number.isInteger(value.suggestedPriority) ||
        value.suggestedPriority < r.priority ||
        value.suggestedPriority > 3
      )
        fail(400);
      if (
        !Array.isArray(value.missing) ||
        value.missing.some((f) => typeof f !== "string" || f.length > 300)
      )
        fail(400);
      run(
        "INSERT OR REPLACE INTO observations VALUES(?,?,?)",
        rid,
        "observation_only",
        JSON.stringify({
          summary: value.summary,
          suggestedReason: value.suggestedReason ?? null,
          fragments: value.fragments,
          missing: value.missing,
          suggestedPriority: value.suggestedPriority,
        }),
      );
    } catch {
      run(
        "INSERT OR REPLACE INTO observations VALUES(?,?,NULL)",
        rid,
        "failed",
      );
    }
    audit(actor, "ai.observed", rid);
  }
  function login(email, password, code) {
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 ||
      password.length > 256
    )
      fail(401, "Credenciales no válidas.");
    const a = get(
      "SELECT * FROM accounts WHERE email=? AND active=1",
      email.toLowerCase(),
    );
    const candidate = scryptSync(
      password,
      a?.salt || "unavailable-demo-salt",
      64,
    );
    if (!a || !timingSafeEqual(candidate, Buffer.from(a.password, "hex")))
      fail(401, "Credenciales no válidas.");
    let counter = -1;
    if (a.role !== "family") {
      if (typeof code !== "string" || !/^\d{6}$/.test(code))
        fail(401, "Se requiere un segundo factor válido.");
      counter = [-1, 0, 1]
        .map((d) => Math.floor(Date.now() / 30000) + d)
        .find((c) => c > a.last_totp && totp(a.totp, c * 30000) === code);
      if (counter === undefined)
        fail(401, "Se requiere un segundo factor válido y no utilizado.");
    }
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    transaction(() => {
      if (counter >= 0)
        run("UPDATE accounts SET last_totp=? WHERE id=?", counter, a.id);
      run(
        "INSERT INTO sessions VALUES(?,?,?,?,?,?)",
        hash(token),
        a.id,
        a.session_version,
        Date.now() + 60 * 60 * 1000,
        csrf,
        a.role === "family" ? 0 : 1,
      );
      audit(a.id, "session.created", a.id);
    });
    return { token, csrf, account: { id: a.id, name: a.name, role: a.role } };
  }
  function session(token) {
    const s = get(
      "SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.account AND a.active=1 AND a.session_version=s.version WHERE s.hash=? AND s.expires>? AND (a.role='family' OR s.mfa=1)",
      hash(token || ""),
      Date.now(),
    );
    if (!s) fail(401, "Inicia sesión para continuar.");
    return s;
  }
  function preferences(actor, b) {
    professional(actor);
    if (
      !Array.isArray(b.priorities) ||
      b.priorities.some((p) => ![0, 1, 2, 3].includes(p))
    )
      fail(400);
    run(
      "INSERT OR REPLACE INTO preferences VALUES(?,?)",
      actor,
      JSON.stringify([...new Set(b.priorities)]),
    );
    audit(actor, "notifications.preferences", actor);
  }
  as("system", seed);
  const scoped = {
    bootstrap,
    detail,
    create,
    message,
    action,
    upload,
    approve,
    issueTicket,
    download,
    revoke,
    reviewGrant,
    updateSettings,
    updateRules,
    worker,
    observe,
    preferences,
  };
  return {
    db,
    get,
    all,
    run,
    as,
    audit,
    transaction,
    provision,
    account,
    req,
    grant,
    login,
    session,
    rules,
    cover,
    setting,
    ...Object.fromEntries(
      Object.entries(scoped).map(([name, fn]) => [
        name,
        (actor, ...args) => as(actor, () => fn(actor, ...args)),
      ]),
    ),
  };
}
