import { createClient } from "@supabase/supabase-js";
import { env } from "../env.ts";

/**
 * Admin-klient med service role-nøkkel. Går forbi RLS.
 * Bruk KUN i cron-jobber og betrodde server-oppgaver – aldri i noe
 * som svarer på en vanlig brukerforespørsel uten egne sjekker.
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
