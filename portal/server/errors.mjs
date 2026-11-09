export class Fault extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (
  status = 403,
  message = "No tienes permiso para realizar esta acción.",
) => {
  throw new Fault(status, message);
};
export function text(value, max = 6000, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, "Revisa los campos y su extensión.");
  return value.trim();
}
