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

export class NoFikenConnectionError extends Error {
  constructor() {
    super("Ingen Fiken-tilkobling. Koble til Fiken under Innstillinger.");
    this.name = "NoFikenConnectionError";
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

/** Ser feilen fra token-endepunktet ut som et avvist refresh-token? */
function isInvalidGrant(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /invalid_grant|invalid_token|svarte 40[013]\b/i.test(err.message);
}

export async function getFikenClientForCurrentUser(): Promise<FikenClient> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Ikke innlogget.");

  const { data: conn, error } = await supabase
    .from("fiken_connection")
    .select("id, access_token, refresh_token, access_token_expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!conn) throw new NoFikenConnectionError();

  let accessToken = conn.access_token as string;
  let expiresAt = new Date(conn.access_token_expires_at as string).getTime();

  // Single-flight: dashboardet henter flere selskaper parallelt (Promise.all).
  // Uten dette kan flere kall trigge hver sitt refreshTokens(), som roterer
  // refresh-tokenet og dermed dreper tilkoblingen. Vi deler ett refresh-løfte.
  let refreshInFlight: Promise<string> | null = null;

  async function doRefresh(): Promise<string> {
    let fresh;
    try {
      fresh = await refreshTokens({
        refreshToken: conn!.refresh_token as string,
        clientId: env.fikenClientId(),
        clientSecret: env.fikenClientSecret(),
      });
    } catch (err) {
      if (isInvalidGrant(err)) throw new FikenReauthRequiredError();
      throw err;
    }

    accessToken = fresh.accessToken;
    expiresAt = fresh.expiresAt;

    await supabase
      .from("fiken_connection")
      .update({
        access_token: fresh.accessToken,
        refresh_token: fresh.refreshToken,
        access_token_expires_at: new Date(fresh.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn!.id);

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
