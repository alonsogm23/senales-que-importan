import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Fault, fail } from "./errors.mjs";
import { emergency } from "../public/policy.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
export function createPortal({ store, origin, observer } = {}) {
  if (!store)
    throw Error("Se requiere un proveedor explícito de identidad y datos.");
  const failures = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost");
      // No query data is accepted or logged; request bodies never enter server logs.
      const path = url.pathname;
      const expectedOrigin =
        origin || `http://127.0.0.1:${server.address().port}`;
      const host = new URL(expectedOrigin).host;
      if (
        req.headers.host !== host &&
        req.headers.host !== host.replace("127.0.0.1", "localhost")
      )
        fail(403, "Origen no permitido.");
      if (path.startsWith("/api/")) {
        if (!["GET", "POST"].includes(req.method)) fail(405);
        let body = {};
        if (req.method === "POST") {
          if (
            req.headers.origin !== expectedOrigin &&
            req.headers.origin !==
              expectedOrigin.replace("127.0.0.1", "localhost")
          )
            fail(403, "Origen no permitido.");
          if (!req.headers["content-type"]?.startsWith("application/json"))
            fail(415);
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 3000000)
              fail(413, "El archivo excede el tamaño permitido.");
            chunks.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            fail(400, "Datos no válidos.");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            fail(400);
        }
        if (path === "/api/public")
          return send(200, {
            mode:
              store.kind === "supabase"
                ? "fictional-supabase"
                : "fictional-sqlite-legacy",
            emergency,
            coverage: await store.cover(),
            rules: await store.rules(),
          });
        if (path === "/api/login" && req.method === "POST") {
          const key = req.socket.remoteAddress,
            entry = failures.get(key) || {
              count: 0,
              until: Date.now() + 60000,
            };
          if (entry.until < Date.now()) {
            entry.count = 0;
            entry.until = Date.now() + 60000;
          }
          if (entry.count >= 10)
            fail(429, "Demasiados intentos. Espera un minuto.");
          try {
            const result = await store.login(
              body.email,
              body.password,
              body.code,
            );
            failures.delete(key);
            res.setHeader(
              "Set-Cookie",
              `portal_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${expectedOrigin.startsWith("https:") ? "; Secure" : ""}`,
            );
            return send(200, {
              csrf: result.csrf,
              account: result.account,
              mfaRequired: result.mfaRequired,
              enrollmentNeeded: result.enrollmentNeeded,
              factorId: result.factorId,
            });
          } catch (e) {
            entry.count++;
            failures.set(key, entry);
            throw e;
          }
        }
        const cookie = req.headers.cookie?.match(
          /(?:^|;\s*)portal_session=([A-Za-z0-9_.-]{1,6000})(?:;|$)/,
        )?.[1];
        const session = await store.session(cookie),
          actor = session.account;
        if (
          req.method === "POST" &&
          req.headers["x-csrf-token"] !== session.csrf
        )
          fail(403, "La verificación de sesión falló. Recarga la página.");
        if (session.cookie)
          res.setHeader(
            "Set-Cookie",
            `portal_session=${session.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${expectedOrigin.startsWith("https:") ? "; Secure" : ""}`,
          );
        return await store.as(
          store.kind === "supabase" ? session : actor,
          async () => {
            if (
              path === "/api/mfa/enroll" &&
              req.method === "POST" &&
              store.enroll
            )
              return send(200, await store.enroll());
            if (
              path === "/api/mfa/verify" &&
              req.method === "POST" &&
              store.verify
            ) {
              const result = await store.verify(body);
              res.setHeader(
                "Set-Cookie",
                `portal_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${expectedOrigin.startsWith("https:") ? "; Secure" : ""}`,
              );
              return send(200, { csrf: result.csrf, account: result.account });
            }
            if (path === "/api/session" && req.method === "GET")
              return send(200, {
                csrf: session.csrf,
                ...(await store.bootstrap(actor)),
              });
            if (path === "/api/logout" && req.method === "POST") {
              if (store.logout) await store.logout();
              else store.run("DELETE FROM sessions WHERE hash=?", session.hash);
              res.setHeader(
                "Set-Cookie",
                "portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
              );
              return send(200, { ok: true });
            }
            if (path === "/api/requests" && req.method === "POST")
              return send(201, await store.create(actor, body));
            const requestMatch = path.match(
              /^\/api\/requests\/([\w-]+)(?:\/(messages|actions|documents|observe))?$/,
            );
            if (requestMatch) {
              const [, rid, operation] = requestMatch;
              if (!operation && req.method === "GET")
                return send(200, await store.detail(actor, rid));
              if (req.method !== "POST") fail(405);
              if (operation === "messages")
                return send(200, await store.message(actor, rid, body));
              if (operation === "actions")
                return send(200, await store.action(actor, rid, body));
              if (operation === "documents")
                return send(201, await store.upload(actor, rid, body));
              if (operation === "observe") {
                await store.observe(actor, rid, observer);
                return send(200, await store.detail(actor, rid));
              }
            }
            const docMatch = path.match(
              /^\/api\/documents\/([\w-]+)\/(approve|ticket)$/,
            );
            if (docMatch && req.method === "POST") {
              if (docMatch[2] === "approve")
                return send(200, await store.approve(actor, docMatch[1]));
              return send(200, {
                url: `/api/download/${await store.issueTicket(actor, docMatch[1], session.hash)}`,
                expiresInSeconds: 60,
              });
            }
            const ticketMatch = path.match(/^\/api\/download\/([a-f0-9]{64})$/);
            if (ticketMatch && req.method === "GET") {
              const d = await store.download(
                actor,
                ticketMatch[1],
                session.hash,
              );
              res.writeHead(200, {
                "Content-Type": d.mime,
                "Content-Disposition": `attachment; filename="documento${d.mime === "application/pdf" ? ".pdf" : d.mime === "image/png" ? ".png" : ".jpg"}"`,
              });
              return res.end(Buffer.from(d.content));
            }
            if (path === "/api/grants/revoke" && req.method === "POST") {
              await store.revoke(actor, body.id);
              return send(200, { ok: true });
            }
            if (path === "/api/grants/review" && req.method === "POST") {
              await store.reviewGrant(actor, body);
              return send(200, { ok: true });
            }
            if (path === "/api/settings" && req.method === "POST")
              return send(200, await store.updateSettings(actor, body));
            if (path === "/api/rules" && req.method === "POST")
              return send(200, await store.updateRules(actor, body));
            if (path === "/api/preferences" && req.method === "POST") {
              await store.preferences(actor, body);
              return send(200, { ok: true });
            }
            if (path === "/api/notifications/test" && req.method === "POST")
              return send(200, await store.worker(actor, body.outcome));
            fail(404, "Ruta no disponible.");
          },
        );
      }
      if (req.method !== "GET") fail(405);
      const files = {
        "/portal/": ["portal/public/index.html", "text/html"],
        "/portal": ["portal/public/index.html", "text/html"],
        "/portal/app.js": ["portal/public/app.js", "text/javascript"],
        "/portal/style.css": ["portal/public/style.css", "text/css"],
        "/portal/policy.js": ["portal/public/policy.js", "text/javascript"],
        "/portal/brand.png": ["Copia de logo-dr-denis.PNG", "image/png"],
      };
      if (path === "/") {
        let html = readFileSync(resolve(root, "index.html"), "utf8");
        // Local integration only: no production HTML changes and no analytics in the test server.
        html = html.replace(
          /<!-- Google Analytics 4 -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/,
          "",
        );
        html = html.replace(
          '<ul class="nav-links">',
          '<ul class="nav-links"><li><a href="/portal/">Portal de pacientes · prueba</a></li>',
        );
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://drdenisgomez.cl data:; connect-src 'self'; frame-src https://www.google.com; frame-ancestors 'none'",
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      const fontMatch = path.match(
        /^\/portal\/fonts\/(dm-sans-(?:400|500|600)|lora-(?:400|600))\.ttf$/,
      );
      if (fontMatch) {
        res.writeHead(200, { "Content-Type": "font/ttf" });
        return res.end(
          readFileSync(
            resolve(root, "portal/public/fonts", fontMatch[1] + ".ttf"),
          ),
        );
      }
      const file = files[path];
      if (file) {
        res.writeHead(200, { "Content-Type": file[1] + "; charset=utf-8" });
        return res.end(readFileSync(resolve(root, file[0])));
      }
      // Public site images only, never arbitrary paths or backend files.
      if (/^\/[a-zA-Z0-9 -]+\.(png|jpg|PNG)$/.test(decodeURIComponent(path))) {
        try {
          const data = readFileSync(
            resolve(root, decodeURIComponent(path).slice(1)),
          );
          res.writeHead(200, {
            "Content-Type": path.endsWith(".jpg") ? "image/jpeg" : "image/png",
          });
          return res.end(data);
        } catch {}
      }
      fail(404, "Página no disponible.");
    } catch (e) {
      // Fixed messages only: never exception stacks, bodies, URLs or personal data.
      send(e instanceof Fault ? e.status : 500, {
        error:
          e instanceof Fault
            ? e.message
            : "No pudimos completar la acción. Tu solicitud guardada se conserva.",
      });
    }
  });
  return { server, store };
}
