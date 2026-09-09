import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-errors";
import { NotAuthenticatedError } from "@/lib/fiken-connection";
import {
  normalizeBoolean,
  normalizeDate,
  normalizeInteger,
  NOTICE_PERIOD_DAYS_RANGE,
  TERM_MONTHS_RANGE,
} from "@/lib/contract-fields";
import {
  computeNextDeadline,
  deadlineFieldsFromRow,
} from "@/lib/contract-deadline";
import { normalizeReminderOffsets } from "@/lib/reminder-offsets";

/**
 * POST /api/contracts/manual
 *
 * Legger til en kontrakt brukeren fyller inn selv (avtaler som ikke går via
 * Fiken). PDF er valgfri referanse. Går gjennom samme frist-beregning
 * (`computeNextDeadline`) og varslingslogikk som Fiken-kontraktene.
 *
 * Route handler (ikke server action) for å tåle multipart + valgfri fil.
 * Svarer `{ contractId }`; klienten navigerer til /kontrakter/<id>.
 */
export const runtime = "nodejs";

const MAX_BYTES = 4_194_304; // 4 MB

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotAuthenticatedError();

    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Ugyldig opprinnelse." }, { status: 403 });
    }

    const form = await request.formData();
    const supplierName = String(form.get("supplier_name") ?? "").trim();
    if (!supplierName) {
      return NextResponse.json(
        { error: "Fyll inn hvem avtalen er med." },
        { status: 400 },
      );
    }
    if (supplierName.length > 200) {
      return NextResponse.json(
        { error: "Leverandørnavnet er for langt." },
        { status: 400 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const norm = {
      contract_start: normalizeDate(
        emptyToNull(form.get("contract_start")),
        today,
        "Startdato",
      ),
      term_months: normalizeInteger(
        emptyToNull(form.get("term_months")),
        TERM_MONTHS_RANGE,
        "Avtaleperiode (måneder)",
      ),
      binding_until: normalizeDate(
        emptyToNull(form.get("binding_until")),
        today,
        "Bindingstid utløper",
      ),
      renewal_date: normalizeDate(
        emptyToNull(form.get("renewal_date")),
        today,
        "Fornyelsesdato",
      ),
      notice_period_days: normalizeInteger(
        emptyToNull(form.get("notice_period_days")),
        NOTICE_PERIOD_DAYS_RANGE,
        "Oppsigelsesfrist (dager)",
      ),
    };

    const fields = {
      contract_start: norm.contract_start.value,
      term_months: norm.term_months.value,
      binding_until: norm.binding_until.value,
      auto_renews: normalizeBoolean(form.get("auto_renews")),
      renewal_date: norm.renewal_date.value,
      notice_period_days: norm.notice_period_days.value,
    };

    const adjustments = Object.values(norm)
      .filter((r) => r.changed && r.note)
      .map((r) => r.note as string);

    const chosenOffsets = normalizeReminderOffsets(
      form.getAll("reminder_offsets"),
    );
    const reminderOffsets = chosenOffsets.length > 0 ? chosenOffsets : null;

    const deadline = computeNextDeadline(deadlineFieldsFromRow(fields), today);

    // ── Valgfri PDF ────────────────────────────────────────────────────
    const file = form.get("file");
    let pdfBytes: Buffer | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.type !== "application/pdf") {
        return NextResponse.json(
          { error: "Referansefilen må være en PDF." },
          { status: 415 },
        );
      }
      pdfBytes = Buffer.from(await file.arrayBuffer());
      if (pdfBytes.length > MAX_BYTES) {
        return NextResponse.json(
          { error: "PDF-en er for stor. Maks 4 MB." },
          { status: 413 },
        );
      }
      const looksLikePdf =
        pdfBytes.length >= 400 &&
        pdfBytes.subarray(0, 5).toString("latin1") === "%PDF-" &&
        pdfBytes
          .subarray(Math.max(0, pdfBytes.length - 2048))
          .toString("latin1")
          .includes("%%EOF");
      if (!looksLikePdf) {
        return NextResponse.json(
          { error: "Filen ser ikke ut som en gyldig PDF." },
          { status: 415 },
        );
      }
    }

    // ── Leverandør (fersk manuell rad) ────────────────────────────────
    const { data: supplier, error: supplierErr } = await supabase
      .from("supplier")
      .insert({ user_id: user.id, name: supplierName })
      .select("id")
      .single();
    if (supplierErr) throw supplierErr;

    const contractId = randomUUID();
    const storagePath = pdfBytes ? `${user.id}/${contractId}.pdf` : null;

    const { error: insertErr } = await supabase.from("contract").insert({
      id: contractId,
      user_id: user.id,
      supplier_id: supplier.id,
      source: "manual",
      storage_path: storagePath,
      original_filename:
        file instanceof File && file.name ? file.name : null,
      ...fields,
      reminder_offsets: reminderOffsets,
      next_deadline: deadline.date,
      // Samme regel som confirmContract: uten en frist er kontrakten reelt
      // umonitorert – needs_review holder den ute av varsel-cronen.
      needs_review: deadline.date === null,
      status: "confirmed",
    });
    if (insertErr) {
      await supabase.from("supplier").delete().eq("id", supplier.id);
      throw insertErr;
    }

    if (pdfBytes && storagePath) {
      const upload = await supabase.storage
        .from("contracts")
        .upload(storagePath, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (upload.error) {
        // Fila er referanse, ikke kritisk – behold kontrakten, nullstill stien.
        console.error("Manuell PDF-opplasting feilet:", upload.error);
        await supabase
          .from("contract")
          .update({ storage_path: null, original_filename: null })
          .eq("id", contractId);
        return NextResponse.json({
          contractId,
          warning: "Kontrakten er lagret, men referanse-PDF-en ble ikke lastet opp.",
        });
      }
    }

    return NextResponse.json({
      contractId,
      adjustments: adjustments.length > 0 ? adjustments.join(" | ") : undefined,
      utenFrist: deadline.date === null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
