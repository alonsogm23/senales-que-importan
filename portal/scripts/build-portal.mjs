import { mkdirSync, cpSync, writeFileSync, rmSync } from "node:fs";
const out = "dist-portal";
rmSync(out, { recursive: true, force: true });
mkdirSync(out + "/portal", { recursive: true });
cpSync("portal/public", out + "/portal", { recursive: true });
cpSync("Copia de logo-dr-denis.PNG", out + "/portal/brand.png");
writeFileSync(out + "/robots.txt", "User-agent: *\nDisallow: /\n");
console.log(
  "Portal estático preparado; no incluye credenciales, bases locales ni la web pública.",
);
