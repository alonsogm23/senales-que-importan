export const reasons = [
  "Certificado o justificante",
  "Coordinación o gestión administrativa",
  "Duda sobre el tratamiento",
  "Cambio en el estado de salud",
  "Otro motivo",
];
export const states = [
  "Registrada",
  "Pendiente de asignación",
  "Asignada",
  "En revisión administrativa",
  "Pendiente de revisión médica",
  "En revisión médica",
  "Pendiente de información del solicitante",
  "Respondida",
  "Cerrada",
];
export const priorities = [
  { name: "Gestión habitual", color: "green", icon: "○" },
  { name: "Revisión preferente", color: "yellow", icon: "◷" },
  { name: "Revisión médica prioritaria", color: "orange", icon: "△" },
  { name: "Posible emergencia", color: "red", icon: "!" },
];
export const emergency =
  "Posible emergencia: busca asistencia de urgencia.\n\nSi existe peligro inmediato para el paciente o para otra persona, busca asistencia de urgencia ahora.\n\nEste portal no es un servicio de urgencias y no garantiza atención inmediata. No esperes una respuesta del Dr. Gómez para buscar ayuda.\n\nRegistrar una solicitud o enviar una alerta no significa que el doctor la haya leído.";
export const initialRules = {
  version: "ilustrativa-1",
  approved: false,
  red: [
    "peligro inmediato",
    "me voy a matar",
    "no puedo mantenerlo a salvo",
    "no puedo mantenerla a salvo",
  ],
  orange: [
    "suicid",
    "hacerme dano",
    "hacerse dano",
    "no quiere vivir",
    "no kiero vivir",
    "se quiere morir",
    "sobredosis",
    "autolesion",
    "empeor",
    "efecto secundario",
  ],
  yellow: ["necesito adelantar", "vence manana", "urgente"],
};
export const normalize = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
// Illustrative lexical safety net, not a validated clinical instrument. Never uses AI.
export function classify(text, reason, rules = initialRules) {
  const t = normalize(text);
  if (rules.red.some((s) => t.includes(normalize(s)))) return 3;
  if (rules.orange.some((s) => t.includes(normalize(s)))) return 2;
  if (rules.yellow.some((s) => t.includes(normalize(s)))) return 1;
  return [2, 3, 4].includes(Number(reason)) ? 1 : 0;
}
export function coverage(at = new Date(), absence = {}) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Santiago",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const minutes = +parts.hour * 60 + +parts.minute;
  const close = ["Sat", "Sun"].includes(parts.weekday) ? 13 * 60 : 20 * 60;
  const absent =
    absence.enabled && (!absence.until || new Date(absence.until) > at);
  const active = !absent && minutes >= 480 && minutes < close;
  let nextStart = null;
  if (!active && !(absent && !absence.until)) {
    // Walk actual instants, not guessed UTC offsets; handles Santiago's DST transitions.
    const resume =
      absent && absence.until
        ? Math.max(at.getTime(), Date.parse(absence.until))
        : at.getTime();
    const start = new Date(Math.ceil(resume / 60000) * 60000);
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Santiago",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let i = 0; i < 60 * 48; i++) {
      const d = new Date(start.getTime() + i * 60000);
      const p = Object.fromEntries(
        clock.formatToParts(d).map((v) => [v.type, v.value]),
      );
      const m = +p.hour * 60 + +p.minute,
        end = ["Sat", "Sun"].includes(p.weekday) ? 780 : 1200;
      if (
        (p.hour === "08" && p.minute === "00") ||
        (absent && i === 0 && m >= 480 && m < end)
      ) {
        nextStart = d.toISOString();
        break;
      }
    }
  }
  return {
    active,
    nextStart,
    absent: !!absent,
    timezone: "America/Santiago",
    hours: "Lunes a viernes 08:00–20:00 · Sábado y domingo 08:00–13:00",
  };
}
