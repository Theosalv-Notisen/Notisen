"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeNextDeadline,
  deadlineFieldsFromRow,
} from "@/lib/contract-deadline";
import { deleteContractById } from "@/lib/delete-contract";
import {
  normalizeBoolean,
  normalizeDate,
  normalizeInteger,
  NOTICE_PERIOD_DAYS_RANGE,
  TERM_MONTHS_RANGE,
} from "@/lib/contract-fields";
import { normalizeReminderOffsets } from "@/lib/reminder-offsets";

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
  if (!id) redirect("/kontrakter");

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

  // Varslingstidspunkt: avkryssingsboksene «reminder_offsets». Tomt utvalg →
  // null (systemstandarden 30/7 gjelder). Alt annet lagres som brukerens valg.
  const chosenOffsets = normalizeReminderOffsets(
    formData.getAll("reminder_offsets"),
  );
  const reminderOffsets = chosenOffsets.length > 0 ? chosenOffsets : null;

  const deadline = computeNextDeadline(deadlineFieldsFromRow(fields), today);

  const patch: Record<string, unknown> = {
    ...fields,
    reminder_offsets: reminderOffsets,
    next_deadline: deadline.date,
    // Brukeren har nå sett på feltene selv – nullstill roll-forward-markøren
    // så «frist rullet automatisk»-notisen forsvinner.
    deadline_rolled_at: null,
    // Uten en beregnet frist er kontrakten reelt umonitorert – behold
    // needs_review slik at varsel-cronen (som krever needs_review = false)
    // ikke plukker den opp, og si det tydelig til brukeren under.
    needs_review: deadline.date === null,
    status: "confirmed",
    updated_at: new Date().toISOString(),
  };

  // `.select(...).maybeSingle()` gjør at vi ser om en rad faktisk ble oppdatert.
  // Bekrefter man en id som ikke finnes / ikke er sin egen → 0 rader, og da skal
  // brukeren IKKE få en falsk "bekreftet"-kvittering (samme mønster som
  // deleteContractById). Da sender vi tilbake til detaljsiden med ?feil=bekreft.
  async function saveConfirmed(body: Record<string, unknown>) {
    return supabase
      .from("contract")
      .update(body)
      .eq("id", id)
      .eq("user_id", user!.id)
      // Statusvern: en tilpasset POST skal ikke kunne tvinge en
      // draft/processing/failed-kontrakt rett til 'confirmed'.
      .in("status", ["extracted", "confirmed"])
      .select("id")
      .maybeSingle();
  }

  let { data: updated, error } = await saveConfirmed(patch);

  // Bakoverkompatibelt: er `reminder_offsets`-kolonnen ikke migrert inn ennå,
  // lagre resten uten den (kontrakten får standardtersklene så lenge).
  if (error && /reminder_offsets/.test(error.message)) {
    const { reminder_offsets: _omit, ...rest } = patch;
    void _omit;
    ({ data: updated, error } = await saveConfirmed(rest));
  }

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
