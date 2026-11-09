import { fileURLToPath } from "node:url";
import { createPortal } from "./http-server.mjs";
import { createSupabaseStore, supabaseConfig } from "./supabase-store.mjs";
export function createSupabasePortal({
  config = supabaseConfig(),
  origin,
} = {}) {
  return createPortal({ store: createSupabaseStore(config), origin });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const { server } = createSupabasePortal({
    origin: process.env.PORTAL_ORIGIN,
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      "Portal ficticio con Supabase iniciado. Sin servicios de pago ni envíos reales.",
    ),
  );
}
