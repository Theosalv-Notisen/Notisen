/**
 * Henter en `FikenClient` for den innloggede brukeren, basert på OAuth-tokens
 * lagret i `fiken_connection`. Refresher access token automatisk når det er
 * utløpt, og lagrer de nye tokenene tilbake.
 *
 * Kun server-side (route handlers / server actions).
 */

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

  const tokenProvider = async (): Promise<string> => {
    if (expiresAt > Date.now()) return accessToken;

    const fresh = await refreshTokens({
      refreshToken: conn.refresh_token as string,
      clientId: env.fikenClientId(),
      clientSecret: env.fikenClientSecret(),
    });

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
      .eq("id", conn.id);

    return accessToken;
  };

  return new FikenClient(tokenProvider);
}
