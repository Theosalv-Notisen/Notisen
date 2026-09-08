"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAccountData } from "@/lib/delete-account";

/**
 * Sletter den innloggede brukerens konto permanent: alle PDF-er i storage
 * + brukeren i auth.users (som cascader all DB).
 *
 * KRITISK: bruker-id-en kommer ALLTID fra `getUser()` – aldri fra `formData`.
 * `formData` brukes kun til bekreftelses-strengen (skriv inn din egen e-post).
 * Feiler storage-oppryddingen kaster `deleteAccountData` FØR brukeren slettes,
 * og vi sender brukeren tilbake med et «ingenting er slettet»-banner.
 */
export async function deleteAccount(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  const bekreftelse =
    typeof formData.get("bekreftelse") === "string"
      ? (formData.get("bekreftelse") as string).trim().toLowerCase()
      : "";
  const epost = (user.email ?? "").trim().toLowerCase();

  if (!epost || bekreftelse !== epost) {
    redirect("/settings?slett_feil=bekreftelse");
  }

  const admin = createAdminClient();
  try {
    await deleteAccountData(admin, user.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    // Dobbeltklikk / retry: første kall slettet allerede brukeren, andre kall
    // får en "slette bruker … not found"-feil fra deleteUser. Da ER kontoen
    // borte – behandle som suksess. (Storage-feil har en annen, spesifikk
    // melding uten "not found", så den treffer ikke her.)
    const alreadyGone =
      msg.includes("slette bruker") &&
      /not found|user_not_found|does not exist/.test(msg);
    if (!alreadyGone) {
      console.error("Sletting av konto feilet for bruker", user.id, err);
      redirect("/settings?slett_feil=1");
    }
  }

  await supabase.auth.signOut();
  redirect("/login?slettet=1");
}
