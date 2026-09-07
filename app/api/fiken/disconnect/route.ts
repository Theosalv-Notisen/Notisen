import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/fiken/disconnect
 * Sletter brukerens fiken_connection-rad. RLS gjør at man kun kan slette sin egen.
 * Fjerner ikke Notisen sin tilgang inne i Fiken – det må brukeren gjøre selv.
 */
export async function POST(request: Request) {
  // Enkel CSRF-beskyttelse: skjemaet skal postes fra vår egen origin.
  // Tillat kun hvis Origin finnes og matcher, eller Sec-Fetch-Site sier same-origin.
  // Mangler begge, avviser vi (så sjekken ikke kan hoppes over).
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const originOk = origin !== null && new URL(origin).host === host;
  const sameSite = request.headers.get("sec-fetch-site") === "same-origin";
  if (!originOk && !sameSite) {
    return new NextResponse("Ugyldig opprinnelse.", { status: 403 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/settings", request.url), {
      status: 303,
    });
  }

  const { error } = await supabase
    .from("fiken_connection")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    console.error("Klarte ikke slette fiken_connection:", error);
    return NextResponse.redirect(
      new URL("/settings?fiken=disconnect_failed", request.url),
      { status: 303 },
    );
  }

  return NextResponse.redirect(
    new URL("/settings?fiken=disconnected", request.url),
    { status: 303 },
  );
}
