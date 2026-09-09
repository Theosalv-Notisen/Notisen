"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Ber Supabase sende en «tilbakestill passord»-e-post.
 *
 * Svaret er ALLTID det samme (`?sendt=1`), uansett om e-posten finnes eller
 * ikke – vi skal ikke avsløre hvilke adresser som har en konto.
 *
 * `redirectTo` peker på /auth/confirm, som veksler inn engangskoden og setter
 * en recovery-sesjon før brukeren sendes videre til /nytt-passord.
 * URL-en må stå i Supabase → Authentication → URL Configuration → Redirect URLs.
 */
export async function sendPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect("/glemt-passord?feil=tomt");
  }

  // «For mange forsøk» lekker ikke om e-posten finnes: per-e-post-grensen
  // treffer uansett, og per-IP-grensen treffer etter noen ulike adresser.
  if (!(await rateLimit("password-reset", email)).allowed) {
    redirect("/glemt-passord?feil=rate");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.appUrl()}/auth/confirm?next=${encodeURIComponent(
      "/nytt-passord",
    )}`,
  });

  if (error) {
    // Rate limit e.l. – logg serverside, men vis samme nøytrale svar til brukeren.
    console.error("resetPasswordForEmail feilet:", error.message);
  }

  redirect("/glemt-passord?sendt=1");
}
