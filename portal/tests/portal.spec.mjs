import { test as base, expect } from "@playwright/test";
import { openStore, totp } from "../server/service.mjs";
import { createPortal } from "../server/server.mjs";
import { mkdirSync } from "node:fs";
const test = base.extend({
  app: async ({}, use) => {
    const store = openStore(),
      { server } = createPortal({ store });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    await use({ store, url: `http://127.0.0.1:${server.address().port}` });
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.db.close();
  },
});
const pw = {
  family: "Familia",
  adolescent: "Alex",
  other: "Lucia",
  limited: "Tomas",
  cenit: "Cenit",
  cenepsi: "Cenepsi",
  personal: "Personal",
  doctor: "Doctor",
};
async function login(page, app, account = "family") {
  await page.goto(app.url + "/portal/");
  await page
    .getByLabel("Correo electrónico")
    .fill(`${account}@example.invalid`);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(`${pw[account]}-Prueba-2026!`);
  const a = app.store.get("SELECT totp FROM accounts WHERE id=?", account);
  if (a.totp) await page.getByLabel("Segundo factor").fill(totp(a.totp));
  await page.getByRole("button", { name: "Entrar al portal" }).click();
  await expect(
    page.getByRole("button", { name: "Cerrar sesión" }),
  ).toBeVisible();
}
async function openRequest(page, name = "Certificado o justificante") {
  await page
    .getByRole("button", { name: "Mis solicitudes", exact: true })
    .first()
    .click();
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Antecedentes y respuestas" }),
  ).toBeVisible();
}
test("Advertencia sin sesión y validación de acceso", async ({ page, app }) => {
  await page.goto(app.url + "/portal/");
  await page.getByRole("button", { name: "Ayuda urgente" }).click();
  await expect(page.locator("#urgent")).toContainText(
    "No esperes una respuesta del Dr. Gómez",
  );
  await expect(page.locator("#urgent")).not.toContainText("131");
  await page.getByLabel("Correo electrónico").fill("no@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta");
  await page.getByRole("button", { name: "Entrar al portal" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Credenciales no válidas",
  );
});
test("Familia crea, revisa y amplía una solicitud sin aceptación automática", async ({
  page,
  app,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(app.url)) external.push(r.url());
  });
  await login(page, app);
  await page
    .getByRole("button", { name: "＋ Crear solicitud", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Centro asociado a esta solicitud")
    .selectOption("CENIT");
  await page
    .getByLabel("¿Qué documento necesitas?")
    .fill("Justificante ficticio para el colegio.");
  await page.getByLabel("¿Para qué lo necesitas?").fill("Acreditar asistencia");
  await page.getByLabel("¿A quién va dirigido?").fill("Colegio ficticio");
  await page.getByLabel("¿En qué fecha lo necesitas?").fill("2026-12-15");
  await page.getByRole("button", { name: "Revisar antes de enviar" }).click();
  await expect(page.getByText("Revisemos tu solicitud.")).toBeVisible();
  await expect(
    page.locator("dd").filter({ hasText: "Alex Prueba" }),
  ).toBeVisible();
  await page.getByLabel("He revisado el paciente y los destinatarios.").check();
  await page
    .getByRole("button", { name: "Enviar solicitud de prueba" })
    .click();
  await expect(
    page.getByText("Sin aceptación explícita de un profesional."),
  ).toBeVisible();
  await page
    .getByLabel("Mensaje", { exact: true })
    .fill("Añado información ficticia en el mismo hilo.");
  await page.getByRole("button", { name: "Añadir al hilo" }).click();
  await expect(
    page.getByText("Añado información ficticia en el mismo hilo.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(app.store.get("SELECT count(*) n FROM requests").n).toBe(5);
  expect(external).toEqual([]);
});
test("Señales en motivo administrativo muestran advertencia antes de enviar", async ({
  page,
  app,
}) => {
  await login(page, app);
  await page
    .getByRole("button", { name: "＋ Crear solicitud", exact: true })
    .first()
    .click();
  await page
    .getByLabel("¿Qué documento necesitas?")
    .fill("Solicito certificado. No puedo mantenerlo a salvo.");
  await expect(page.locator("#priority-warning")).toContainText(
    "busca asistencia de urgencia",
  );
  expect(app.store.get("SELECT count(*) n FROM requests").n).toBe(4);
});
for (const [role, own, other] of [
  ["cenit", "CENIT", "Cenepsi"],
  ["cenepsi", "Cenepsi", "CENIT"],
])
  test(`${role}: bandeja, API y controles rechazan el otro centro`, async ({
    page,
    app,
  }) => {
    await login(page, app, role);
    await page
      .getByRole("button", { name: "Bandeja de solicitudes", exact: true })
      .click();
    const centers = await page
      .locator("#request-list .center-tag")
      .allTextContents();
    expect(centers.every((c) => c === own)).toBeTruthy();
    const options = await page
      .locator("#filter-center option")
      .allTextContents();
    expect(options).not.toContain(other);
    const target = role === "cenit" ? "demo-cenepsi" : "demo-cenit";
    const res = await page.request.get(app.url + `/api/requests/${target}`);
    expect(res.status()).toBe(404);
    await page.locator("#request-list .request-card").first().click();
    await expect(page.getByText("Sin mensajes visibles")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Aprobar esta versión" }),
    ).toHaveCount(0);
  });
test("Coordinación reúne centros y mantiene confidencialidad del adolescente", async ({
  page,
  app,
}) => {
  await login(page, app, "personal");
  await page
    .getByRole("button", { name: "Bandeja de solicitudes", exact: true })
    .click();
  await page.locator("#filter-center").selectOption("CENIT");
  await expect(page.locator("#request-list .request-card")).toHaveCount(2);
  await page.locator("#filter-center").selectOption("Cenepsi");
  await expect(page.locator("#request-list .request-card")).toHaveCount(2);
  await page.locator("#filter-center").selectOption("");
  await expect(page.locator("#request-list .request-card")).toHaveCount(4);
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: "Cambio en el estado de salud",
        exact: true,
      }),
    })
    .click();
  await expect(page.getByText("Sin mensajes visibles")).toBeVisible();
  await expect(
    page.getByText("Prefiero conversar primero con el doctor.", {
      exact: false,
    }),
  ).toHaveCount(0);
});
test("Secretaría sube borrador privado; doctor aprueba y familia descarga", async ({
  page,
  app,
}) => {
  await login(page, app, "cenit");
  await page
    .getByRole("button", { name: "Bandeja de solicitudes", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: "Certificado o justificante",
        exact: true,
      }),
    })
    .click();
  await page
    .getByText("Subir documento o nueva versión", { exact: true })
    .click();
  await page
    .getByLabel("Archivo PDF")
    .setInputFiles({
      name: "certificado-demo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% Ficticio\n%%EOF"),
    });
  await page.getByLabel("Elena Prueba", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar borrador privado" }).click();
  await expect(
    page.getByText("Borrador pendiente de aprobación", { exact: false }),
  ).toBeVisible();
  const doc = app.store.get("SELECT id FROM documents");
  expect(app.store.detail("family", "demo-cenit").documents).toHaveLength(0);
  // Different individual account and second factor, then approval through the browser.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await login(page, app, "doctor");
  await page
    .getByRole("button", { name: "Bandeja de solicitudes", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: "Certificado o justificante",
        exact: true,
      }),
    })
    .click();
  await page.getByRole("button", { name: "Aprobar esta versión" }).click();
  await expect(
    page
      .locator(".document")
      .getByText("Aprobado por el doctor", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await login(page, app);
  await openRequest(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/documento/);
  expect(
    app.store.get("SELECT approved_by FROM documents WHERE id=?", doc.id)
      .approved_by,
  ).toBe("doctor");
});
test("Doctor ve original, acepta y registra actuación; IA sin proveedor conserva la solicitud", async ({
  page,
  app,
}) => {
  await login(page, app, "doctor");
  await page
    .getByRole("button", { name: "Bandeja de solicitudes", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: "Cambio en el estado de salud",
        exact: true,
      }),
    })
    .click();
  await expect(
    page.getByText("Me ha costado dormir desde ayer.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Aceptar explícitamente", exact: true })
    .click();
  await expect(
    page.getByText("Aceptación explícita registrada el", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Comprobar adaptador de observación" })
    .click();
  await expect(
    page.getByText("Estado: not_configured", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Registrar incorporación a ficha clínica" })
    .click();
  expect(
    app.store.get("SELECT recorded_at FROM requests WHERE id='demo-clinical'")
      .recorded_at,
  ).toBeTruthy();
});
test("Revocar desde coordinación bloquea a representante con sesión previa", async ({
  browser,
  page,
  app,
}) => {
  const family = await browser.newPage();
  await login(family, app);
  await openRequest(family);
  await login(page, app, "personal");
  await page
    .getByRole("button", { name: "Autorizaciones", exact: true })
    .click();
  const row = page
    .locator(".access-row")
    .filter({
      has: page.getByRole("heading", {
        name: "Elena Prueba → Alex Prueba",
        exact: true,
      }),
    });
  await row.getByRole("button", { name: "Revocar este vínculo" }).click();
  const result = await family.request.get(app.url + "/api/requests/demo-cenit");
  expect(result.status()).toBe(404);
  await family.close();
});
test("Diseño adaptable, teclado, ausencia de errores y captura del inicio", async ({
  page,
  app,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, app);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement.tagName !== "BODY"),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => document.activeElement.blur());
  const folder = process.env.PORTAL_SCREENSHOTS || "work/screenshots";
  mkdirSync(folder, { recursive: true });
  await page.screenshot({
    path: `${folder}/portal-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await openRequest(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
