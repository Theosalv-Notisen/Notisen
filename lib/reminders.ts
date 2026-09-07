/**
 * Orkestrering av påminnelses-varsler. Finner bekreftede kontrakter med en
 * oppsigelsesfrist som nærmer seg, sender e-post og logger i `reminder_log`
 * så samme varsel ikke sendes to ganger.
 *
 * INGEN `server-only`, INGEN `next/*`: alle avhengigheter (supabase-klient,
 * klokke, e-postoppslag, e-postutsending) tas inn som parametre, så
 * testscript kan importere og kjøre denne direkte via `node`.
 *
 * Cron-ruten kjører med service role og går FORBI RLS – derfor er all
 * status-/eierskaps-filtrering eksplisitt i spørringen under.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Varsel-terskler i dager før fristen. */
const OFFSETS = [90, 60, 30] as const;
/** Hvor langt fram vi ser etter frister (lengste offset). */
const HORIZON_DAYS = 90;
/** Postgres-kode for brudd på unique-constraint. */
const UNIQUE_VIOLATION = "23505";

export type ReminderEmailInput = {
  to: string;
  supplierName: string;
  deadline: string;
  daysLeft: number;
  contractId: string;
};

export type ReminderDeps = {
  supabase: SupabaseClient;
  /** "Nå" – sendes inn så logikken kan testes deterministisk. */
  now: Date;
  /** E-postadresse for en bruker, eller null hvis den ikke finnes. */
  getUserEmail: (userId: string) => Promise<string | null>;
  /** Sender ett varsel. Skal kaste ved feil. */
  sendReminderEmail: (input: ReminderEmailInput) => Promise<void>;
  /** Tak på antall kontrakter per kjøring. */
  maxContracts?: number;
};

export type ReminderSummary = {
  /** Antall kontrakter vi gikk gjennom. */
  processed: number;
  /** Antall varsler faktisk sendt. */
  emailsSent: number;
  /** Antall logg-rader skrevet uten e-post (stille backfill av mindre akutte terskler). */
  backfilled: number;
  /** Antall varsler som feilet under sending. */
  failed: number;
  /** Menneskelesbare feilmeldinger. */
  errors: string[];
};

type ContractRow = {
  id: string;
  user_id: string;
  next_deadline: string;
  supplier: { name: string | null } | { name: string | null }[] | null;
};

/** 'ÅÅÅÅ-MM-DD' for en gitt dato i Europe/Oslo. */
function osloDateString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(now);
}

/** Hele dager fra `toIso` fram til `fromIso` (begge 'ÅÅÅÅ-MM-DD'). */
function dateDiffDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((from - to) / 86_400_000);
}

/** Legger `days` dager til en 'ÅÅÅÅ-MM-DD'-dato og returnerer ny 'ÅÅÅÅ-MM-DD'. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Leverandørnavnet vi viser i varselet. PostgREST kan gi embeddede rader som
 * objekt eller ett-elements array, og – om FK-en noen gang skulle mangle – som
 * null. Alle tre tilfellene faller trygt tilbake til "Ukjent leverandør".
 *
 * Eksportert så testene kan sjekke fallbacken direkte (skjemaet gjør det
 * umulig å seede en contract-rad uten supplier).
 */
export function supplierName(row: Pick<ContractRow, "supplier">): string {
  const s = Array.isArray(row.supplier) ? row.supplier[0] : row.supplier;
  return s?.name ?? "Ukjent leverandør";
}

export async function runReminders(deps: ReminderDeps): Promise<ReminderSummary> {
  const { supabase, now } = deps;
  const maxContracts = deps.maxContracts ?? 200;

  const summary: ReminderSummary = {
    processed: 0,
    emailsSent: 0,
    backfilled: 0,
    failed: 0,
    errors: [],
  };

  const today = osloDateString(now);
  const horizon = addDaysIso(today, HORIZON_DAYS);

  // Eksplisitt gate – cron går forbi RLS.
  const { data, error } = await supabase
    .from("contract")
    .select("id, user_id, next_deadline, supplier:supplier_id (name)")
    .eq("status", "confirmed")
    .eq("needs_review", false)
    .not("next_deadline", "is", null)
    .gte("next_deadline", today)
    .lte("next_deadline", horizon)
    .order("next_deadline", { ascending: true })
    .limit(maxContracts);

  if (error) {
    throw new Error(`Klarte ikke hente kontrakter: ${error.message}`);
  }

  const rows = (data ?? []) as ContractRow[];
  const emailCache = new Map<string, string | null>();

  async function resolveEmail(userId: string): Promise<string | null> {
    if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
    const email = await deps.getUserEmail(userId);
    emailCache.set(userId, email);
    return email;
  }

  for (const row of rows) {
    summary.processed++;
    try {
      const deadline = row.next_deadline;
      const daysLeft = dateDiffDays(deadline, today);

      // Terskel-logikk: alle offsets vi har passert, ikke bare den eksakte dagen.
      // (Vercel-cron kan hoppe over en kjøring – eksakt dag-match ville mistet
      // varselet permanent.)
      const applicable = OFFSETS.filter((o) => daysLeft <= o);
      if (applicable.length === 0) continue;
      const mostUrgent = Math.min(...applicable);

      for (const offset of applicable) {
        // Rekkefølge: logg-rad FØRST, så e-post, så slett logg-raden hvis
        // sendingen kaster (self-healing retry ved neste kjøring).
        const { data: inserted, error: insertErr } = await supabase
          .from("reminder_log")
          .insert({
            contract_id: row.id,
            offset_days: offset,
            deadline,
          })
          .select("id")
          .maybeSingle();

        if (insertErr) {
          if (insertErr.code === UNIQUE_VIOLATION) {
            // Allerede sendt/logget for denne (kontrakt, offset, frist).
            continue;
          }
          throw new Error(
            `INSERT reminder_log feilet for ${row.id} (offset ${offset}): ${insertErr.message}`,
          );
        }

        if (offset !== mostUrgent) {
          // Stille backfill – vi sender bare det mest akutte varselet.
          summary.backfilled++;
          continue;
        }

        try {
          const to = await resolveEmail(row.user_id);
          if (!to) {
            throw new Error(`Fant ingen e-postadresse for bruker ${row.user_id}`);
          }
          await deps.sendReminderEmail({
            to,
            supplierName: supplierName(row),
            deadline,
            daysLeft,
            contractId: row.id,
          });
          summary.emailsSent++;
        } catch (sendErr) {
          // Fjern logg-raden så neste kjøring prøver sendingen på nytt.
          if (inserted?.id) {
            await supabase.from("reminder_log").delete().eq("id", inserted.id);
          }
          summary.failed++;
          summary.errors.push(
            `Sending feilet for kontrakt ${row.id}: ${
              sendErr instanceof Error ? sendErr.message : String(sendErr)
            }`,
          );
        }
      }
    } catch (rowErr) {
      // Én kontrakt skal ikke stoppe resten.
      summary.errors.push(
        `Kontrakt ${row.id} feilet: ${
          rowErr instanceof Error ? rowErr.message : String(rowErr)
        }`,
      );
    }
  }

  return summary;
}
