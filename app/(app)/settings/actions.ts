"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAccountData } from "@/lib/delete-account";
import { setBenchmarkConsent } from "@/lib/benchmark";
import { fikenDataTag } from "@/lib/cache-tags";

/**
 * Del 3 – opt-in/opt-out for anonym prissammenligning. Ved opt-out slettes
 * også alle brukerens innsamlede datapunkter (i `setBenchmarkConsent`).
 */
async function changeBenchmarkConsent(enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings");

  try {
    await setBenchmarkConsent(supabase, user.id, enabled);
  } catch (err) {
    // Supabase-feil er et vanlig objekt (ikke Error) – grav ut kode + melding.
    const e = err as { code?: string; message?: string } | null;
    const msg = e?.message ?? (err instanceof Error ? err.message : String(err));
    const aboutBenchmark = /benchmark_consent|benchmark_sample/.test(msg);

    // 42501 = permission denied: tabellen finnes, men mangler GRANT til
    // `authenticated`/`service_role` (kan skje avhengig av hvem som kjørte
    // migrasjonen). Egen melding – ellers ser det ut som migrasjonen ikke er kjørt.
    if (e?.code === "42501" && aboutBenchmark) {
      redirect("/settings?benchmark=tilgang");
    }
    // 42P01 / PGRST205 = tabellen finnes ikke.
    if (e?.code === "PGRST205" || e?.code === "42P01" || aboutBenchmark) {
      redirect("/settings?benchmark=migrasjon");
    }
    throw err;
  }

  revalidatePath("/settings");
  redirect(`/settings?benchmark=${enabled ? "pa" : "av"}`);
}

export async function enableBenchmarkConsent() {
  return changeBenchmarkConsent(true);
}

export async function disableBenchmarkConsent() {
  return changeBenchmarkConsent(false);
}

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

  // Tøm den cachede Fiken-oversikten for brukeren med én gang, i stedet for å
  // la den ligge i inntil `revalidate`-vinduet (3 min) etter at kontoen er slettet.
  revalidateTag(fikenDataTag(user.id));

  await supabase.auth.signOut();
  redirect("/login?slettet=1");
}
