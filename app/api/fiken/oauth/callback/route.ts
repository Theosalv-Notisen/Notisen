import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { exchangeCodeForTokens } from "@/lib/fiken-oauth";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/token-crypto";

/**
 * GET /api/fiken/oauth/callback
 * Fiken sender brukeren hit med ?code=...&state=...
 * Vi bytter code mot tokens og lagrer dem i fiken_connection for brukeren.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("fiken_oauth_state")?.value;
  cookieStore.delete("fiken_oauth_state");

  const back = (params: string) =>
    NextResponse.redirect(new URL(`/settings?${params}`, url.origin));

  if (oauthError) return back(`fiken_error=${encodeURIComponent(oauthError)}`);
  if (!code || !state || state !== expectedState) {
    return back("fiken_error=invalid_state");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings", url.origin));
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: env.fikenClientId(),
      clientSecret: env.fikenClientSecret(),
      redirectUri: env.fikenRedirectUri(),
    });

    const { error } = await supabase.from("fiken_connection").upsert(
      {
        user_id: user.id,
        access_token: encryptToken(tokens.accessToken),
        refresh_token: encryptToken(tokens.refreshToken),
        access_token_expires_at: new Date(tokens.expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;

    return back("fiken=connected");
  } catch (err) {
    // Detaljen kan inneholde rå respons fra Fikens token-endepunkt – logg den,
    // men vis kun en generisk kode til brukeren.
    console.error("Fiken OAuth callback feilet:", err);
    Sentry.captureException(err, { tags: { area: "fiken-oauth" } });
    return back("fiken_error=exchange_failed");
  }
}
