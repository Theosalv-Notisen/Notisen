/**
 * Hjelpere for å hente / kreve den innloggede brukeren i server-komponenter
 * og server actions.
 */

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server.ts";

/** Den innloggede brukeren, eller null hvis ikke innlogget. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

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
