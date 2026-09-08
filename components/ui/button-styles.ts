/**
 * Ferdige klasse-strenger for knapper. Rene strenger – trygge å importere
 * i klientkomponenter uten "use client"-smitte.
 */
export const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50";

export const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent-tint";

/** Kompakt sekundærknapp – for tette flater som header-navigasjonen. */
export const btnSecondarySm =
  "inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent-tint";

export const btnDanger =
  "inline-flex items-center justify-center rounded-lg border border-status-critical/40 bg-status-critical-tint px-4 py-2 text-sm font-medium text-status-critical hover:bg-status-critical/15 disabled:opacity-40";
