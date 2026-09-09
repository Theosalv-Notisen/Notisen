/**
 * MIDLERTIDIG – verifiserer at Sentry-oppsettet virker i prod.
 * SLETTES så snart verifiseringen er bekreftet.
 *   GET /api/sentry-probe          → eksplisitt captureException + flush
 *   GET /api/sentry-probe?throw=1  → kastet feil (fanges av onRequestError)
 */
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const marker = `SENTRY_PROD_PROBE ${new Date().toISOString()}`;

  if (new URL(request.url).searchParams.get("throw") === "1") {
    throw new Error(`${marker} (uncaught / onRequestError)`);
  }

  const eventId = Sentry.captureException(new Error(`${marker} (explicit)`), {
    tags: { area: "probe" },
    level: "error",
  });
  const flushed = await Sentry.flush(4000);
  return Response.json({ marker, eventId, flushed, dsnConfigured: Boolean(process.env.SENTRY_DSN) });
}
