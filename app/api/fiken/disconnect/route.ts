import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/fiken/disconnect
 * Sletter brukerens fiken_connection-rad. RLS gjør at man kun kan slette sin egen.
 * Fjerner ikke Notisen sin tilgang inne i Fiken – det må brukeren gjøre selv.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings", request.url), {
      status: 303,
    });
  }

  await supabase.from("fiken_connection").delete().eq("user_id", user.id);

  return NextResponse.redirect(
    new URL("/settings?fiken=disconnected", request.url),
    { status: 303 },
  );
}
