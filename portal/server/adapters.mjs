// Deliberately has no network transport. Replace only after operational/privacy approval.
export const genericNotice = Object.freeze({
  subject: "Actualización en el portal de pacientes",
  text: "Tienes una actualización en el portal. Ingresa con tu cuenta personal.",
  path: "/portal/",
});
export const testChannels = Object.freeze({
  "email-test": (outcome) => ({
    mode: "simulation",
    providerReported: outcome === "delivered",
    externalMessagesSent: 0,
  }),
  "secondary-test": (outcome) => ({
    mode: "simulation",
    providerReported: outcome === "delivered",
    externalMessagesSent: 0,
  }),
});
export function deliverTest(channel, outcome) {
  if (!testChannels[channel] || !["delivered", "failed"].includes(outcome))
    throw Error("unsupported_test_channel");
  return { ...testChannels[channel](outcome), notice: genericNotice };
}
