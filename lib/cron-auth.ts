import { timingSafeEqual } from "node:crypto";

/**
 * Sjekker at en cron-request bærer riktig `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron setter denne headeren automatisk når `CRON_SECRET` er satt i miljøet.
 *
 * Mangler eller feil secret → false (rutene svarer 401, aldri 500).
 * Sammenligningen er konstant-tid for å ikke lekke secret via responstid.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
