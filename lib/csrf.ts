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
  let originOk = false;
  if (origin !== null) {
    try {
      originOk = new URL(origin).host === host;
    } catch {
      originOk = false; // misformet Origin-header
    }
  }
  const sameSite = request.headers.get("sec-fetch-site") === "same-origin";
  return originOk || sameSite;
}
