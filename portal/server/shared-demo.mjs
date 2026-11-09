import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openStore } from "./service.mjs";
import { createPortal } from "./server.mjs";
import { emergency } from "../public/policy.js";

const digest = (value) => createHash("sha256").update(value).digest();
// Separate, explicit entry point. The original local server keeps its production guard.
export function createSharedDemo({
  origin,
  password,
  expiresAt,
  store,
  clock = Date.now,
}) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw Error("A dedicated HTTPS demo origin is required.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    /(^|\.)(drdenisgomez\.cl|localhost|example\.invalid)$/.test(
      parsed.hostname,
    ) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)
  )
    throw Error("Use a separate HTTPS hostname for the fictional demo.");
  if (
    typeof password !== "string" ||
    password.length < 32 ||
    password.length > 256
  )
    throw Error(
      "The demo gate requires a private password of at least 32 characters.",
    );
  const deadline = Date.parse(expiresAt);
  if (
    !Number.isFinite(deadline) ||
    deadline <= clock() ||
    deadline - clock() > 14 * 86400000
  )
    throw Error("Set demo expiry within the next 14 days.");
  if (
    !store ||
    store
      .all("SELECT email FROM accounts")
      .some((a) => !a.email.endsWith("@example.invalid")) ||
    store
      .all("SELECT name FROM patients")
      .some((p) => !/Prueba|Demo/.test(p.name))
  )
    throw Error("Only the fictional dataset is allowed.");
  const credentialHash = digest(`revision:${password}`);
  const { server: portal } = createPortal({ store, origin });
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("fictional-demo");
    }
    if (clock() >= deadline) {
      res.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(
        "La demostración ha vencido. No introduzcas datos reales.\n\n" +
          emergency,
      );
    }
    const authorization = req.headers.authorization || "";
    let supplied = "";
    if (
      authorization.length <= 1024 &&
      /^Basic [A-Za-z0-9+/]+=*$/.test(authorization)
    )
      supplied = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    if (!supplied || !timingSafeEqual(credentialHash, digest(supplied))) {
      res.writeHead(401, {
        "WWW-Authenticate":
          'Basic realm="Demostracion privada", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
      });
      return res.end(
        "Demostración privada con datos ficticios. Necesitas el acceso de revisión.\n\n" +
          emergency,
      );
    }
    // Gate applies to HTML, assets, API and files; no MFA helper or role-selection endpoint.
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(303, { Location: "/portal/" });
      return res.end();
    }
    portal.emit("request", req, res);
  });
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.PORTAL_DEMO_MODE !== "fictional-only")
    throw Error("Explicit fictional-only shared demo mode is required.");
  const store = openStore(
    resolve(process.env.PORTAL_DEMO_DB || "portal/data/demo.sqlite"),
  );
  const { server } = createSharedDemo({
    store,
    origin: process.env.PORTAL_DEMO_ORIGIN,
    password: process.env.PORTAL_DEMO_PASSWORD,
    expiresAt: process.env.PORTAL_DEMO_EXPIRES_AT,
  });
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid demo port.");
  server.listen(port, "0.0.0.0", () =>
    console.log(
      "Protected fictional demo started. No real notifications or AI provider enabled.",
    ),
  );
}
