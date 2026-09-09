/**
 * Next.js instrumentation-hook.
 *
 * Feilovervåkingen er Node-runtime-only. Middleware (edge) instrumenteres
 * IKKE – edge-bundlen holdes liten; middleware er tynn nok til at Vercel-loggen
 * holder for de sjeldne feilene der.
 *
 * `onRequestError` fanger uventede server-feil (500) i ruter, server actions og
 * server-komponenter uten at noe kall må endres.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export async function onRequestError(
  error: unknown,
  request: unknown,
  context: unknown,
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureRequestError } = await import("@sentry/nextjs");
  // Signaturene matcher – typene løses via @sentry/nextjs sin egen deklarasjon.
  captureRequestError(
    error as Parameters<typeof captureRequestError>[0],
    request as Parameters<typeof captureRequestError>[1],
    context as Parameters<typeof captureRequestError>[2],
  );
}
