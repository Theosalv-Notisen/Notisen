"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeNextDeadline } from "@/lib/contract-deadline";

/**
 * Server actions for kontrakt-detaljsiden.
 *
 * Kun `confirmContract` setter status = 'confirmed'. Det er den eneste
 * statusen som teller for e-postvarsler – Claudes uttrekk alene planlegger
 * aldri et varsel.
 */

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

function toIntOrNull(value: FormDataEntryValue | null): number | null {
  const s = emptyToNull(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toBoolOrNull(value: FormDataEntryValue | null): boolean | null {
  const s = emptyToNull(value);
  if (s === "true") return true;
  if (s === "false") return false;
  return null;
}

export async function confirmContract(formData: FormData) {
  const id = emptyToNull(formData.get("id"));
  if (!id) throw new Error("Mangler kontrakt-id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/kontrakter/${id}`);

  const fields = {
    contract_start: emptyToNull(formData.get("contract_start")),
    term_months: toIntOrNull(formData.get("term_months")),
    binding_until: emptyToNull(formData.get("binding_until")),
    auto_renews: toBoolOrNull(formData.get("auto_renews")),
    renewal_date: emptyToNull(formData.get("renewal_date")),
    notice_period_days: toIntOrNull(formData.get("notice_period_days")),
  };

  const today = new Date().toISOString().slice(0, 10);
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

  const { error } = await supabase
    .from("contract")
    .update({
      ...fields,
      next_deadline: deadline.date,
      needs_review: false,
      status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;

  revalidatePath(`/kontrakter/${id}`);
  revalidatePath("/kontrakter");
  redirect(`/kontrakter/${id}?bekreftet=1`);
}
