import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * GET /api/cron/reminders
 *
 * Kjøres av Vercel Cron (se vercel.json), én gang i døgnet.
 * Finner kontrakter med next_deadline om 90/60/30 dager, sender e-post
 * via Resend, og logger i reminder_log så samme varsel ikke sendes igjen.
 *
 * TODO (neste steg):
 *   - hent kontrakter fra Supabase (admin-klient)
 *   - for hver offset i [90, 60, 30]: finn deadline == today + offset
 *   - send e-post, skriv reminder_log
 */
export async function GET(request: Request) {
  // Hent secret defensivt: mangler den, svarer vi 401 (ikke 500).
  const secret = env.cronSecretOptional();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ ok: true, sent: 0, note: "ikke implementert enda" });
}
