/**
 * Delt normalisering av de uttrukne/redigerbare kontraktsfeltene.
 *
 * Brukes to steder som må klampe likt:
 *  - lib/contract-extract.ts (verdier fra Claude – ett rart felt skal bli
 *    `null` + degradert konfidens, ikke velte hele uttrekket)
 *  - app/(app)/kontrakter/actions.ts (manuelt inntastede verdier ved bekreftelse)
 *
 * Ren logikk, ingen nettverk – trygg å importere fra server actions og scripts.
 */

/** Oppsigelsesfrist i dager. 1095 = 3 år. */
export const NOTICE_PERIOD_DAYS_RANGE = { min: 0, max: 1095 } as const;
/** Avtaleperiode i måneder. 600 = 50 år. */
export const TERM_MONTHS_RANGE = { min: 0, max: 600 } as const;

/** Hvor mange år bakover/forover en kontraktsdato får ligge før den forkastes. */
export const DATE_PAST_YEARS = 10;
export const DATE_FUTURE_YEARS = 15;

export type FieldNorm<T> = {
  /** Normalisert verdi, eller `null` hvis feltet var tomt eller ble forkastet. */
  value: T | null;
  /** Verdien avviker fra det som kom inn (reformatert, avrundet, klampet eller forkastet). */
  changed: boolean;
  /** En oppgitt verdi ble forkastet/kraftig endret → uttrekket bør miste konfidens. */
  dropped: boolean;
  /** Menneskelesbar forklaring når `changed` er true. */
  note: string | null;
};

const NONE: FieldNorm<never> = {
  value: null,
  changed: false,
  dropped: false,
  note: null,
};

function dropped<T>(note: string): FieldNorm<T> {
  return { value: null, changed: true, dropped: true, note };
}

function isBlank(input: unknown): boolean {
  return (
    input === null ||
    input === undefined ||
    (typeof input === "string" && input.trim() === "")
  );
}

/**
 * Godtar `number` eller tallstreng. Runder av, klamper til [min, max].
 * - Tomt/fraværende  → `null`, ikke endret.
 * - Ikke et tall     → `null`, forkastet.
 * - Utenfor område   → klampet verdi, forkastet (uventet fra modellen).
 * - Kun avrunding    → avrundet verdi, endret men ikke forkastet.
 */
export function normalizeInteger(
  input: unknown,
  range: { min: number; max: number },
  label: string,
): FieldNorm<number> {
  if (isBlank(input)) return NONE;

  let n: number;
  if (typeof input === "number") {
    n = input;
  } else if (typeof input === "string") {
    n = Number(input.trim());
  } else {
    return dropped(`${label}: forsto ikke verdien, satt til tom.`);
  }

  if (!Number.isFinite(n)) {
    return dropped(`${label}: «${String(input)}» er ikke et tall, satt til tom.`);
  }

  const rounded = Math.round(n);
  const clamped = Math.min(range.max, Math.max(range.min, rounded));

  if (clamped !== rounded) {
    return {
      value: clamped,
      changed: true,
      dropped: true,
      note: `${label}: ${n} er utenfor ${range.min}–${range.max}, justert til ${clamped}.`,
    };
  }
  if (clamped !== n) {
    return {
      value: clamped,
      changed: true,
      dropped: false,
      note: `${label}: rundet av fra ${n} til ${clamped}.`,
    };
  }
  return { value: clamped, changed: false, dropped: false, note: null };
}

/** ÅÅÅÅ-MM-DD, ÅÅÅÅ/MM/DD eller ÅÅÅÅ.MM.DD → ÅÅÅÅ-MM-DD, ellers null. */
function toIsoDate(raw: string): string | null {
  const m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const [, y, moStr, dStr] = m;
  const month = Number(moStr);
  const day = Number(dStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const iso = `${y}-${moStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return null; // f.eks. 2025-02-30
  }
  return iso;
}

function yearsFrom(isoDay: string, years: number): number {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.getTime();
}

/**
 * Godtar en ISO-dato (med `-`, `/` eller `.` som skille). Krever gyldig
 * kalenderdato innenfor [i dag − 10 år, i dag + 15 år].
 * - Tomt/fraværende          → `null`, ikke endret.
 * - Ugyldig / utenfor område → `null`, forkastet.
 * - Gyldig men reformatert   → ISO-verdi, endret men ikke forkastet.
 */
export function normalizeDate(
  input: unknown,
  today: string,
  label: string,
): FieldNorm<string> {
  if (isBlank(input)) return NONE;
  if (typeof input !== "string") {
    return dropped(`${label}: forsto ikke datoen, satt til tom.`);
  }

  const raw = input.trim();
  const iso = toIsoDate(raw);
  if (!iso) {
    return dropped(`${label}: «${raw}» er ikke en gyldig dato, satt til tom.`);
  }

  const t = new Date(`${iso}T00:00:00Z`).getTime();
  if (t < yearsFrom(today, -DATE_PAST_YEARS) || t > yearsFrom(today, DATE_FUTURE_YEARS)) {
    return dropped(`${label}: ${iso} er utenfor et rimelig tidsrom, satt til tom.`);
  }

  if (iso !== raw) {
    return {
      value: iso,
      changed: true,
      dropped: false,
      note: `${label}: tolket «${raw}» som ${iso}.`,
    };
  }
  return { value: iso, changed: false, dropped: false, note: null };
}

/** Godtar `boolean` eller strengene "true"/"false", ellers `null`. */
export function normalizeBoolean(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (input === "true") return true;
  if (input === "false") return false;
  return null;
}
