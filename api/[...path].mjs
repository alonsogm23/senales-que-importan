import { createWebHandler } from "../portal/server/web-handler.mjs";
let handler;
function handle(request) {
  try {
    handler ||= createWebHandler({ origin: process.env.PORTAL_ORIGIN });
    return handler(request);
  } catch {
    return Response.json(
      { error: "La demo requiere configuración del servidor." },
      { status: 503, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}
export const GET = handle;
export const POST = handle;
