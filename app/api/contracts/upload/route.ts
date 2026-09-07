import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-errors";
import {
  getFikenClientForCurrentUser,
  NotAuthenticatedError,
} from "@/lib/fiken-connection";

/**
 * POST /api/contracts/upload
 *
 * Tar imot en kontrakt-PDF (multipart/form-data) og legger den i
 * `contracts`-bøtta under '<user.id>/<contract_id>.pdf'. Oppretter en
 * `contract`-rad (status 'draft' → 'uploaded' når fila ligger trygt).
 *
 * Route handler (ikke server action) for å slippe 1 MB-grensa på actions.
 * Vercel har uansett en hard grense på ~4,5 MB request-body; vi capper på 4 MB.
 *
 * Svarer `{ contractId }`. Klienten navigerer selv til /kontrakter/<id>.
 */
export const runtime = "nodejs";

const MAX_BYTES = 4_194_304; // 4 MB

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotAuthenticatedError();

    // CSRF: først etter auth – en forfalsket forespørsel er kun farlig med en
    // gyldig sesjon. Uinnlogget kall svarer 401 uansett headere.
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Ugyldig opprinnelse." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const companySlug = String(form.get("companySlug") ?? "").trim();
    const fikenContactId = Number(form.get("fikenContactId"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Mangler fil." }, { status: 400 });
    }
    if (!companySlug || !Number.isFinite(fikenContactId)) {
      return NextResponse.json(
        { error: "Mangler selskap eller leverandør." },
        { status: 400 },
      );
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Filen må være en PDF." },
        { status: 415 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    if (bytes.length > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "PDF-en er for stor. Maks 4 MB akkurat nå – komprimer den eller del den opp.",
        },
        { status: 413 },
      );
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json(
        { error: "Filen ser ikke ut som en gyldig PDF." },
        { status: 415 },
      );
    }

    // Navn/org.nr hentes fra Fiken – ikke fra klienten.
    const fiken = await getFikenClientForCurrentUser();
    const suppliers = await fiken.suppliers(companySlug);
    const contact = suppliers.find((s) => s.contactId === fikenContactId);
    if (!contact) {
      return NextResponse.json(
        { error: "Fant ikke leverandøren i Fiken." },
        { status: 404 },
      );
    }

    const { data: supplier, error: supplierErr } = await supabase
      .from("supplier")
      .upsert(
        {
          user_id: user.id,
          company_slug: companySlug,
          fiken_contact_id: fikenContactId,
          name: contact.name,
          email: contact.email ?? null,
          organization_number: contact.organizationNumber ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,company_slug,fiken_contact_id" },
      )
      .select("id")
      .single();
    if (supplierErr) throw supplierErr;

    const contractId = randomUUID();
    const storagePath = `${user.id}/${contractId}.pdf`;

    const { error: insertErr } = await supabase.from("contract").insert({
      id: contractId,
      user_id: user.id,
      supplier_id: supplier.id,
      storage_path: storagePath,
      original_filename: file.name || `${contractId}.pdf`,
      status: "draft",
    });
    if (insertErr) throw insertErr;

    const upload = await supabase.storage
      .from("contracts")
      .upload(storagePath, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (upload.error) {
      // Rydd opp: uten fil er contract-raden verdiløs.
      await supabase.from("contract").delete().eq("id", contractId);
      console.error("Opplasting til storage feilet:", upload.error);
      return NextResponse.json(
        { error: "Klarte ikke lagre PDF-en. Prøv igjen." },
        { status: 502 },
      );
    }

    await supabase
      .from("contract")
      .update({ status: "uploaded", updated_at: new Date().toISOString() })
      .eq("id", contractId);

    return NextResponse.json({ contractId });
  } catch (err) {
    return errorResponse(err);
  }
}
