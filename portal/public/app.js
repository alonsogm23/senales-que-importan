import { reasons, states, priorities, emergency, classify } from "./policy.js";
const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s, withTime = true) =>
  s
    ? new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" } : {}),
      }).format(new Date(s))
    : "Sin definir";
const roleNames = {
  family: "Paciente o representante",
  cenit: "Secretaría CENIT",
  cenepsi: "Secretaría Cenepsi",
  personal: "Secretaria personal",
  doctor: "Doctor · revisión médica",
};
const eventNames = {
  "request.saved": "Solicitud guardada",
  "request.seeded": "Solicitud ficticia creada",
  "request.accept": "Aceptación explícita del profesional",
  "request.assign": "Derivación registrada; requiere aceptación",
  "request.state": "Estado actualizado",
  "request.priority": "Prioridad revisada por el doctor",
  "request.center": "Asignación de centro modificada",
  "request.record": "Actuación incorporada a ficha clínica (registro manual)",
  "request.due": "Plazo operativo actualizado",
  "message.added": "Actuación registrada en el hilo",
  "document.draft": "Nueva versión de documento",
  "document.approved": "Documento aprobado por el doctor",
  "notification.test": "Intento de notificación de prueba",
  "ai.observed": "Evaluación de IA en observación",
};
const notificationNames = {
  available: "Notificación interna disponible",
  queued_test: "En cola de prueba; no enviada",
  held_coverage: "Pendiente: fuera de cobertura médica",
  provider_reported_test: "Entrega informada por proveedor simulado",
  failed_test: "Fallo de entrega simulado",
  cancelled_access: "Cancelada por cambio de acceso",
  needs_manual_escalation: "Requiere coordinación manual",
};
let data = null,
  publicData = null,
  csrf = "",
  page = "home",
  current = null,
  draft = {},
  step = 1,
  filter = {
    center: "",
    reason: "",
    priority: "",
    state: "",
    assigned: "",
    age: "",
    sort: "new",
    bucket: "all",
  };
let requestSequence = 0;
let mfaPending = null;
const priority = (p) =>
  `<span class="priority ${priorities[p].color}"><span aria-hidden="true">${priorities[p].icon}</span>${esc(priorities[p].name)}</span>`;
const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`;
const field = (name, label, type = "text", value = "", extra = "") =>
  `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const checked = (name, value, label, isChecked = false) =>
  `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${isChecked ? "checked" : ""}>${esc(label)}</label>`;
const doctor = () => data?.account.role === "doctor";
const staff = () => data?.account.role !== "family";
const errorBox = () =>
  '<div id="form-error" role="alert" tabindex="-1" hidden></div>';
const card = (r) =>
  `<button class="request-card" data-open="${esc(r.id)}"><div class="row between"><span class="tag center-tag">${esc(r.center || "Centro por resolver")}</span>${priority(r.priority)}</div><h3>${esc(reasons[r.reason])}</h3><p class="small muted no-margin">${esc(r.patient_name)} · ${esc(r.state)}</p><div class="bottom"><span>Creada ${date(r.created_at)}</span><span>${r.accepted_at ? "Aceptación explícita registrada" : "Sin aceptación profesional"} <span aria-hidden="true">→</span></span></div></button>`;
function toast(message) {
  $("#toast").textContent = message;
  setTimeout(() => {
    $("#toast").textContent = "";
  }, 6000);
}
function showError(message) {
  const box = $("#form-error");
  if (box) {
    box.className = "form-error";
    box.hidden = false;
    box.textContent = message;
    box.focus();
  } else toast(message);
}
async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await res.json();
  if (!res.ok) {
    if (res.status === 401 && data) {
      data = null;
      current = null;
      render();
    }
    throw new Error(value.error || "No pudimos completar la acción.");
  }
  return value;
}
function coverageCard() {
  const c = data?.coverage || publicData?.coverage;
  if (!c) return "";
  return `<div class="card coverage" data-coverage><div class="eyebrow">Horario de alertas médicas</div><h3>${c.active ? "Dentro del horario de alertas" : c.absent ? "Ausencia médica configurada" : "Fuera del horario de alertas"}</h3><p class="small">Lunes a viernes <strong>08:00–20:00</strong><br>Sábado y domingo <strong>08:00–13:00</strong><br>Hora de Chile · America/Santiago</p><p class="small no-margin">${c.active ? "El horario de alertas no garantiza una respuesta inmediata." : `No hay cobertura médica activa del portal. ${c.nextStart ? "El próximo horario de alertas comienza " + date(c.nextStart) + "." : "El retorno está pendiente de confirmar."} No se garantiza una respuesta al comenzar ese horario.`}</p></div>`;
}
const channelNotice = () =>
  `<div class="notice warn"><strong>Este portal no es un servicio de urgencias.</strong> Puedes registrar solicitudes las 24 horas. Si existe peligro inmediato, busca asistencia de urgencia ahora. No esperes una respuesta del doctor. <button class="text-button" data-urgent>Leer advertencia completa ↗</button></div>`;
function urgent() {
  const el = $("#urgent");
  el.innerHTML = `<div class="notice red"><h2>Posible emergencia</h2><p class="emergency-copy">${esc(emergency)}</p><p class="small">Contenido inicial pendiente de aprobación médica.</p><button class="danger" id="urgent-close">Ocultar aviso</button></div>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: "instant", block: "start" });
  $("#urgent-close").onclick = () => {
    el.hidden = true;
  };
}
$("#emergency-toggle").onclick = urgent;
function navigation() {
  const a = data?.account;
  $("#sidebar").innerHTML = a
    ? `<div class="identity"><div class="avatar" aria-hidden="true">${esc(a.name.charAt(0))}</div><strong>${esc(a.name)}</strong><small>${esc(roleNames[a.role])}</small></div>${[["home", staff() ? "Resumen" : "Inicio", "⌂"], ["requests", staff() ? "Bandeja de solicitudes" : "Mis solicitudes", "▤"], ...(!staff() ? [["create", "Crear solicitud", "＋"]] : []), ["notifications", "Notificaciones", "◷"], ...(["personal", "doctor"].includes(a.role) ? [["access", "Autorizaciones", "◇"]] : []), ...(doctor() ? [["settings", "Cobertura y reglas", "⚙"]] : [])].map(([id, label, icon]) => `<button class="side-link ${page === id ? "active" : ""}" data-page="${id}" ${page === id ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span> ${label}</button>`).join("")}<p class="side-note">Solicitudes, no chat en vivo.<br>Las notificaciones no indican presencia de una persona.</p><button class="side-link" id="logout">Cerrar sesión ↪</button>`
    : `<div class="identity"><div class="avatar" aria-hidden="true">＋</div><strong>Un espacio para tu atención</strong><small>CENIT · Cenepsi</small></div><button class="side-link active">Acceso personal</button><p class="side-note">Cada persona utiliza su propia cuenta. El RUT no permite acceder a un paciente.</p>`;
}
function render() {
  navigation();
  const main = $("#main");
  if (mfaPending) { renderMfa(); bind(); return; }
  if (!data) {
    main.innerHTML = `<div class="login"><div class="eyebrow">Portal de pacientes</div><h1>Seguimos acompañándote.</h1><p class="muted">Solicitudes, documentos y seguimiento en un mismo lugar.</p>${channelNotice()}<div class="card"><h2>Ingresa a tu cuenta</h2><p class="small muted">Usa tu cuenta personal. Nunca una contraseña compartida por centro.</p><form id="login-form">${errorBox()}${field("email", "Correo electrónico", "email", "", 'required autocomplete="username" maxlength="254"')}${field("password", "Contraseña", "password", "", 'required autocomplete="current-password" maxlength="256"')}${field("code", "Segundo factor (solo profesionales)", "text", "", 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}<button type="submit">Entrar al portal →</button></form></div><details><summary>Acceso a la demostración</summary><p class="small">Utiliza las credenciales individuales entregadas por el operador de la prueba. Los profesionales necesitan además su autenticador personal. El rol se asigna en el servidor.</p></details><p class="small muted">El alta y la representación requieren revisión administrativa. Verificar correo o teléfono no demuestra representación legal. Esta prueba no admite altas de pacientes reales.</p>${coverageCard()}</div>`;
    bind();
    return;
  }
  if (page === "home") home();
  if (page === "requests") list();
  if (page === "create") createForm();
  if (page === "detail" && current) detail();
  if (page === "notifications") notifications();
  if (page === "access") access();
  if (page === "settings") settings();
  bind();
}
function renderMfa() {
 $('#main').innerHTML=`<div class="login"><div class="eyebrow">Cuenta profesional individual</div><h1>Verifica tu segundo factor</h1><div class="card">${errorBox()}<p class="muted">Los permisos profesionales permanecen bloqueados hasta verificar tu autenticador personal.</p>${mfaPending.enrollmentNeeded?`<p>Primero configura un autenticador para esta cuenta ficticia. El secreto se muestra solo durante este paso y no se guarda en el navegador.</p>${mfaPending.secret?`<img class="mfa-qr" src="${esc(mfaPending.qrCode)}" alt="Código QR para configurar tu autenticador personal"><label for="mfa-secret">Clave de configuración manual</label><input id="mfa-secret" readonly value="${esc(mfaPending.secret)}" autocomplete="off"><p class="small muted">No compartas esta clave ni captures esta pantalla.</p>`:'<button id="mfa-enroll">Configurar mi autenticador</button>'}`:''}${mfaPending.factorId?`<form id="mfa-form">${field('mfa-code','Código del autenticador','text','','required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"')}<button type="submit">Verificar y entrar</button></form>`:''}<button class="text-button" id="mfa-cancel">Salir de esta cuenta</button></div></div>`;
}
function home() {
  const list = data.requests;
  $("#main").innerHTML =
    `<section class="welcome"><div><div class="eyebrow">${staff() ? "Espacio profesional" : "Portal de pacientes · CENIT y Cenepsi"}</div><h1>${staff() ? "Cada solicitud, un siguiente paso." : "Qué bueno tenerte por aquí."}</h1><p class="muted">${staff() ? "Coordina gestiones, revisa pendientes y registra cada actuación. Las decisiones clínicas corresponden al doctor." : "Un espacio para pedir documentos, resolver gestiones y comunicarte con el equipo del Dr. Gómez."}</p><div class="row"><button data-page="${staff() ? "requests" : "create"}">${staff() ? "Abrir bandeja" : "＋ Crear solicitud"}</button><button class="secondary" data-page="${staff() ? "notifications" : "requests"}">${staff() ? "Ver notificaciones" : "Mis solicitudes →"}</button></div></div></section>${channelNotice()}${staff() ? stats() : ""}<div class="grid"><div class="card"><div class="icon-circle" aria-hidden="true">◇</div><h3>${staff() ? "Tu ámbito de trabajo" : "Una cuenta, vínculos verificados"}</h3><p class="small muted">${staff() ? `${esc(roleNames[data.account.role])}. ${["personal", "doctor"].includes(data.account.role) ? "Gestión de ambos centros." : "Acceso exclusivo a tu centro."} Las conversaciones clínicas tienen permisos separados.` : data.patients.length ? data.patients.map((p) => `<strong>${esc(p.name)}</strong> · ${p.centers.map(esc).join(" / ")}<br>Permisos: ${[p.manage ? "trámites" : "", p.submit ? "enviar antecedentes" : "", p.clinical ? "consultar contenido clínico autorizado" : ""].filter(Boolean).join(", ")}`).join("<br><br>") : "No hay vínculos vigentes. Se requiere revisión administrativa."}</p><p class="small muted no-margin">Los casos de representación dudosa, cambios de cuidador o restricciones judiciales requieren revisión humana.</p></div>${coverageCard()}</div><div class="section-title"><h2>${staff() ? "Solicitudes recientes" : "Tus solicitudes recientes"}</h2><button class="text-button" data-page="requests">Ver todas →</button></div>${list.length ? list.slice(0, 3).map(card).join("") : empty("Aún no hay solicitudes", "Cuando registres una solicitud, podrás seguir sus avances aquí.")}<div class="section-title"><h2>Cómo se organiza la revisión</h2></div><div class="legend">${priorities.map((p, i) => `<div class="card">${priority(i)}<p>${["Trámites habituales.", "Coordinación preferente.", "Revisión médica prioritaria.", "Busca asistencia de urgencia."][i]}</p></div>`).join("")}</div><p class="small muted legend-note">Las prioridades organizan la revisión; no son un diagnóstico ni una predicción de riesgo. Verde no demuestra que sea seguro esperar. Reglas ilustrativas pendientes de validación médica.</p>`;
}
function empty(title, copy) {
  return `<div class="card empty"><div class="symbol" aria-hidden="true">▤</div><h3>${esc(title)}</h3><p class="small no-margin">${esc(copy)}</p></div>`;
}
function stats() {
  const r = data.requests;
  return `<div class="stats">${[
    [
      r.filter((x) => !x.accepted_at && x.priority >= 2).length,
      "Prioritarias sin aceptación",
    ],
    [r.filter((x) => x.state === "Registrada").length, "Nuevas solicitudes"],
    [
      r.filter((x) => x.state === "Pendiente de información del solicitante")
        .length,
      "Pendientes de información",
    ],
    [
      r.filter(
        (x) =>
          x.due_at &&
          Date.parse(x.due_at) < Date.now() &&
          x.state !== "Cerrada",
      ).length,
      "Plazo operativo vencido",
    ],
  ]
    .map(([n, label]) => `<div class="stat"><b>${n}</b>${label}</div>`)
    .join("")}</div>`;
}
const buckets = [
  ["all", "Todas"],
  ["priority", "Prioritarias sin aceptación"],
  ["new", "Nuevas"],
  ["mine", "Asignadas a mí"],
  ["info", "Pendientes de información"],
  ["documents", "Documentos por aprobar"],
  ["unaccepted", "Derivaciones sin aceptación"],
  ["overdue", "Plazo vencido"],
];
function list() {
  const centers = ["personal", "doctor"].includes(data.account.role)
    ? ["CENIT", "Cenepsi"]
    : data.account.role === "cenit"
      ? ["CENIT"]
      : data.account.role === "cenepsi"
        ? ["Cenepsi"]
        : ["CENIT", "Cenepsi"];
  const selected = (key, values, label) =>
    `<div class="field"><label for="filter-${key}">${label}</label><select id="filter-${key}" data-filter="${key}">${option("", "Todos", filter[key])}${values.map(([v, l]) => option(v, l, filter[key])).join("")}</select></div>`;
  $("#main").innerHTML =
    `<div class="page-head"><div><div class="eyebrow">${staff() ? "Gestión del equipo" : "Seguimiento"}</div><h1>${staff() ? "Bandeja de solicitudes" : "Mis solicitudes"}</h1><p class="small muted">${staff() ? "Filtros sobre el ámbito autorizado de tu cuenta. Aceptar una derivación es una acción explícita." : "Consulta el estado o añade información en el mismo hilo. No necesitas enviar otra solicitud."}</p></div>${!staff() ? '<button data-page="create">＋ Crear solicitud</button>' : ""}</div>${staff() ? stats() : ""}${errorBox()}${staff() ? `<div class="tabs" aria-label="Bandejas">${buckets.map(([v, l]) => `<button class="${filter.bucket === v ? "active" : ""}" data-bucket="${v}" aria-pressed="${filter.bucket === v}">${l}</button>`).join("")}</div>` : ""}<div class="filters">${selected(
      "center",
      centers.map((v) => [v, v]),
      "Centro",
    )}${selected(
      "reason",
      reasons.map((v, i) => [i, v]),
      "Motivo",
    )}${selected(
      "priority",
      priorities.map((v, i) => [i, v.name]),
      "Prioridad",
    )}${selected(
      "state",
      states.map((v) => [v, v]),
      "Estado",
    )}${
      staff()
        ? selected(
            "assigned",
            data.staff.map((a) => [a.id, a.name]),
            "Responsable",
          )
        : ""
    }${selected(
      "age",
      [
        [1, "Últimas 24 horas"],
        [7, "Últimos 7 días"],
        [30, "Últimos 30 días"],
      ],
      "Antigüedad",
    )}</div><div id="request-list"><p role="status">Cargando solicitudes…</p></div><p class="small muted">Solicitud guardada ≠ notificación enviada ≠ entrega informada ≠ aceptación profesional ≠ actuación registrada.</p>`;
  fillList();
}
async function fillList() {
  const seq = ++requestSequence;
  let r = data.requests.filter((r) =>
    Object.entries(filter).every(([k, v]) =>
      !v || ["bucket", "sort"].includes(k) || k === "age"
        ? k !== "age" ||
          !v ||
          Date.now() - Date.parse(r.created_at) <= Number(v) * 86400000
        : String(r[k]) === v,
    ),
  );
  const b = filter.bucket;
  if (b === "priority") r = r.filter((x) => x.priority >= 2 && !x.accepted_at);
  if (b === "new")
    r = r.filter((x) =>
      ["Registrada", "Pendiente de asignación"].includes(x.state),
    );
  if (b === "mine") r = r.filter((x) => x.assigned === data.account.id);
  if (b === "info")
    r = r.filter((x) => x.state === "Pendiente de información del solicitante");
  if (b === "unaccepted") r = r.filter((x) => x.assigned && !x.accepted_at);
  if (b === "overdue")
    r = r.filter(
      (x) =>
        x.due_at && Date.parse(x.due_at) < Date.now() && x.state !== "Cerrada",
    );
  if (b === "documents") {
    try {
      const details = await Promise.all(r.map((x) => api(`requests/${x.id}`)));
      r = r.filter((_, i) => details[i].documents.some((d) => !d.approved_by));
    } catch (e) {
      showError(e.message);
      return;
    }
  }
  if (seq !== requestSequence || !$("#request-list")) return;
  $("#request-list").innerHTML = r.length
    ? r.map(card).join("")
    : empty(
        "No hay solicitudes en esta vista",
        "Prueba con otros filtros o revisa nuevamente más adelante.",
      );
  bindOpen();
}
function captureDraft() {
  const form = $("#request-form");
  if (form) {
    draft = {
      ...draft,
      ...Object.fromEntries(new FormData(form)),
      audience: new FormData(form).getAll("audience"),
    };
  }
}
function createForm() {
  if (staff()) {
    page = "home";
    home();
    return;
  }
  if (!data.patients.some((p) => p.submit || p.manage)) {
    $("#main").innerHTML = empty(
      "Se requiere autorización",
      "No hay vínculos con permiso vigente para tramitar o enviar antecedentes. Solicita revisión administrativa.",
    );
    return;
  }
  const p =
    data.patients.find((p) => p.id === draft.patient) ||
    data.patients.find((p) => p.submit || p.manage);
  draft.patient = p.id;
  if (
    draft.reason === undefined ||
    ([0, 1].includes(Number(draft.reason)) ? !p.manage : !p.submit)
  )
    draft.reason = p.manage ? "0" : "2";
  if (draft.center === undefined)
    draft.center = p.centers.length === 1 ? p.centers[0] : "";
  const reason = Number(draft.reason),
    audience =
      draft.audience ||
      p.recipients
        .filter((a) => a.account === data.account.id)
        .map((a) => a.account);
  draft.audience = audience;
  if (step === 2) {
    review();
    return;
  }
  $("#main").innerHTML =
    `<div class="eyebrow">Una solicitud, un hilo de seguimiento</div><h1>¿En qué podemos ayudarte?</h1><p class="muted">Cuéntanos lo necesario. El equipo revisará a quién corresponde gestionar tu solicitud.</p><div class="steps"><strong>1. Tu solicitud</strong><span>→</span><span>2. Revisa y envía</span></div>${channelNotice()}<form id="request-form" class="card">${errorBox()}<div class="grid"><div class="field"><label for="patient">¿En nombre de quién envías?</label><select id="patient" name="patient">${data.patients
      .filter((p) => p.submit || p.manage)
      .map((a) => option(a.id, a.name, draft.patient))
      .join(
        "",
      )}</select><small>Solo se muestran vínculos verificados y vigentes.</small></div><div class="field"><label for="center">Centro asociado a esta solicitud</label><select id="center" name="center">${option("", "Necesito ayuda para resolverlo", draft.center)}${p.centers.map((c) => option(c, c, draft.center)).join("")}</select><small>Si hay duda, coordinación revisará la asignación. No se enviará a ambas secretarías.</small></div></div><div class="field"><label for="reason">Motivo</label><select id="reason" name="reason">${reasons
      .map((r, i) => [i, r])
      .filter(([i]) => ([0, 1].includes(i) ? p.manage : p.submit))
      .map(([i, r]) => option(i, r, draft.reason))
      .join(
        "",
      )}</select></div><div class="field"><label for="description">${reason === 0 ? "¿Qué documento necesitas?" : "Cuéntanos qué sucede o qué necesitas"}</label><textarea id="description" name="description" required maxlength="6000" placeholder="Escribe aquí tu solicitud ficticia…">${esc(draft.description || "")}</textarea><small>El texto libre se protege como antecedente confidencial, incluso si el motivo es administrativo.</small></div><div id="priority-warning" aria-live="assertive"></div>${reason === 0 ? `<div class="grid">${field("purpose", "¿Para qué lo necesitas?", "text", draft.purpose, 'required maxlength="300"')}${field("destination", "¿A quién va dirigido?", "text", draft.destination, 'required maxlength="300"')}</div>${field("needed", "¿En qué fecha lo necesitas?", "date", draft.needed, "required")}<p class="small muted">La fecha solicitada no confirma un plazo de entrega. Evita pedir diagnósticos si solo se necesita justificar asistencia. Este portal no emite licencias médicas.</p>` : [2, 3].includes(reason) ? `${field("since", "¿Desde cuándo sucede?", "text", draft.since, 'required maxlength="300"')}<div class="field"><label for="current">¿Está ocurriendo actualmente?</label><select id="current" name="current" required>${option("", "Selecciona una opción", draft.current)}${["Sí", "No", "No lo tengo claro"].map((v) => option(v, v, draft.current)).join("")}</select></div>${field("contact", "Contacto seguro e indicaciones de privacidad", "text", draft.contact, 'required maxlength="300"')}<p class="small muted">Preguntas iniciales de prueba pendientes de aprobación del doctor. No constituyen un protocolo clínico validado.</p>` : ""}<fieldset><legend>¿Quién puede consultar este contenido?</legend><p class="small muted">El doctor y tú como remitente. Puedes incluir a personas con permiso clínico vigente. No se comparte automáticamente con todos los familiares. La confidencialidad tiene límites legales y asistenciales que requieren evaluación profesional.</p>${p.recipients
      .filter((a) => a.account !== data.account.id)
      .map((a) =>
        checked("audience", a.account, a.name, audience.includes(a.account)),
      )
      .join(
        "",
      )}${p.recipients.some((a) => a.account === data.account.id) ? `<input type="hidden" name="audience" value="${esc(data.account.id)}">` : ""}</fieldset><div class="form-actions"><button type="button" class="secondary" data-page="home">Cancelar</button><button type="submit">Revisar antes de enviar →</button></div></form>`;
  warning();
}
function warning() {
  const el = $("#priority-warning");
  if (!el) return;
  const form = $("#request-form");
  const body = form
    ? [...new FormData(form).entries()]
        .filter(([k]) =>
          [
            "description",
            "purpose",
            "destination",
            "since",
            "current",
            "contact",
          ].includes(k),
        )
        .map(([, v]) => v)
        .join(" ")
    : "";
  const p = classify(body, Number($("#reason").value), data.rules);
  el.innerHTML =
    p === 3
      ? `<div class="notice red emergency-copy" role="alert">${esc(emergency)}<p class="small">Aviso de prueba pendiente de aprobación médica. Puedes continuar registrando la solicitud; no confirma lectura.</p></div>`
      : p === 2
        ? '<div class="notice warn">Este mensaje se señalará para revisión médica prioritaria. Si existe peligro inmediato, busca asistencia de urgencia ahora. No esperes respuesta del portal.</div>'
        : "";
}
function review() {
  const p = data.patients.find((p) => p.id === draft.patient);
  const selected = p.recipients.filter(
    (a) => a.account !== data.account.id && draft.audience.includes(a.account),
  );
  $("#main").innerHTML =
    `<div class="eyebrow">Antes de enviar</div><h1>Revisemos tu solicitud.</h1><div class="steps"><span>1. Tu solicitud</span><span>→</span><strong>2. Revisa y envía</strong></div>${channelNotice()}<form id="send-form" class="card">${errorBox()}<dl><dt>Paciente</dt><dd><strong>${esc(p.name)}</strong></dd><dt>Envía</dt><dd>${esc(data.account.name)}</dd><dt>Centro</dt><dd>${esc(draft.center || "Pendiente de asignación por coordinación")}</dd><dt>Motivo</dt><dd>${esc(reasons[Number(draft.reason)])}</dd><dt>Contenido confidencial</dt><dd>Doctor, tú como remitente${selected.length ? " y " + selected.map((a) => esc(a.name)).join(", ") : ""}</dd><dt>Gestión administrativa</dt><dd>Secretaría del centro asignado y secretaria personal. Sin acceso automático al contenido confidencial.</dd></dl><p class="review-copy">${esc(draft.description)}${Number(draft.reason) === 0 ? `\n\nFinalidad: ${esc(draft.purpose)}\nDestinatario del documento: ${esc(draft.destination)}\nFecha solicitada: ${esc(draft.needed)}` : [2, 3].includes(Number(draft.reason)) ? `\n\nDesde: ${esc(draft.since)}\nActualmente: ${esc(draft.current)}\nContacto seguro: ${esc(draft.contact)}` : ""}</p>${classify(Object.values(draft).join(" "), Number(draft.reason), data.rules) === 3 ? `<div class="notice red emergency-copy">${esc(emergency)}</div>` : ""}${checked("confirmation", "yes", "He revisado el paciente y los destinatarios.")}<p class="small muted">El registro confirma que la solicitud se guardó. No confirma lectura, aceptación médica ni tiempo de respuesta.</p><div class="form-actions"><button type="button" id="edit-draft" class="secondary">← Editar</button><button type="submit">Enviar solicitud de prueba</button></div></form>`;
}
function recipientChecks(items, defaultAudience = [], name = "audience") {
  return items
    .map((a) =>
      checked(name, a.account, a.name, defaultAudience.includes(a.account)),
    )
    .join("");
}
function detail() {
  const r = current,
    a = data.account;
  const clinical = r.permissions.clinical;
  $("#main").innerHTML =
    `<button class="text-button" data-page="requests">← Volver a solicitudes</button><div class="page-head"><div><div class="eyebrow">${esc(r.center || "Pendiente de asignación")} · ${esc(r.patient_name)}</div><h1>${esc(reasons[r.reason])}</h1><p class="small muted">Creada el ${date(r.created_at)} · ${esc(r.state)}</p>${priority(r.priority)}</div>${r.permissions.professional ? '<button id="accept">Aceptar explícitamente</button>' : ""}</div>${r.priority === 3 ? `<div class="notice red emergency-copy" role="alert">${esc(emergency)}<p class="small">Contenido inicial pendiente de aprobación médica.</p></div>` : channelNotice()}${errorBox()}<div class="notice"><strong>Solicitud guardada.</strong> ${r.accepted_at ? `Aceptación explícita registrada el ${date(r.accepted_at)}.` : "Sin aceptación explícita de un profesional."} Los correos y sus aperturas no equivalen a asumir la solicitud.</div><div class="detail-grid"><section><div class="card"><h2>Antecedentes y respuestas</h2><p class="small muted">Este hilo permite añadir información. No es un chat con disponibilidad permanente.</p>${r.messages.length ? r.messages.map((m) => `<article class="message ${m.kind}"><div class="row between"><strong class="small">${m.author === a.id ? "Tú" : esc(m.author_name || "Cuenta autorizada")}</strong><span class="tag">${m.kind === "clinical" ? "Contenido restringido" : "Gestión administrativa"}</span></div><p>${esc(m.body)}</p><small>${date(m.created_at)} · ${m.kind === "clinical" ? "Doctor, remitente y destinatarios autorizados" : "Visible para la gestión autorizada de esta solicitud"}</small></article>`).join("") : empty("Sin mensajes visibles", "Puedes gestionar el estado. Los antecedentes confidenciales están restringidos.")}<p class="small muted">${staff() && !doctor() ? "Tu perfil permite coordinar la solicitud. El doctor revisa el contenido clínico restringido." : "Los permisos y la selección de destinatarios se comprueban cada vez que se accede."}</p>${r.state !== "Cerrada" ? `<form id="message-form"><h3>${staff() ? "Registrar respuesta o aclaración" : "Añadir información"}</h3>${doctor() ? '<div class="field"><label for="kind">Tipo de mensaje</label><select name="kind" id="kind"><option value="clinical">Clínico restringido</option><option value="administrative">Administrativo, visible a la gestión</option></select></div>' : `<input type="hidden" name="kind" value="${staff() ? "administrative" : "clinical"}">`}<div class="field"><label for="body">Mensaje</label><textarea name="body" id="body" required maxlength="6000"></textarea></div>${clinical ? `<fieldset><legend>Destinatarios clínicos adicionales</legend>${doctor() ? '<p class="small muted">Sin destinatarios familiares, se guarda como nota restringida al doctor. Selecciona explícitamente a quién responder.</p>' : ""}${recipientChecks(r.recipients, r.requester === a.id ? [a.id] : [])}</fieldset>` : ""}${staff() && !doctor() ? '<p class="small muted">Solo datos administrativos. No incluyas diagnósticos ni decisiones sobre tratamientos.</p>' : ""}<button type="submit">${staff() ? "Registrar respuesta" : "Añadir al hilo"}</button>${doctor() ? '<p class="small muted">Puedes responder, pedir información o indicar que se necesita una consulta. Registra después el estado correspondiente.</p>' : ""}</form>` : ""}</div><div class="card"><h2>Documentos</h2><p class="small muted">Versiones privadas. Solo se entregan a destinatarios autorizados después de aprobación médica.</p>${r.documents.length ? r.documents.map((d) => `<div class="document"><strong>${esc(d.filename)}</strong><p class="small muted no-margin">Versión ${d.version} · ${d.clinical ? "Clínico restringido" : "Administrativo"} · ${d.approved_by ? "Aprobado por el doctor" : "Borrador pendiente de aprobación"}</p><div class="row"><button class="secondary" data-download="${d.id}">Descargar${d.approved_by ? "" : " borrador"}</button>${doctor() && !d.approved_by ? `<button data-approve="${d.id}">Aprobar esta versión</button>` : ""}</div></div>`).join("") : '<p class="small muted">No hay documentos disponibles para tu cuenta.</p>'}${staff() ? `<details><summary>Subir documento o nueva versión</summary><form id="document-form"><p class="small muted">Solo documentos ficticios. Justificantes sin diagnósticos innecesarios. No se emiten licencias médicas.</p><div class="field"><label for="file">Archivo PDF, PNG o JPEG (máximo 2 MB)</label><input id="file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required></div><div class="field"><label for="previous">Versión</label><select id="previous" name="previous">${option("", "Nuevo documento", "")}${r.documents.map((d) => option(d.id, `${d.filename} · v${d.version}`, "")).join("")}</select></div>${doctor() ? checked("clinical", "yes", "Contenido clínico restringido") : ""}<fieldset id="doc-audience"><legend>Destinatarios de la entrega</legend>${recipientChecks(r.administrativeRecipients, [], "docAudience")}</fieldset><button type="submit">Guardar borrador privado</button></form></details>` : ""}</div>${doctor() ? `<div class="card"><h2>IA de apoyo · observación</h2><p class="small muted">Proveedor no configurado. La solicitud y el texto original se conservan. Ninguna sugerencia modifica la prioridad.</p>${r.observation?.status === "observation_only" ? observationView(r.observation) : `<p class="small">Estado: ${esc(r.observation?.status || "not_configured")}</p>`}<button id="observe" class="secondary">Comprobar adaptador de observación</button></div>` : ""}</section><aside class="detail-aside"><div class="card"><h3>Seguimiento</h3><dl><dt>Estado</dt><dd>${esc(r.state)}</dd><dt>Responsable</dt><dd>${esc(data.staff?.find((a) => a.id === r.assigned)?.name || "Sin asignar")}</dd><dt>Aceptación</dt><dd>${r.accepted_at ? date(r.accepted_at) : "Pendiente"}</dd><dt>Plazo operativo</dt><dd>${date(r.due_at)}</dd>${r.recorded_at ? `<dt>Ficha clínica</dt><dd>Incorporación registrada: ${date(r.recorded_at)}</dd>` : ""}</dl></div>${staff() ? actions(r) : ""}<div class="card"><h3>Cronología</h3><ol class="timeline">${r.timeline.map((e) => `<li>${esc(eventNames[e.action] || "Actuación registrada")}<time>${date(e.at)}</time></li>`).join("")}</ol></div>${coverageCard()}</aside></div>`;
}
function observationView(observation) {
 const value=JSON.parse(observation.payload);
 return `<div class="notice"><strong>IA en observación · sugerencias sin validación</strong><p>${esc(value.summary)}</p><h3>Fragmentos del original</h3>${value.fragments.map(f=>`<blockquote>${esc(f)}</blockquote>`).join('')}<p class="small">Información faltante: ${value.missing.length?value.missing.map(esc).join('; '):'Sin sugerencias.'}</p><p class="small">Motivo sugerido: ${value.suggestedReason===null?'Sin sugerencia':esc(reasons[value.suggestedReason])}</p><p class="small">Prioridad sugerida: ${esc(priorities[value.suggestedPriority].name)}. Requiere revisión del doctor; no se aplica automáticamente.</p></div>`;
}
function actions(r) {
  return `<div class="card"><h3>Gestionar solicitud</h3><form id="state-form"><div class="field"><label for="state">Actualizar estado</label><select id="state" name="state">${states
    .filter(
      (s) =>
        doctor() ||
        !["En revisión médica", "Respondida", "Cerrada"].includes(s),
    )
    .map((s) => option(s, s, r.state))
    .join(
      "",
    )}</select></div><button class="secondary" type="submit">Guardar estado</button></form><details><summary>Derivar o asignar</summary><form id="assign-form"><div class="field"><label for="assigned">Responsable</label><select id="assigned" name="assigned">${data.staff
    .filter(
      (a) =>
        a.role === "doctor" ||
        a.role === "personal" ||
        (a.role === "cenit" && r.center === "CENIT") ||
        (a.role === "cenepsi" && r.center === "Cenepsi"),
    )
    .map((a) => option(a.id, a.name, r.assigned))
    .join(
      "",
    )}</select></div><button type="submit">Derivar, sin aceptación automática</button></form></details><details><summary>Plazo de coordinación</summary><form id="due-form">${field("due", "Fecha y hora local de tu dispositivo", "datetime-local", "", "required")}<p class="small muted">Acuerdo operativo de prueba, pendiente de aprobación. No es un estándar médico.</p><button type="submit">Registrar plazo</button></form></details>${["doctor", "personal"].includes(data.account.role) ? `<details><summary>Resolver centro asociado</summary><form id="center-form"><div class="field"><label for="center-change">Centro verificado</label><select name="center" id="center-change">${["CENIT", "Cenepsi"].map((c) => option(c, c, r.center)).join("")}</select></div>${field("center-reason", "Motivo administrativo", "text", "", 'required maxlength="500"')}<p class="small muted">El servidor comprueba la relación. Cambiar el centro no abre conversaciones previas a la nueva secretaría.</p><button type="submit">Cambiar asignación</button></form></details>` : ""}${doctor() ? `<details><summary>Cambiar prioridad con motivo</summary><form id="priority-form"><div class="field"><label for="priority">Prioridad operativa</label><select id="priority" name="priority">${priorities.map((p, i) => option(i, p.name, r.priority)).join("")}</select></div>${field("priority-reason", "Motivo de la decisión (restringido)", "text", "", 'required maxlength="500"')}<button type="submit">Registrar revisión médica</button></form></details><button id="record" class="secondary">Registrar incorporación a ficha clínica</button><p class="small muted">Registro manual; no hay integración con una ficha clínica externa.</p>` : ""}</div>`;
}
function notifications() {
  $("#main").innerHTML =
    `<div class="eyebrow">Seguimiento de avisos</div><h1>Notificaciones</h1><p class="muted">Una notificación disponible o entregada no confirma lectura ni aceptación del profesional.</p>${errorBox()}<div class="notice warn">Versión de prueba: no se envían correos, mensajes ni SMS reales. El correo preparado solo dice «Tienes una actualización en el portal. Ingresa con tu cuenta personal».</div>${data.notices.length ? data.notices.map((n) => `<div class="card"><div class="row between"><strong>${esc(notificationNames[n.status] || n.status)}</strong><span class="tag">${esc(n.channel)}</span></div><p class="small muted">${date(n.created_at)}</p><button class="text-button" data-open="${esc(n.request)}">Abrir solicitud autorizada →</button></div>`).join("") : empty("Sin notificaciones", "Los avisos aparecerán aquí.")} ${staff() ? `<div class="card"><h2>Mis avisos</h2><p class="small muted">La disponibilidad de notificaciones no implica presencia efectiva. Las secretarías pueden recibir avisos las 24 horas en su centro autorizado.</p><form id="preferences-form"><fieldset><legend>Prioridades que quieres recibir</legend>${priorities.map((p, i) => checked("priorities", i, p.name, data.preferences.includes(i))).join("")}</fieldset><button type="submit">Guardar preferencias</button></form></div>` : ""}${doctor() ? `<div class="card"><h2>Simular entrega</h2><p class="small muted">El segundo canal es un adaptador de prueba. Los avisos al doctor se conservan fuera de cobertura. Los reintentos requieren configuración operativa.</p><div class="row"><button data-notify="delivered">Simular entrega del proveedor</button><button class="secondary" data-notify="failed">Simular fallo de entrega</button></div></div>` : ""}`;
}
function access() {
  if (!["personal", "doctor"].includes(data.account.role)) {
    page = "home";
    home();
    return;
  }
  $("#main").innerHTML =
    `<div class="eyebrow">Autorizaciones verificadas</div><h1>Vínculos y revisión de accesos</h1><p class="muted">Verificar un teléfono, correo o RUT no demuestra representación legal. Los casos dudosos y las restricciones judiciales requieren revisión humana.</p>${errorBox()}<div class="notice warn">Solo vínculos ficticios. Al llegar a la fecha de revisión, el acceso se bloquea hasta una nueva verificación. La mayoría de edad requiere revisar las autorizaciones.</div><div class="card">${data.grants.map((g) => `<section class="access-row"><h3>${esc(g.account_name)} → ${esc(g.patient_name)}</h3><p class="small">${g.revoked_at ? "Revocado" : g.review_on && g.review_on <= new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()) ? "Bloqueado: revisión vencida" : "Vínculo vigente"} · ${[g.manage ? "gestiona trámites" : "", g.submit ? "envía antecedentes" : "", g.clinical ? "consulta contenido clínico según destinatarios" : ""].filter(Boolean).join(" · ")}</p><p class="small muted">Próxima revisión: ${esc(g.review_on || "Paciente titular; sin revisión de representación")}</p>${!g.revoked_at ? `<button class="danger" data-revoke="${g.id}">Revocar este vínculo</button>` : ""}<details><summary>Registrar revisión administrativa ficticia</summary><form data-grant="${g.id}">${field(`evidence-${g.id}`, "Referencia del expediente de verificación (sin contenido sensible)", "text", "", 'required maxlength="120" pattern="[A-Za-z0-9_-]{4,120}"')}${field(`review-${g.id}`, "Próxima revisión de permisos", "date", "", "required")}<fieldset><legend>Permisos comprobados por revisión humana</legend>${checked("manage", "yes", "Gestionar trámites", !!g.manage)}${checked("submit", "yes", "Enviar antecedentes", !!g.submit)}${checked("clinical", "yes", "Consultar contenido clínico seleccionado", !!g.clinical)}</fieldset>${checked("verified", "yes", "He comprobado la autorización y posibles restricciones en este caso ficticio.")}<button type="submit">Registrar revisión y permisos</button></form></details></section>`).join("")}</div><p class="small muted">Esta pantalla no asigna roles profesionales ni crea pacientes a partir de un RUT. El alta inicial de cuentas y vínculos pertenece al procedimiento de servidor documentado.</p>`;
}
function settings() {
  if (!doctor()) {
    page = "home";
    home();
    return;
  }
  const { absence, delivery } = data.settings;
  $("#main").innerHTML =
    `<div class="eyebrow">Configuración de prueba</div><h1>Cobertura, avisos y reglas</h1>${errorBox()}${coverageCard()}<div class="card"><h2>Vacaciones o ausencia imprevista</h2><form id="absence-form">${checked("enabled", "yes", "Sin cobertura médica activa del portal", absence.enabled)}${field("until", "Fin de ausencia (hora local del dispositivo, opcional)", "datetime-local", "", "")}<p class="small muted">Si no indicas retorno, quedará pendiente de confirmar. No existe un profesional de respaldo autorizado en esta prueba. Los pendientes se conservan.</p><button type="submit">Guardar cobertura</button></form></div><div class="card"><h2>Reintentos y escalamiento de prueba</h2><form id="delivery-form"><div class="grid">${field("retryMinutes", "Minutos entre reintentos (vacío: desactivados)", "number", delivery.retryMinutes ?? "", 'min="1" max="10080"')}${field("maxAttempts", "Máximo de intentos", "number", delivery.maxAttempts, 'required min="1" max="10"')}</div>${field("escalateMinutes", "Minutos hasta señalar coordinación manual (vacío: desactivado)", "number", delivery.escalateMinutes ?? "", 'min="1" max="10080"')}<p class="small muted">Valores ilustrativos pendientes de aprobación operativa y clínica. Sin respaldo configurado, el escalamiento solo señala revisión manual al doctor; no contacta a otro profesional.</p><button type="submit">Guardar configuración de prueba</button></form></div><div class="card"><h2>Reglas versionadas</h2><p class="small muted">Versión ${esc(data.rules.version)} · Pendiente de validación clínica. La detección léxica puede producir omisiones y falsas alertas. No es un protocolo diagnóstico ni una predicción de riesgo.</p><form id="rules-form"><div class="field"><label for="rules-json">Nueva versión ilustrativa (JSON)</label><textarea id="rules-json" name="config" required>${esc(JSON.stringify({ ...data.rules, version: `ilustrativa-${Date.now()}` }, null, 2))}</textarea></div>${field("rules-reason", "Motivo del cambio", "text", "", 'required maxlength="500"')}<button type="submit">Registrar nueva versión ilustrativa</button></form></div>`;
}
async function refresh() {
  const result = await api("session");
  csrf = result.csrf;
  data = result;
}
async function open(rid) {
  try {
    current = await api(`requests/${rid}`);
    page = "detail";
    render();
    $("#main").focus();
    window.scrollTo(0, 0);
  } catch (e) {
    showError(e.message);
  }
}
function bindOpen() {
  $$("[data-open]").forEach((b) => (b.onclick = () => open(b.dataset.open)));
}
const $$ = (s) => [...document.querySelectorAll(s)];
function form(id, handler) {
  const el = $(id);
  if (el)
    el.onsubmit = async (e) => {
      e.preventDefault();
      const button = el.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await handler(new FormData(el), el);
      } catch (e) {
        showError(e.message);
      } finally {
        if (button) button.disabled = false;
      }
    };
}
function click(id, handler) {
  const el = $(id);
  if (el)
    el.onclick = async () => {
      el.disabled = true;
      try {
        await handler();
      } catch (e) {
        showError(e.message);
      } finally {
        el.disabled = false;
      }
    };
}
function bind() {
  click("#mfa-enroll", async()=>{const result=await api("mfa/enroll",{});mfaPending={...mfaPending,...result};render();});
  form("#mfa-form", async f=>{const result=await api("mfa/verify",{factorId:mfaPending.factorId,code:f.get("mfa-code")});csrf=result.csrf;mfaPending=null;await refresh();page="home";render();$("#main").focus();});
  click("#mfa-cancel", async()=>{try{await api("logout",{});}finally{mfaPending=null;data=null;csrf="";render();}});
  $$("[data-page]").forEach(
    (b) =>
      (b.onclick = async () => {
        page = b.dataset.page;
        if (page === "create") {
          draft = {};
          step = 1;
        }
        render();
        $("#main").focus();
        window.scrollTo(0, 0);
      }),
  );
  $$("[data-urgent]").forEach((b) => (b.onclick = urgent));
  bindOpen();
  click("#logout", async () => {
    await api("logout", {});
    data = null;
    csrf = "";
    current = null;
    draft = {};
    page = "home";
    render();
  });
  form("#login-form", async (f) => {
    const r = await api("login", Object.fromEntries(f));
    csrf = r.csrf;
    if (r.mfaRequired) {mfaPending=r; render(); return;}
    await refresh();
    page = "home";
    render();
    $("#main").focus();
  });
  $$("[data-filter]").forEach(
    (el) =>
      (el.onchange = () => {
        filter[el.dataset.filter] = el.value;
        fillList();
      }),
  );
  $$("[data-bucket]").forEach(
    (el) =>
      (el.onclick = () => {
        filter.bucket = el.dataset.bucket;
        render();
      }),
  );
  form("#request-form", async () => {
    captureDraft();
    step = 2;
    render();
    $("#main").focus();
    window.scrollTo(0, 0);
  });
  const rform = $("#request-form");
  if (rform) {
    rform.oninput = warning;
    $("#reason").onchange = () => {
      captureDraft();
      createForm();
      bind();
    };
    $("#patient").onchange = () => {
      captureDraft();
      draft.center = undefined;
      draft.audience = undefined;
      createForm();
      bind();
    };
  }
  click("#edit-draft", () => {
    step = 1;
    render();
  });
  form("#send-form", async (f) => {
    if (!f.has("confirmation"))
      throw new Error(
        "Confirma que revisaste el paciente y los destinatarios.",
      );
    const result = await api("requests", draft);
    draft = {};
    step = 1;
    await refresh();
    current = result;
    page = "detail";
    render();
    toast("Solicitud guardada. No confirma lectura ni aceptación médica.");
  });
  form("#message-form", async (f) => {
    current = await api(`requests/${current.id}/messages`, {
      body: f.get("body"),
      kind: f.get("kind"),
      audience: f.getAll("audience"),
    });
    await refresh();
    render();
    toast("Información añadida al hilo.");
    if (current.priority === 3) urgent();
  });
  const action = async (body) => {
    current = await api(`requests/${current.id}/actions`, body);
    await refresh();
    render();
    toast("Actuación registrada.");
  };
  click("#accept", () => action({ action: "accept" }));
  form("#state-form", async (f) =>
    action({ action: "state", state: f.get("state") }),
  );
  form("#assign-form", async (f) =>
    action({ action: "assign", assigned: f.get("assigned") }),
  );
  form("#priority-form", async (f) =>
    action({
      action: "priority",
      priority: Number(f.get("priority")),
      reason: f.get("priority-reason"),
    }),
  );
  form("#center-form", async (f) =>
    action({
      action: "center",
      center: f.get("center"),
      reason: f.get("center-reason"),
    }),
  );
  form("#due-form", async (f) =>
    action({ action: "due", due: new Date(f.get("due")).toISOString() }),
  );
  click("#record", () => action({ action: "record" }));
  click("#observe", async () => {
    current = await api(`requests/${current.id}/observe`, {});
    render();
    toast("Adaptador sin proveedor configurado. La solicitud se conserva.");
  });
  const clinicalDoc = $('#document-form input[name="clinical"]');
  if (clinicalDoc)
    clinicalDoc.onchange = () => {
      $("#doc-audience").innerHTML =
        `<legend>Destinatarios de la entrega</legend>${recipientChecks(clinicalDoc.checked ? current.recipients.filter((a) => a.clinical) : current.administrativeRecipients, [], "docAudience")}`;
    };
  form("#document-form", async (f) => {
    const file = f.get("file");
    if (!file?.size || file.size > 2 * 1024 * 1024)
      throw new Error("El archivo debe pesar hasta 2 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    current = await api(`requests/${current.id}/documents`, {
      filename: file.name,
      mime: file.type,
      content: btoa(binary),
      clinical: f.has("clinical"),
      previous: f.get("previous") || undefined,
      audience: f.getAll("docAudience"),
    });
    render();
    toast("Borrador privado guardado; aún no se entrega.");
  });
  $$("[data-approve]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          current = await api(`documents/${b.dataset.approve}/approve`, {});
          render();
          toast("Aprobación de esta versión registrada.");
        } catch (e) {
          showError(e.message);
        }
      }),
  );
  $$("[data-download]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const r = await api(`documents/${b.dataset.download}/ticket`, {});
          const a = document.createElement("a");
          a.href = r.url;
          a.download = "documento";
          a.click();
        } catch (e) {
          showError(e.message);
        }
      }),
  );
  form("#preferences-form", async (f) => {
    await api("preferences", {
      priorities: f.getAll("priorities").map(Number),
    });
    await refresh();
    render();
    toast("Preferencias guardadas.");
  });
  $$("[data-notify]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("notifications/test", { outcome: b.dataset.notify });
          await refresh();
          render();
          toast("Simulación completada. Cero mensajes externos enviados.");
        } catch (e) {
          showError(e.message);
        }
      }),
  );
  $$("[data-revoke]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("grants/revoke", { id: b.dataset.revoke });
          await refresh();
          render();
          toast("Permisos revocados. El acceso queda bloqueado.");
        } catch (e) {
          showError(e.message);
        }
      }),
  );
  $$("form[data-grant]").forEach((el) =>
    form(`form[data-grant="${el.dataset.grant}"]`, async (f) => {
      if (!f.has("verified"))
        throw new Error(
          "Debes confirmar la revisión humana de este caso ficticio.",
        );
      const gid = el.dataset.grant;
      await api("grants/review", {
        id: gid,
        evidence: f.get(`evidence-${gid}`),
        review_on: f.get(`review-${gid}`),
        manage: f.has("manage"),
        submit: f.has("submit"),
        clinical: f.has("clinical"),
      });
      await refresh();
      render();
      toast("Revisión de permisos registrada y auditada.");
    }),
  );
  form("#absence-form", async (f) => {
    await api("settings", {
      absence: {
        enabled: f.has("enabled"),
        until: f.get("until") ? new Date(f.get("until")).toISOString() : null,
      },
    });
    await refresh();
    render();
    toast("Cobertura actualizada.");
  });
  form("#delivery-form", async (f) => {
    await api("settings", {
      delivery: {
        retryMinutes: f.get("retryMinutes")
          ? Number(f.get("retryMinutes"))
          : null,
        maxAttempts: Number(f.get("maxAttempts")),
        escalateMinutes: f.get("escalateMinutes")
          ? Number(f.get("escalateMinutes"))
          : null,
        backup: null,
      },
    });
    await refresh();
    render();
    toast("Configuración de prueba guardada.");
  });
  form("#rules-form", async (f) => {
    let config;
    try {
      config = JSON.parse(f.get("config"));
    } catch {
      throw new Error("Revisa el formato JSON de la nueva versión.");
    }
    await api("rules", { config, reason: f.get("rules-reason") });
    await refresh();
    render();
    toast("Nueva versión de reglas registrada.");
  });
}
try {
  publicData = await api("public");
  try {
    await refresh();
  } catch {}
  render();
} catch {
  $("#main").innerHTML =
    `<div class="card"><h1>No se pudo cargar el portal</h1><p>No pudimos conectar con el servicio de prueba. Intenta recargar la página. Las solicitudes guardadas se conservan.</p><p class="emergency-copy">${esc(emergency)}</p></div>`;
}
// Coverage can change while the page remains open. Never infers human presence.
setInterval(async () => {
  try {
    publicData = await api("public");
    if (data) data.coverage = publicData.coverage;
    $$("[data-coverage]").forEach((el) => {
      el.outerHTML = coverageCard();
    });
  } catch {}
}, 60000);
