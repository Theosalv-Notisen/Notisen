/**
 * Admin-tilgang: en kommaseparert liste e-poster i `ADMIN_EMAILS` (miljøvariabel).
 * Tom / usatt → ingen admins (admin-sida svarer 404 for alle).
 *
 * Ren logikk – ingen `next`/`server-only`-import, testbar med `node`.
 */

/** E-postene i ADMIN_EMAILS, normalisert (lowercase, trimmet, tomme fjernet). */
export function adminEmailSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True hvis e-posten er i ADMIN_EMAILS. */
export function isAdminEmail(
  email: string | null | undefined,
  raw: string | undefined = process.env.ADMIN_EMAILS,
): boolean {
  if (!email) return false;
  return adminEmailSet(raw).has(email.trim().toLowerCase());
}
