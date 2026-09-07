/**
 * Beregner NESTE dato man senest må si opp en avtale innen for å slippe at
 * den binder / fornyer seg videre.
 *
 * Ren funksjon – ingen nettverk, ingen `Date.now()`. `today` sendes inn som
 * 'ÅÅÅÅ-MM-DD' så logikken kan testes tabelldrevet (scripts/deadline-test.ts).
 *
 * Konservativ med vilje: heller `null` + "trenger gjennomgang" enn en gjettet
 * dato som ender med å trigge et varsel til feil tid.
 */

export type DeadlineFields = {
  /** Avtalen startet. */
  contractStart: string | null;
  /** Avtaleperiode i måneder (for beregnet fornyelse). */
  termMonths: number | null;
  /** Bindingstid utløper. */
  bindingUntil: string | null;
  /** Fornyer seg automatisk hvis den ikke sies opp. */
  autoRenews: boolean | null;
  /** Eksplisitt neste fornyelsesdato, hvis kontrakten oppgir en. */
  renewalDate: string | null;
  /** Oppsigelsesfrist i dager før fornyelse/bindingstidens utløp. */
  noticePeriodDays: number | null;
};

export type DeadlineResult = { date: string | null; reason: string };

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/** Tidligste dato >= `now` som har samme måned/dag som `anchor`. */
function nextAnniversary(anchor: Date, now: Date): Date {
  const y = now.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  let occ = new Date(Date.UTC(y, month, day));
  if (occ.getTime() < now.getTime()) {
    occ = new Date(Date.UTC(y + 1, month, day));
  }
  return occ;
}

export function computeNextDeadline(
  fields: DeadlineFields,
  today: string,
): DeadlineResult {
  const now = parseDate(today);
  const notice = fields.noticePeriodDays ?? 0;

  const start = fields.contractStart ? parseDate(fields.contractStart) : null;
  const binding = fields.bindingUntil ? parseDate(fields.bindingUntil) : null;
  const renewal = fields.renewalDate ? parseDate(fields.renewalDate) : null;
  const termMonths =
    fields.termMonths != null && fields.termMonths > 0 ? fields.termMonths : null;

  // 6. Motstridende datoer → ikke prøv å regne.
  if (start && binding && binding.getTime() < start.getTime()) {
    return {
      date: null,
      reason:
        "Motstridende datoer: bindingstiden utløper før avtalen starter. Trenger manuell gjennomgang.",
    };
  }
  if (start && renewal && renewal.getTime() < start.getTime()) {
    return {
      date: null,
      reason:
        "Motstridende datoer: fornyelsesdatoen er før avtalen starter. Trenger manuell gjennomgang.",
    };
  }

  // 1. Verken oppsigelsesfrist eller noe datofeste → kan ikke si noe trygt.
  if (fields.noticePeriodDays == null && !renewal && !binding) {
    return {
      date: null,
      reason:
        "Fant verken oppsigelsesfrist, bindingstid eller fornyelsesdato i uttrekket. Trenger manuell gjennomgang.",
    };
  }

  // 2. Bindingstid i framtida – den styrer.
  if (binding && binding.getTime() > now.getTime()) {
    let boundary = binding;
    let candidate = addDays(boundary, -notice);

    // 5. Fristen før bindingstidens utløp er alt passert.
    if (candidate.getTime() < now.getTime() && fields.autoRenews) {
      const period = termMonths ?? 12; // "år som default"
      boundary = addMonths(boundary, period);
      candidate = addDays(boundary, -notice);
    }

    if (candidate.getTime() >= now.getTime()) {
      return {
        date: toISO(candidate),
        reason:
          boundary === binding
            ? `Bindingstiden utløper ${toISO(binding)}. Si opp senest ${notice} dager før.`
            : `Oppsigelsesfristen før bindingstidens utløp er passert; neste mulighet er ${toISO(boundary)}. Si opp senest ${notice} dager før.`,
      };
    }

    return {
      date: null,
      reason: `Oppsigelsesfristen knyttet til bindingstiden (${toISO(binding)}) ser ut til å være passert. Trenger manuell gjennomgang.`,
    };
  }

  // 3. Auto-fornyelse med eksplisitt fornyelsesdato.
  if (fields.autoRenews && renewal) {
    let occ = nextAnniversary(renewal, now);
    let candidate = addDays(occ, -notice);
    if (candidate.getTime() < now.getTime()) {
      // 5. Rull fram ett år til neste fornyelse.
      occ = new Date(
        Date.UTC(occ.getUTCFullYear() + 1, occ.getUTCMonth(), occ.getUTCDate()),
      );
      candidate = addDays(occ, -notice);
    }
    if (candidate.getTime() >= now.getTime()) {
      return {
        date: toISO(candidate),
        reason: `Avtalen fornyes automatisk ${toISO(occ)}. Si opp senest ${notice} dager før.`,
      };
    }
    return {
      date: null,
      reason:
        "Klarte ikke regne ut en framtidig oppsigelsesfrist fra fornyelsesdatoen. Trenger manuell gjennomgang.",
    };
  }

  // 4. Auto-fornyelse utledet av startdato + periodelengde.
  if (fields.autoRenews && start && termMonths) {
    let boundary = new Date(start);
    let guard = 0;
    while (boundary.getTime() <= now.getTime() && guard < 2000) {
      boundary = addMonths(boundary, termMonths);
      guard++;
    }
    let candidate = addDays(boundary, -notice);
    if (candidate.getTime() < now.getTime()) {
      // 5. Rull fram én periode.
      boundary = addMonths(boundary, termMonths);
      candidate = addDays(boundary, -notice);
    }
    if (candidate.getTime() >= now.getTime()) {
      return {
        date: toISO(candidate),
        reason: `Avtaleperioden på ${termMonths} md. fornyes ${toISO(boundary)}. Si opp senest ${notice} dager før.`,
      };
    }
    return {
      date: null,
      reason:
        "Klarte ikke regne ut en framtidig oppsigelsesfrist fra startdato og periodelengde. Trenger manuell gjennomgang.",
    };
  }

  // Bindingstid i fortida uten kjent fornyelse.
  if (binding && binding.getTime() <= now.getTime()) {
    return {
      date: null,
      reason: `Bindingstiden (${toISO(binding)}) er utløpt og avtalen har ingen kjent fornyelsesdato. Trenger manuell gjennomgang.`,
    };
  }

  // Har en oppsigelsesfrist, men ingenting å feste den til.
  return {
    date: null,
    reason:
      "Ikke nok informasjon til å regne ut en trygg oppsigelsesfrist (mangler bindingstid, fornyelsesdato eller periodelengde). Trenger manuell gjennomgang.",
  };
}
