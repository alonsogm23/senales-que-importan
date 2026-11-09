import { Readable } from "node:stream";
import { createSupabasePortal } from "./supabase-server.mjs";
// Reuse the same checked HTTP boundary for native Web API hosts such as Vercel.
// No listener, SQLite, local writes, or privileged Supabase key in this runtime.
export function createWebHandler({ config, origin } = {}) {
  if (!origin || new URL(origin).protocol !== "https:")
    throw Error("PORTAL_ORIGIN debe ser el origen HTTPS exacto de la demo.");
  const { server } = createSupabasePortal({ config, origin });
  const listener = server.listeners("request")[0];
  return async (request) => {
    const url = new URL(request.url);
    // Enforce a size bound before buffering, including chunked bodies.
    const chunks = [];
    let size = 0;
    if (request.body)
      for await (const part of request.body) {
        size += part.length;
        if (size > 3000000)
          return Response.json(
            { error: "Archivo demasiado grande." },
            { status: 413, headers: { "Cache-Control": "no-store, private" } },
          );
        chunks.push(part);
      }
    const incoming = Readable.from(chunks);
    incoming.method = request.method;
    incoming.url = url.pathname + url.search;
    incoming.headers = Object.fromEntries(request.headers);
    incoming.headers.host = url.host;
    incoming.socket = { remoteAddress: "serverless" };
    return new Promise((resolve, reject) => {
      const headers = new Headers();
      let status = 200;
      const response = {
        setHeader: (k, v) => headers.set(k, v),
        writeHead: (code, extra = {}) => {
          status = code;
          for (const [k, v] of Object.entries(extra)) headers.set(k, v);
        },
        end: (body) => resolve(new Response(body ?? null, { status, headers })),
      };
      Promise.resolve(listener(incoming, response)).catch(reject);
    });
  };
}
