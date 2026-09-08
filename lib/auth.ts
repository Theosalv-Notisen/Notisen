/**
 * Hjelpere for å hente / kreve den innloggede brukeren i server-komponenter
 * og server actions.
 */

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server.ts";

/**
 * Den innloggede brukeren, eller null hvis ikke innlogget.
 *
 * `supabase.auth.getUser()` gjør et nettverkskall til Supabase Auth for å
 * verifisere tokenet. Under én request kaller flere ting dette (layout, side,
 * `getFikenClientForCurrentUser`) – `cache()` gjør at det bare skjer én gang
 * per request.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Krev innlogging. Returnerer brukeren, eller redirecter til /login
 * (med ?next= slik at brukeren kommer tilbake etterpå).
 */
export async function requireUser(next?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}
