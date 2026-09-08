/**
 * Henter en `FikenClient` for den innloggede brukeren, basert på OAuth-tokens
 * lagret i `fiken_connection`. Refresher access token automatisk når det er
 * utløpt, og lagrer de nye tokenene tilbake.
 *
 * Kun server-side (route handlers / server actions / server-komponenter).
 */

import "server-only";

import { createClient } from "./supabase/server.ts";
import { env } from "./env.ts";
import { FikenClient } from "./fiken.ts";
import { refreshTokens } from "./fiken-oauth.ts";
import { decryptToken, encryptToken } from "./token-crypto.ts";

export class NoFikenConnectionError extends Error {
  constructor() {
    super("Ingen Fiken-tilkobling. Koble til Fiken under Innstillinger.");
    this.name = "NoFikenConnectionError";
  }
}

/**
 * Ingen innlogget bruker. Egen klasse så `lib/api-errors.ts` kan svare 401
 * i stedet for en generisk 500. Bor her (ikke i `lib/auth.ts`) fordi
 * `api-errors.ts` allerede importerer fra denne fila – ingen ny syklus.
 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super("Ikke innlogget.");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Refresh-tokenet ble avvist av Fiken (typisk `invalid_grant` – tilbaketrukket
 * tilgang eller rotert bort). Brukeren må koble til på nytt. Vi sletter ikke
 * raden automatisk, så `/settings` kan vise en tydelig "koble til på nytt".
 */
export class FikenReauthRequiredError extends Error {
  constructor() {
    super("Fiken-tilkoblingen har utløpt. Koble til Fiken på nytt.");
    this.name = "FikenReauthRequiredError";
  }
}

/**
 * Ser feilen fra token-endepunktet ut som et avvist refresh-token?
 *
 * Match kun på det faktiske OAuth-feilkodene `invalid_grant` / `invalid_token`
 * i feilteksten fra `lib/fiken-oauth.ts`. IKKE på statuskoden alene – da ville
 * `invalid_client` (feil client secret) og `invalid_request` også slått ut, og
 * gitt alle brukere `FikenReauthRequiredError` ved en konfigfeil hos oss.
 */
function isInvalidGrant(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\binvalid_grant\b|\binvalid_token\b/i.test(err.message);
}

export async function getFikenClientForCurrentUser(): Promise<FikenClient> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthenticatedError();

  const { data: conn, error } = await supabase
    .from("fiken_connection")
    .select("id, access_token, refresh_token, access_token_expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!conn) throw new NoFikenConnectionError();

  let accessToken = decryptToken(conn.access_token as string);
  let expiresAt = new Date(conn.access_token_expires_at as string).getTime();

  let refreshToken = decryptToken(conn.refresh_token as string);

  // Single-flight i denne prosessen: dashboardet henter flere selskaper
  // parallelt (Promise.all). Uten dette kan flere kall trigge hver sitt
  // refreshTokens(), som roterer refresh-tokenet og dermed dreper tilkoblingen.
  // Vi deler ett refresh-løfte.
  let refreshInFlight: Promise<string> | null = null;

  async function doRefresh(): Promise<string> {
    let fresh;
    try {
      fresh = await refreshTokens({
        refreshToken,
        clientId: env.fikenClientId(),
        clientSecret: env.fikenClientSecret(),
      });
    } catch (err) {
      if (!isInvalidGrant(err)) throw err;

      // Cross-request-race: en annen samtidig HTTP-request for samme bruker kan
      // ha fornyet tokenet allerede, slik at refresh-tokenet vårt nå er rotert
      // bort. `refreshInFlight` er lokal per kall og hjelper ikke på tvers av
      // requests. Les raden på nytt: er refresh_token endret, bruk den friske
      // raden. Bare hvis raden er uendret er tilkoblingen faktisk død.
      const { data: freshRow, error: reloadError } = await supabase
        .from("fiken_connection")
        .select("access_token, refresh_token, access_token_expires_at")
        .eq("id", conn!.id)
        .maybeSingle();

      if (reloadError) throw reloadError;

      const freshRefreshToken = freshRow
        ? decryptToken(freshRow.refresh_token as string)
        : null;

      if (freshRow && freshRefreshToken !== refreshToken) {
        refreshToken = freshRefreshToken as string;
        accessToken = decryptToken(freshRow.access_token as string);
        expiresAt = new Date(
          freshRow.access_token_expires_at as string,
        ).getTime();
        return accessToken;
      }

      throw new FikenReauthRequiredError();
    }

    accessToken = fresh.accessToken;
    expiresAt = fresh.expiresAt;
    refreshToken = fresh.refreshToken;

    const { error: updateError } = await supabase
      .from("fiken_connection")
      .update({
        access_token: encryptToken(fresh.accessToken),
        refresh_token: encryptToken(fresh.refreshToken),
        access_token_expires_at: new Date(fresh.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn!.id);

    // Skrivingen MÅ lykkes – ellers har Fiken rotert refresh-tokenet vekk uten
    // at vi lagret det nye, og neste refresh vil feile. Kast heller nå.
    if (updateError) throw updateError;

    return accessToken;
  }

  const tokenProvider = async (): Promise<string> => {
    if (expiresAt > Date.now()) return accessToken;

    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  return new FikenClient(tokenProvider);
}
