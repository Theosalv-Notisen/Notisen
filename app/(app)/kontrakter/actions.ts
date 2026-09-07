"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeNextDeadline } from "@/lib/contract-deadline";
import { deleteContractById } from "@/lib/delete-contract";
import {
  normalizeBoolean,
  normalizeDate,
  normalizeInteger,
  NOTICE_PERIOD_DAYS_RANGE,
  TERM_MONTHS_RANGE,
} from "@/lib/contract-fields";

/**
 * Server actions for kontrakt-detaljsiden.
 *
 * Kun `confirmContract` setter status = 'confirmed'. Det er den eneste
 * statusen som teller for e-postvarsler – Claudes uttrekk alene planlegger
 * aldri et varsel.
 *
 * Manuelt inntastede verdier går gjennom samme normalisering som Claude-
 * uttrekket (lib/contract-fields.ts): tall klampes til gyldig område, datoer
 * må være gyldige og innenfor et rimelig tidsrom. Felt som må justeres blir
 * lagret i justert form, og brukeren får se nøyaktig hva som ble endret
 * (`?justert=` på redirecten). Vi avviser altså ikke skjemaet – vi lagrer
 * aldri en verdi som er verre enn klampet-til-gyldig, og brukeren står på
 * siden og kan rette opp og lagre på nytt.
 */

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

export async function confirmContract(formData: FormData) {
  const id = emptyToNull(formData.get("id"));
  if (!id) throw new Error("Mangler kontrakt-id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/kontrakter/${id}`);

  const today = new Date().toISOString().slice(0, 10);

  const norm = {
    contract_start: normalizeDate(
      emptyToNull(formData.get("contract_start")),
      today,
      "Startdato",
    ),
    term_months: normalizeInteger(
      emptyToNull(formData.get("term_months")),
      TERM_MONTHS_RANGE,
      "Avtaleperiode (måneder)",
    ),
    binding_until: normalizeDate(
      emptyToNull(formData.get("binding_until")),
      today,
      "Bindingstid utløper",
    ),
    renewal_date: normalizeDate(
      emptyToNull(formData.get("renewal_date")),
      today,
      "Fornyelsesdato",
    ),
    notice_period_days: normalizeInteger(
      emptyToNull(formData.get("notice_period_days")),
      NOTICE_PERIOD_DAYS_RANGE,
      "Oppsigelsesfrist (dager)",
    ),
  };

  const adjustments = Object.values(norm)
    .filter((r) => r.changed && r.note)
    .map((r) => r.note as string);

  const fields = {
    contract_start: norm.contract_start.value,
    term_months: norm.term_months.value,
    binding_until: norm.binding_until.value,
    auto_renews: normalizeBoolean(formData.get("auto_renews")),
    renewal_date: norm.renewal_date.value,
    notice_period_days: norm.notice_period_days.value,
  };

  const deadline = computeNextDeadline(
    {
      contractStart: fields.contract_start,
      termMonths: fields.term_months,
      bindingUntil: fields.binding_until,
      autoRenews: fields.auto_renews,
      renewalDate: fields.renewal_date,
      noticePeriodDays: fields.notice_period_days,
    },
    today,
  );

  // `.select(...).maybeSingle()` gjør at vi ser om en rad faktisk ble oppdatert.
  // Bekrefter man en id som ikke finnes / ikke er sin egen → 0 rader, og da skal
  // brukeren IKKE få en falsk "bekreftet"-kvittering (samme mønster som
  // deleteContractById). Da sender vi tilbake til detaljsiden med ?feil=bekreft.
  const { data: updated, error } = await supabase
    .from("contract")
    .update({
      ...fields,
      next_deadline: deadline.date,
      // Uten en beregnet frist er kontrakten reelt umonitorert – behold
      // needs_review slik at varsel-cronen (som krever needs_review = false)
      // ikke plukker den opp, og si det tydelig til brukeren under.
      needs_review: deadline.date === null,
      status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!updated) redirect(`/kontrakter/${id}?feil=bekreft`);

  revalidatePath(`/kontrakter/${id}`);
  revalidatePath("/kontrakter");

  const query = new URLSearchParams({ bekreftet: "1" });
  if (deadline.date === null) query.set("uten_frist", "1");
  if (adjustments.length > 0) {
    query.set("justert", adjustments.join(" | "));
  }
  redirect(`/kontrakter/${id}?${query.toString()}`);
}

/**
 * Sletter en kontrakt permanent (rad + PDF + planlagte påminnelser via cascade).
 * Bruker-scoped klient, så RLS sørger for at man bare kan slette egne rader.
 * Fant vi ingen rad å slette → tilbake til detaljsiden med ?feil=slett.
 */
export async function deleteContract(formData: FormData) {
  const id = emptyToNull(formData.get("id"));
  // Mangler id-en er det ingen meningsfull detaljside å gå tilbake til –
  // send brukeren til oversikten i stedet for Next sin råe feilside.
  if (!id) redirect("/kontrakter");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/kontrakter/${id}`);

  const { deleted } = await deleteContractById(supabase, user.id, id);
  if (!deleted) {
    redirect(`/kontrakter/${id}?feil=slett`);
  }

  revalidatePath("/kontrakter");
  redirect("/kontrakter");
}
