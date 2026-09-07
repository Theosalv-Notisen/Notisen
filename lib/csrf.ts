/**
 * Enkel CSRF-beskyttelse for route handlers som muterer / koster penger.
 *
 * Samme mønster som app/api/fiken/disconnect: forespørselen godtas hvis
 * Origin finnes og matcher Host, ELLER Sec-Fetch-Site sier same-origin.
 * Mangler begge deler, avvis (så sjekken ikke kan hoppes over).
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const originOk = origin !== null && new URL(origin).host === host;
  const sameSite = request.headers.get("sec-fetch-site") === "same-origin";
  return originOk || sameSite;
}
