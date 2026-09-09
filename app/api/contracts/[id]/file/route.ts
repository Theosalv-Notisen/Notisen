import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api-errors";
import { NotAuthenticatedError } from "@/lib/fiken-connection";

/**
 * GET /api/contracts/[id]/file
 *
 * Redirecter (307) til en kortlevd signert URL for kontrakt-PDF-en.
 * RLS på `contract` gjør at man kun får sin egen rad (404 ellers).
 *
 * Vi streamer IKKE fila gjennom funksjonen – Vercel har ~4,5 MB
 * respons-grense, og skannede kontrakter kan være større.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotAuthenticatedError();

    const { data: contract, error } = await supabase
      .from("contract")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!contract) {
      return NextResponse.json(
        { error: "Fant ikke kontrakten." },
        { status: 404 },
      );
    }
    if (!contract.storage_path) {
      // Manuell kontrakt uten opplastet referanse-PDF.
      return NextResponse.json(
        { error: "Denne kontrakten har ingen PDF." },
        { status: 404 },
      );
    }

    const signed = await supabase.storage
      .from("contracts")
      .createSignedUrl(contract.storage_path as string, 60);

    if (signed.error || !signed.data) {
      console.error("Klarte ikke lage signert URL:", signed.error);
      return NextResponse.json(
        { error: "Klarte ikke hente filen." },
        { status: 502 },
      );
    }

    return NextResponse.redirect(signed.data.signedUrl, 307);
  } catch (err) {
    return errorResponse(err);
  }
}
