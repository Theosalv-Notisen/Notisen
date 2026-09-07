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

  const html = [
    `<p>Avtalen med <strong>${escapeHtml(input.supplierName)}</strong> har en oppsigelsesfrist som nærmer seg.</p>`,
    `<p>Si opp senest <strong>${input.deadline}</strong> for å unngå at avtalen binder eller fornyer seg videre. Det er ${input.daysLeft} dager igjen til fristen.</p>`,
    `<p><a href="${link}">Se kontrakten i Notisen</a></p>`,
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

/** Minimal HTML-escaping for tekst vi setter inn i e-post-markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
