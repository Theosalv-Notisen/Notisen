import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/confirm
 *
 * Landingspunkt for lenker fra Supabase-e-poster (tilbakestill passord osv.).
 * Supabase sender brukeren hit med enten:
 *   - `?code=...`                (PKCE – standard for @supabase/ssr)
 *   - `?token_hash=...&type=...` (hvis e-postmalen er satt opp med token_hash)
 *
 * Vi veksler inn engangsverdien til en sesjon (settes som cookie) og sender
 * brukeren videre til `next` (validert til en intern sti).
 */
function safeNext(value: string | null): string {
  if (!value || !/^\/[^/\\]/.test(value)) return "/dashboard";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return "/dashboard";
  }
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("exchangeCodeForSession feilet:", error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("verifyOtp feilet:", error.message);
  }

  return NextResponse.redirect(new URL("/login?feil=reset_ugyldig", url.origin));
}
