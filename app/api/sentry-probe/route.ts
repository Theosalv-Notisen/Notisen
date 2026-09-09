/**
 * MIDLERTIDIG – verifiserer at Sentry-oppsettet virker i prod.
 * Sender en bevisst feil og rapporterer om den nådde Sentry.
 * SLETTES så snart verifiseringen er bekreftet.
 */
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const marker = `SENTRY_PROD_PROBE ${new Date().toISOString()}`;
  const eventId = Sentry.captureException(new Error(marker), {
    tags: { area: "probe" },
    level: "error",
  });
  const flushed = await Sentry.flush(4000);
  return Response.json({
    marker,
    eventId,
    flushed,
    dsnConfigured: Boolean(process.env.SENTRY_DSN),
  });
}
