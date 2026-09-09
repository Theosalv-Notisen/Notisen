/**
 * Sentry-oppsett for Node-runtime (API-ruter, server actions, server-
 * komponenter, cron). Lastes av instrumentation.ts.
 *
 * Uten `SENTRY_DSN` gjør denne ingenting – appen kjører som før,
 * og `Sentry.captureException(...)`-kall andre steder blir no-ops.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    // Ingen performance-/trace-sampling – vi vil bare ha feil, ikke telemetri.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Rene «forventede» feil skal ikke støye i Sentry.
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND"],
  });
}
