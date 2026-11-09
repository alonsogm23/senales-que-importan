import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createSupabasePortal } from "../server/supabase-server.mjs";
import { hostedSessions } from "./supabase.integration.mjs";
const { config, fixture: f, sessions } = await hostedSessions();
const { server } = createSupabasePortal({ config });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
});
async function open(role, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addCookies([
    {
      name: "portal_session",
      value: sessions[role].token,
      url: origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  await page.goto(origin + "/portal/");
  await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
  await page
    .getByRole("button", {
      name: role === "family" ? "Mis solicitudes" : "Bandeja de solicitudes",
      exact: true,
    })
    .first()
    .click();
  await page
    .locator(`[data-open="${f.requests["demo-cenit"]}"]`)
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Antecedentes y respuestas" })
    .waitFor();
  return { context, page };
}
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const name =
      "justificante-navegador-" + viewport.width + "-" + Date.now() + ".pdf";
    const secretary = await open("cenit", viewport);
    await secretary.page
      .getByText("Subir documento o nueva versión", { exact: true })
      .click();
    await secretary.page
      .locator("#file")
      .setInputFiles({
        name,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n% Solo prueba ficticia\n%%EOF"),
      });
    await secretary.page.locator("#doc-audience input").first().check();
    await secretary.page
      .getByRole("button", { name: "Guardar borrador privado" })
      .click();
    const secDoc = secretary.page
      .locator(".document")
      .filter({ hasText: name });
    await secDoc.waitFor();
    assert.ok((await secDoc.innerText()).includes("Borrador pendiente"));
    await secretary.context.close();
    const doctor = await open("doctor", viewport);
    const doc = doctor.page.locator(".document").filter({ hasText: name });
    await doc.getByRole("button", { name: "Aprobar esta versión" }).click();
    await doctor.page
      .locator(".document")
      .filter({ hasText: name })
      .getByText(/Aprobado por el doctor/)
      .waitFor();
    await doctor.context.close();
    const family = await open("family", viewport);
    const download = family.page.waitForEvent("download");
    await family.page
      .locator(".document")
      .filter({ hasText: name })
      .getByRole("button", { name: "Descargar", exact: true })
      .click();
    const file = await download;
    assert.equal(await file.failure(), null);
    assert.ok(file.suggestedFilename().endsWith(".pdf"));
    await family.context.close();
    console.log(
      "OK documentos " +
        viewport.width +
        ": subida privada, aprobación médica y descarga autorizada desde navegador.",
    );
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
