/**
 * Utsending av e-postvarsler via Resend.
 *
 * Resend-klienten opprettes LAZY (inne i funksjonen) så bare selve importen
 * av denne modulen ikke krever RESEND_API_KEY. Da kan cron-ruten importere
 * `sendReminderEmail` uten at appen kaster ved oppstart hvis nøkkelen mangler.
 *
 * Kun server-side.
 */

import "server-only";

import { Resend } from "resend";
import { env } from "./env.ts";

export type ReminderEmailInput = {
  /** Mottakerens e-postadresse. */
  to: string;
  /** Leverandørnavn, vises i emne og innhold. */
  supplierName: string;
  /** Fristdato ('ÅÅÅÅ-MM-DD') man senest må si opp innen. */
  deadline: string;
  /** Antall hele dager igjen til fristen. */
  daysLeft: number;
  /** Kontraktens id, brukes til å bygge lenke inn i appen. */
  contractId: string;
};

/**
 * Sender ett påminnelses-varsel om en oppsigelsesfrist. Kaster hvis Resend
 * svarer med en feil, så kaller-koden kan telle sendingen som mislykket og
 * prøve igjen ved neste kjøring.
 */
export async function sendReminderEmail(input: ReminderEmailInput): Promise<void> {
  const resend = new Resend(env.resendApiKey());

  const link = `${env.appUrl()}/kontrakter/${input.contractId}`;
  const subject = `Frist for oppsigelse: ${input.supplierName} – ${input.daysLeft} dager igjen`;

  const text = [
    `Avtalen med ${input.supplierName} har en oppsigelsesfrist som nærmer seg.`,
    ``,
    `Si opp senest ${input.deadline} for å unngå at avtalen binder eller fornyer seg videre.`,
    `Det er ${input.daysLeft} dager igjen til fristen.`,
    ``,
    `Se kontrakten i Notisen: ${link}`,
  ].join("\n");

  // ALLE interpolerte verdier escapes – også de som i dag alltid er systemverdier
  // (dato, tall, lenke). Lenken bygges ferdig først og escapes så i sin helhet
  // før den går inn i både href="..." og lenketeksten.
  const safeLink = escapeHtml(link);
  const deadline = escapeHtml(input.deadline);
  const daysLeft = escapeHtml(String(input.daysLeft));
  const c = statusColorForDays(input.daysLeft);
  const html = [
    `<div style="background-color:#F4F0E7; padding:24px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#201F1B">`,
    `<div style="font-weight:700;font-size:18px;letter-spacing:-0.01em;color:#201F1B">Notisen</div>`,
    `<div style="margin-top:16px;background-color:#FFFFFF;border:1px solid rgba(32,31,27,0.12);border-radius:12px;padding:24px">`,
    `<p>Avtalen med <strong>${escapeHtml(input.supplierName)}</strong> har en oppsigelsesfrist som nærmer seg.</p>`,
    `<p>Si opp senest <strong>${deadline}</strong> for å unngå at avtalen binder eller fornyer seg videre. Det er ${daysLeft} dager igjen til fristen.</p>`,
    `<div style="border:1px solid ${c.border};background-color:${c.bg};color:${c.text};border-radius:8px;padding:12px;font-weight:500">Si opp senest ${deadline} — ${daysLeft} dager igjen</div>`,
    `<p style="margin-top:16px"><a href="${safeLink}" style="display:inline-block;background-color:#12706A;color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:500">Se kontrakten i Notisen</a></p>`,
    `</div>`,
    `</div>`,
  ].join("\n");

  const { error } = await resend.emails.send({
    from: env.reminderFromEmail(),
    to: input.to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend avviste e-posten: ${error.message ?? String(error)}`);
  }
}

/**
 * Farge (inline hex) for statusboksen rundt frist-setningen, ut fra hvor
 * mange dager det er igjen.
 *
 * Terskler holdes i synk med `deadlineStatus` i `lib/deadline-status.ts` og
 * med `OFFSETS = [90, 60, 30]` i `lib/reminders.ts`. Endrer du én, endre alle.
 */
function statusColorForDays(daysLeft: number): {
  text: string;
  bg: string;
  border: string;
} {
  if (daysLeft <= 30) {
    return { text: "#C23B3B", bg: "#FAE4E4", border: "rgba(194,59,59,0.3)" };
  }
  if (daysLeft <= 60) {
    return { text: "#D9922E", bg: "#FBEEDA", border: "rgba(217,146,46,0.3)" };
  }
  return { text: "#2F9E5C", bg: "#E3F5EA", border: "rgba(47,158,92,0.3)" };
}

/** Minimal HTML-escaping for tekst vi setter inn i e-post-markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
