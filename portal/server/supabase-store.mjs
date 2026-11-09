import { createClient } from "@supabase/supabase-js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Fault, fail, text } from "./errors.mjs";
import { coverage } from "../public/policy.js";

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
export function localSupabaseConfig(path = "work/supabase-local.json") {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const url = config.API_URL || config.api?.url;
  const key =
    config.ANON_KEY || config.PUBLISHABLE_KEY || config.auth?.publishable_key;
  const serviceKey =
    config.SERVICE_ROLE_KEY || config.SECRET_KEY || config.auth?.secret_key;
  if (!url || !key || !serviceKey)
    throw Error(
      "Falta la configuración privada de Supabase local. Ejecuta npm run supabase:setup.",
    );
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
    throw Error(
      "Esta configuración permite exclusivamente Supabase local y datos ficticios.",
    );
  return { url, key, serviceKey };
}
export function supabaseConfig() {
  if (process.env.PORTAL_SUPABASE_URL)
    return {
      url: process.env.PORTAL_SUPABASE_URL,
      key: process.env.PORTAL_SUPABASE_PUBLISHABLE_KEY,
      csrfSecret: process.env.PORTAL_CSRF_SECRET,
    };
  const path =
    process.env.PORTAL_SUPABASE_CONFIG || "work/supabase-hosted.json";
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const c = raw.API_URL || raw.api?.url ? localSupabaseConfig(path) : raw;
  return { ...c, csrfSecret: process.env.PORTAL_CSRF_SECRET || c.csrfSecret };
}
function checked(result, notFound = false) {
  if (!result.error) return result.data;
  const code = result.error.code;
  if (code === "42501" || code === "PGRST301")
    fail(
      notFound ? 404 : 403,
      notFound
        ? "Recurso no disponible."
        : "La sesión o los permisos no permiten esta acción.",
    );
  if (code === "P0002") fail(404, "Recurso no disponible.");
  if (
    [
      "23505",
      "23514",
      "23503",
      "23502",
      "22P02",
      "22023",
      "22007",
      "22008",
    ].includes(code)
  )
    fail(400, "Revisa los datos y la versión de la solicitud.");
  throw new Fault(
    503,
    "Supabase no pudo completar la operación. Las solicitudes guardadas se conservan.",
  );
}
function decode(session) {
  try {
    return JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
    );
  } catch {
    fail(401);
  }
}
export function createSupabaseStore(config) {
  const local = ["127.0.0.1", "localhost"].includes(
    new URL(config.url).hostname,
  );
  if (!local && config.url !== "https://cpioegorrksyqlqllesu.supabase.co")
    throw Error("Solo se permite el proyecto ficticio autorizado.");
  if (
    !config.key ||
    (!local &&
      (config.serviceKey ||
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key)))
  )
    throw Error(
      "Usa exclusivamente una clave publicable en el servidor de aplicación alojado.",
    );
  if (
    process.env.NODE_ENV === "production" &&
    (!config.csrfSecret || config.csrfSecret.length < 32)
  )
    throw Error(
      "Configura PORTAL_CSRF_SECRET con al menos 32 caracteres aleatorios.",
    );
  const options = { auth: authOptions };
  const anon = createClient(config.url, config.key, options);
  const storageAdmin = local
    ? createClient(config.url, config.serviceKey, options)
    : null;
  const context = new AsyncLocalStorage(),
    csrfKey = config.csrfSecret || randomBytes(32);
  const pack = (s) =>
    Buffer.from(
      JSON.stringify({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
      }),
    ).toString("base64url");
  const csrf = (s) =>
    createHmac("sha256", csrfKey).update(decode(s).session_id).digest("hex");
  const client = () => createClient(config.url, config.key, options);
  const active = () => context.getStore() || fail(401);
  const rpc = async (op, b = {}) =>
    checked(
      await active().client.rpc("portal_command", { op, b }),
      ["detail", "ticket", "consume_ticket", "approve"].includes(op),
    );
  async function publicInfo() {
    return checked(await anon.rpc("portal_public"));
  }
  async function identity(c) {
    const data = checked(await c.rpc("portal_identity"));
    if (!data) fail(401, "La cuenta o sesión ya no está vigente.");
    return data;
  }
  async function mfaInfo(c) {
    const factors = checked(await c.auth.mfa.listFactors());
    const verified = factors.all.filter(
      (f) => f.factor_type === "totp" && f.status === "verified",
    );
    return {
      enrollmentNeeded: verified.length === 0,
      factorId: verified[0]?.id,
    };
  }
  async function result(c, providerSession) {
    const account = await identity(c);
    return {
      token: pack(providerSession),
      csrf: csrf(providerSession),
      account,
      providerSession,
    };
  }
  async function login(email, password, code) {
    text(email, 254);
    text(password, 256);
    if (!email.endsWith("@example.invalid"))
      fail(401, "Solo se admiten cuentas ficticias.");
    const c = client();
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) fail(401, "Credenciales no válidas.");
    let s = signed.data.session;
    const account = await identity(c);
    if (account.role !== "family") {
      const info = await mfaInfo(c);
      if (code && info.factorId) {
        const verified = await c.auth.mfa.challengeAndVerify({
          factorId: info.factorId,
          code,
        });
        if (verified.error) {
          await c.auth.signOut({ scope: "local" });
          fail(401, "Se requiere un segundo factor válido.");
        }
        s = verified.data;
      } else return { ...(await result(c, s)), mfaRequired: true, ...info };
    }
    return { ...(await result(c, s)), mfaRequired: false };
  }
  async function session(token) {
    let payload;
    try {
      if (typeof token !== "string" || token.length > 6000) fail(401);
      payload = JSON.parse(Buffer.from(token, "base64url").toString());
    } catch {
      fail(401, "Inicia sesión para continuar.");
    }
    const c = client();
    const data = await c.auth.setSession(payload);
    if (data.error || !data.data.session)
      fail(401, "La sesión ya no está vigente.");
    const user = await c.auth.getUser();
    if (user.error) fail(401, "La sesión ya no está vigente.");
    const s = data.data.session,
      account = await identity(c);
    return {
      account: account.id,
      profile: account,
      client: c,
      hash: decode(s).session_id,
      csrf: csrf(s),
      cookie: pack(s) !== token ? pack(s) : undefined,
      providerSession: s,
    };
  }
  async function enroll() {
    const s = active(),
      info = await mfaInfo(s.client);
    if (!info.enrollmentNeeded) fail(409, "Ya hay un segundo factor activo.");
    const factors = checked(await s.client.auth.mfa.listFactors());
    for (const f of factors.all.filter(
      (f) => f.status === "unverified" && f.factor_type === "totp",
    ))
      checked(await s.client.auth.mfa.unenroll({ factorId: f.id }));
    const data = checked(
      await s.client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Portal ficticio · autenticador personal",
      }),
    );
    let svg = data.totp.qr_code;
    if (svg.startsWith("data:"))
      svg = svg.includes(";base64,")
        ? Buffer.from(svg.slice(svg.indexOf(",") + 1), "base64").toString()
        : decodeURIComponent(svg.slice(svg.indexOf(",") + 1));
    return {
      factorId: data.id,
      secret: data.totp.secret,
      qrCode:
        "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    };
  }
  async function verify(b) {
    text(b.code, 6);
    const s = active();
    const data = await s.client.auth.mfa.challengeAndVerify({
      factorId: b.factorId,
      code: b.code,
    });
    if (data.error)
      fail(401, "El código no es válido. Revisa el autenticador.");
    return result(s.client, data.data);
  }
  async function edgeFile(b) {
    const r = await fetch(config.url + "/functions/v1/portal-files", {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: "Bearer " + active().providerSession.access_token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(b),
    });
    if (!r.ok)
      fail(
        r.status === 401
          ? 401
          : r.status === 403
            ? 404
            : r.status === 400
              ? 400
              : r.status === 413
                ? 413
                : 503,
        "Archivo no disponible o solicitud no autorizada.",
      );
    return r;
  }
  async function upload(actor, rid, b) {
    if (!local) return (await edgeFile({ ...b, id: rid, op: "upload" })).json();
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
    if (!types[b.mime] || !bytes.length || bytes.length > 2097152)
      fail(400, "Solo PDF, PNG o JPEG válidos de hasta 2 MB.");
    const draft = await rpc("document_prepare", {
      ...b,
      content: undefined,
      id: rid,
    });
    try {
      checked(
        await storageAdmin.storage
          .from("portal-documents")
          .upload(draft.storage_path, bytes, {
            contentType: b.mime,
            cacheControl: "0",
            upsert: false,
          }),
      );
      return await rpc("document_finish", { id: rid, document: draft.id });
    } catch (error) {
      await storageAdmin.storage
        .from("portal-documents")
        .remove([draft.storage_path]);
      try {
        await rpc("document_abort", { id: rid, document: draft.id });
      } catch {}
      throw error;
    }
  }
  return {
    kind: "supabase",
    as: (s, fn) => context.run(s, fn),
    login,
    session,
    enroll,
    verify,
    logout: async () => {
      checked(await active().client.auth.signOut({ scope: "local" }));
    },
    publicInfo,
    cover: async () => coverage(new Date(), (await publicInfo()).absence),
    rules: async () => (await publicInfo()).rules,
    bootstrap: async () => ({
      ...(await rpc("bootstrap")),
      rules: (await publicInfo()).rules,
      coverage: coverage(new Date(), (await publicInfo()).absence),
    }),
    detail: (actor, id) => rpc("detail", { id }),
    create: (actor, b) => rpc("create", b),
    message: (actor, id, b) => rpc("message", { ...b, id }),
    action: (actor, id, b) => rpc("action", { ...b, id }),
    upload,
    approve: (actor, id) => rpc("approve", { id }),
    issueTicket: (actor, id) => rpc("ticket", { id }),
    download: async (actor, token) => {
      if (!local) {
        const r = await edgeFile({ op: "download", token });
        return {
          mime: r.headers.get("Content-Type"),
          content: Buffer.from(await r.arrayBuffer()),
        };
      }
      const d = await rpc("consume_ticket", { token });
      const blob = checked(
        await storageAdmin.storage
          .from("portal-documents")
          .download(d.storage_path),
      );
      return { ...d, content: Buffer.from(await blob.arrayBuffer()) };
    },
    revoke: (actor, id) => rpc("grant_revoke", { id }),
    reviewGrant: (actor, b) => rpc("grant_review", b),
    updateSettings: async (actor, b) => {
      await rpc("settings", b);
      return coverage(new Date(), (await publicInfo()).absence);
    },
    updateRules: (actor, b) => rpc("rules", b),
    preferences: (actor, b) => rpc("preferences", b),
    worker: (actor, outcome) => rpc("notification_test", { outcome }),
    observe: (actor, id) => rpc("observe", { id }),
  };
}
