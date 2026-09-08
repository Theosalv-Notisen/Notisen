"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * «Glemt passord?» – steg 2: sett nytt passord.
 *
 * Krever en aktiv recovery-sesjon (satt av /auth/confirm). Uten den sender vi
 * brukeren tilbake til start. Etterpå logger vi brukeren ut, så de må logge inn
 * med det nye passordet – da vet vi at det virker.
 */
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  if (password.length < 6) {
    redirect("/nytt-passord?feil=svakt");
  }
  if (password.length > 72) {
    redirect("/nytt-passord?feil=langt");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/glemt-passord?feil=utlopt");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("different from the old") || m.includes("should be different")) {
      redirect("/nytt-passord?feil=samme");
    }
    console.error("updateUser(password) feilet:", error.message);
    redirect("/nytt-passord?feil=1");
  }

  await supabase.auth.signOut();
  redirect("/login?passord_oppdatert=1");
}
