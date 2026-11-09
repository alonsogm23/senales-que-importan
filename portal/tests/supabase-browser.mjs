// Run hosted suites sequentially: provider MFA verification can revoke other pending AAL1 sessions.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createSupabasePortal } from "../server/supabase-server.mjs";
import { hostedSessions, totp } from "./supabase.integration.mjs";
const { fixture: f, config, store, sessions, mfa } = await hostedSessions();
const { server } = createSupabasePortal({ config });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
});
let passed = 0;
async function check(name, fn) {
  await fn();
  console.log("OK " + ++passed + " " + name);
}
async function signIn(page, role) {
  await page.goto(origin + "/portal/");
  await page.getByLabel("Correo electrónico").fill(f.credentials[role].email);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(f.credentials[role].password);
  await page.getByRole("button", { name: "Entrar al portal" }).click();
  if (role !== "family") {
    await new Promise((r) => setTimeout(r, 30050 - (Date.now() % 30000)));
    await page
      .getByLabel("Código del autenticador")
      .fill(totp(mfa[role].secret));
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/api/mfa/verify"),
    );
    await page.getByRole("button", { name: "Verificar y entrar" }).click();
    const verified = await response;
    if (!verified.ok())
      throw Error(role + ": " + (await verified.json()).error);
  }
  await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
}
try {
  // Exercise actual QR enrolment once on the individually owned fictional CENIT account.
  await check(
    "Enrolamiento MFA desde interfaz, QR cargado y verificación real",
    async () => {
      const r = await sessions.cenit.client.auth.mfa.unenroll({
        factorId: mfa.cenit.factorId,
      });
      assert.ok(!r.error);
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(origin + "/portal/");
      await page
        .getByLabel("Correo electrónico")
        .fill(f.credentials.cenit.email);
      await page
        .getByLabel("Contraseña", { exact: true })
        .fill(f.credentials.cenit.password);
      await page.getByRole("button", { name: "Entrar al portal" }).click();
      const enrolledResponse = page.waitForResponse((r) =>
        r.url().endsWith("/api/mfa/enroll"),
      );
      await page
        .getByRole("button", { name: "Configurar mi autenticador" })
        .click();
      const enrolled = await (await enrolledResponse).json();
      await page.locator("#mfa-secret").waitFor();
      const secret = await page.locator("#mfa-secret").inputValue();
      const qr = page.locator(".mfa-qr");
      await qr.waitFor();
      assert.ok(await qr.evaluate((i) => i.complete && i.naturalWidth > 0));
      const info = await page.evaluate(async () => {
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        return r.status;
      });
      assert.ok([400, 401].includes(info));
      // Obtain only the factor id from the active account; never persist the QR in test artifacts.
      mfa.cenit = { factorId: enrolled.factorId, secret };
      writeFileSync("work/supabase-test-mfa.json", JSON.stringify(mfa), {
        mode: 0o600,
      });
      await page.getByLabel("Código del autenticador").fill(totp(secret));
      await page.getByRole("button", { name: "Verificar y entrar" }).click();
      await page.getByRole("button", { name: "Cerrar sesión" }).waitFor();
      await context.close();
    },
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const mode = viewport.width === 390 ? "móvil" : "escritorio";
    const context = await browser.newContext({
      viewport,
      isMobile: mode === "móvil",
      hasTouch: mode === "móvil",
    });
    const page = await context.newPage();
    const errors = [],
      external = [];
    page.on("pageerror", () => errors.push("pageerror"));
    page.on("request", (r) => {
      if (!r.url().startsWith(origin)) external.push("external");
    });
    await check(
      mode + ": familia crea y amplía solicitud con Supabase",
      async () => {
        await page.goto(origin + "/portal/");
        await page.getByRole("button", { name: "Ayuda urgente" }).click();
        assert.ok(
          (await page.locator("#urgent").innerText()).includes(
            "No esperes una respuesta",
          ),
        );
        await signIn(page, "family");
        await page
          .getByRole("button", { name: "＋ Crear solicitud", exact: true })
          .first()
          .click();
        await page.locator("#patient").selectOption(f.patients.alex);
        await page
          .getByLabel("Centro asociado a esta solicitud")
          .selectOption("CENIT");
        await page
          .getByLabel("¿Qué documento necesitas?")
          .fill("Justificante ficticio de navegador " + mode);
        await page
          .getByLabel("¿Para qué lo necesitas?")
          .fill("Acreditar asistencia ficticia");
        await page.getByLabel("¿A quién va dirigido?").fill("Colegio Demo");
        await page.getByLabel("¿En qué fecha lo necesitas?").fill("2026-12-15");
        await page
          .getByRole("button", { name: "Revisar antes de enviar" })
          .click();
        await page
          .getByLabel("He revisado el paciente y los destinatarios.")
          .check();
        await page
          .getByRole("button", { name: "Enviar solicitud de prueba" })
          .click();
        await page
          .getByText("Sin aceptación explícita de un profesional.")
          .waitFor();
        await page
          .getByLabel("Mensaje", { exact: true })
          .fill("Antecedente ficticio añadido en " + mode);
        await page.getByRole("button", { name: "Añadir al hilo" }).click();
        await page
          .getByText("Antecedente ficticio añadido en " + mode, { exact: true })
          .waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.getByRole("button", { name: "Cerrar sesión" }).click();
        await page.getByLabel("Correo electrónico").waitFor();
      },
    );
    for (const [role, center, foreign] of [
      ["cenit", "CENIT", "demo-cenepsi"],
      ["cenepsi", "Cenepsi", "demo-cenit"],
      ["personal", null, null],
      ["doctor", null, null],
    ]) {
      await check(
        mode + ": permisos de " + role + " en bandeja y API",
        async () => {
          await signIn(page, role);
          await page
            .getByRole("button", {
              name: "Bandeja de solicitudes",
              exact: true,
            })
            .click();
          await page.locator("#request-list").waitFor();
          await page.waitForFunction(
            () =>
              document.querySelectorAll("#request-list .center-tag").length > 0,
          );
          const centers = await page
            .locator("#request-list .center-tag")
            .allTextContents();
          if (center) assert.ok(centers.every((c) => c === center));
          else {
            assert.ok(centers.includes("CENIT"));
            assert.ok(centers.includes("Cenepsi"));
          }
          if (foreign) {
            const code = await page.evaluate(
              async (id) => (await fetch("/api/requests/" + id)).status,
              f.requests[foreign],
            );
            assert.equal(code, 404);
          }
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.getByRole("button", { name: "Cerrar sesión" }).click();
          await page.getByLabel("Correo electrónico").waitFor();
        },
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await context.close();
  }
  console.log(
    "RESULTADO: " +
      passed +
      " recorridos de navegador con Supabase alojado real. Sin trazas, contraseñas ni QR en artefactos.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
