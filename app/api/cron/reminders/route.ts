import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { runReminders } from "@/lib/reminders";
import { sendReminderEmail } from "@/lib/email";

/**
 * GET /api/cron/reminders
 *
 * Kjøres av Vercel Cron (se vercel.json), én gang i døgnet.
 * Finner bekreftede kontrakter med en oppsigelsesfrist som nærmer seg
 * (90/60/30-dagers terskler), sender e-post via Resend, og logger i
 * `reminder_log` så samme varsel ikke sendes igjen.
 *
 * Kjører med service role (admin-klient) og går forbi RLS – all
 * status-/eierskaps-filtrering ligger eksplisitt i `runReminders`.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Hent secret defensivt: mangler den, svarer vi 401 (ikke 500).
  const secret = env.cronSecretOptional();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const summary = await runReminders({
      supabase,
      now: new Date(),
      getUserEmail: async (userId) => {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error) throw error;
        return data.user?.email ?? null;
      },
      sendReminderEmail,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("Reminders-cron feilet uventet:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
