/**
 * Delte cache-tagger for Next.js `unstable_cache` / `revalidateTag`.
 *
 * Ren streng-helper – ingen `next`/`server-only`-import, så den kan brukes
 * både i sider, server actions og (ved behov) testskript.
 */

/** Cachet Fiken-data (Oversikt-siden) for én bruker. Revalideres ved kontosletting. */
export const fikenDataTag = (userId: string) => `fiken-data:${userId}`;
