/**
 * Rene rate limit-regler + IP-parsing. Ingen `server-only`/`next`-import, så
 * det kan testes med `node` og importeres fra hvor som helst.
 * Selve rate limiting-en (Upstash) ligger i `lib/rate-limit.ts`.
 */

export type RateLimitAction =
  | "login"
  | "signup"
  | "password-reset"
  | "ai-letter";

/**
 * [antall forsøk, tidsvindu] per (handling, omfang). Tunable her.
 * `ip`  = bred grense per kilde-IP.
 * `id`  = smal grense per e-post/identifikator (målrettet mot én konto).
 * Vinduene må matche Upstash sitt Duration-format: `<n> ms|s|m|h|d`.
 */
export const RATE_LIMIT_RULES: Record<
  RateLimitAction,
  { ip: readonly [number, string]; id: readonly [number, string] }
> = {
  login: { ip: [10, "10 m"], id: [5, "15 m"] },
  signup: { ip: [5, "1 h"], id: [5, "1 h"] },
  "password-reset": { ip: [5, "1 h"], id: [3, "1 h"] },
  // Claude-genererte brevutkast (del 2). `id` = bruker-id. Beskytter mot
  // dyre løkke-kall; en vanlig bruker lager sjelden mer enn et par om dagen.
  "ai-letter": { ip: [30, "1 h"], id: [10, "1 h"] },
};

const DURATION_RE = /^(\d+)\s?(ms|s|m|h|d)$/;

/** True hvis strengen er et gyldig Upstash-Duration-vindu. */
export function isValidDuration(window: string): boolean {
  return DURATION_RE.test(window);
}

/** Plukk klient-IP fra proxy-headerne. Ren funksjon. */
export function pickClientIp(
  forwardedFor: string | null | undefined,
  realIp: string | null | undefined,
): string {
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return realIp?.trim() || "unknown";
}
