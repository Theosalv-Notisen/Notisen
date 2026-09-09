/**
 * Varslingstidspunkt per kontrakt: hvor mange dager før oppsigelsesfristen
 * Notisen skal sende en påminnelse.
 *
 * Ren logikk – ingen `next`/`server-only`-import. Delt mellom:
 *  - `lib/reminders.ts`  (cron: hvilke terskler gjelder for en kontrakt)
 *  - `app/(app)/kontrakter/actions.ts`  (lagring av brukerens valg)
 *  - `app/(app)/kontrakter/[id]/page.tsx`  (avkryssingsboksene)
 */

/**
 * Standard hvis brukeren ikke har valgt noe selv (`reminder_offsets` er null).
 * Et tidlig varsel (tid til å vurdere/forhandle), en midtveis-påminnelse og en
 * siste før fristen.
 */
export const DEFAULT_REMINDER_OFFSETS = [90, 30, 7] as const;

/**
 * Valgene brukeren kan krysse av. `HORIZON_DAYS` i reminders.ts må være
 * >= det største tallet her, ellers hentes ikke kontrakten tidlig nok.
 */
export const ALLOWED_REMINDER_OFFSETS = [90, 60, 30, 14, 7, 3, 1] as const;

/** Maks antall varsler per kontrakt – hindrer at noen krysser av alt + tull. */
export const MAX_REMINDER_OFFSETS = ALLOWED_REMINDER_OFFSETS.length;

/**
 * Rydder en liste med varslingsdager til noe trygt å lagre / bruke:
 *  - kun hele positive tall
 *  - kun verdier fra ALLOWED_REMINDER_OFFSETS
 *  - duplikater fjernet
 *  - sortert med den tidligste påminnelsen (størst tall) først
 *  - kappet til MAX_REMINDER_OFFSETS
 *
 * Tom liste inn → tom liste ut. Kalleren avgjør om tomt betyr «bruk standard»
 * (null i databasen) eller «ingen varsler».
 */
export function normalizeReminderOffsets(input: unknown): number[] {
  const raw = Array.isArray(input) ? input : [];
  const allowed = new Set<number>(ALLOWED_REMINDER_OFFSETS);
  const seen = new Set<number>();
  const out: number[] = [];

  for (const v of raw) {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : NaN;
    if (!Number.isInteger(n) || !allowed.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }

  return out.sort((a, b) => b - a).slice(0, MAX_REMINDER_OFFSETS);
}

/**
 * Tersklene som faktisk gjelder for en kontrakt: brukerens valg hvis satt,
 * ellers standarden. Tomt array (`[]`) respekteres som «ingen varsler».
 */
export function effectiveReminderOffsets(
  stored: number[] | null | undefined,
): readonly number[] {
  if (stored == null) return DEFAULT_REMINDER_OFFSETS;
  return stored;
}
