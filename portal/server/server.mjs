import { fileURLToPath } from "node:url";
import { openStore } from "./service.mjs";
import { createPortal as httpPortal } from "./http-server.mjs";
export function createPortal(options = {}) {
  return httpPortal({
    ...options,
    store:
      options.store ||
      openStore(fileURLToPath(new URL("../data/demo.sqlite", import.meta.url))),
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Este servidor es exclusivamente para pruebas locales con datos ficticios.",
    );
  const port = Number(process.env.PORT || 4173);
  const { server } = createPortal();
  server.listen(port, "127.0.0.1", () =>
    console.log(`Portal ficticio local: http://127.0.0.1:${port}/portal/`),
  );
}
