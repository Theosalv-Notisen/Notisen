/**
 * Statisk produktbilde av Oversikt-siden, til den offentlige forsiden.
 *
 * Bygget med de samme design-tokene, kortstilene og typografien som selve
 * appen (`app/(app)/dashboard/page.tsx`), men med fiktive eksempeldata og uten
 * interaksjon. Presentert i en enkel «nettleser»-ramme så det leser som et
 * skjermbilde.
 */

type Rad = {
  navn: string;
  highlight: boolean;
  pille: string;
  begrunnelse: string;
  data?: { kjop: string; intervall: string; dager: string; belop: string };
};

const RADER: Rad[] = [
  {
    navn: "Skyfjord Programvare AS",
    highlight: true,
    pille: "Sannsynlig løpende avtale",
    begrunnelse: "12 kjøp, ca. 30 dager mellom hver, likt beløp (~2 490 kr).",
    data: {
      kjop: "12",
      intervall: "månedlig",
      dager: "30",
      belop: "2 490 kr",
    },
  },
  {
    navn: "Nordhaug Forsikring AS",
    highlight: false,
    pille: "Muligens løpende (usikker)",
    begrunnelse: "2 kjøp, ca. 365 dager mellom hver.",
    data: { kjop: "2", intervall: "årlig", dager: "365", belop: "18 900 kr" },
  },
  {
    navn: "Vestland Kontorrekvisita AS",
    highlight: false,
    pille: "Engangs",
    begrunnelse: "1 kjøp – ingen gjentakelse å se.",
  },
];

export function DashboardMockup() {
  return (
    <div
      role="img"
      aria-label="Skjermbilde av Oversikt-siden i Notisen, med eksempeldata"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-paper px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        <span className="ml-2 rounded-md bg-ink/5 px-2 py-0.5 text-xs text-ink-tertiary">
          notisen.no/oversikt
        </span>
      </div>

      <div className="bg-paper p-5 sm:p-6" aria-hidden="true">
        <p className="text-lg font-bold tracking-tight">Oversikt</p>
        <p className="mt-1 text-xs text-ink-secondary">
          <span className="font-medium text-ink tabular-nums">3</span>{" "}
          leverandører fra Fiken ·{" "}
          <span className="font-medium text-ink tabular-nums">1</span> sannsynlig
          løpende avtale
        </p>

        <div className="mt-4 space-y-3">
          {RADER.map((rad) => (
            <div
              key={rad.navn}
              className={
                "rounded-xl border p-4 " +
                (rad.highlight
                  ? "border-accent bg-accent-tint shadow-sm"
                  : "border-border bg-surface")
              }
            >
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <p className="text-sm font-medium">{rad.navn}</p>
                <span
                  className={
                    "shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] " +
                    (rad.highlight
                      ? "bg-surface text-accent-hover ring-1 ring-accent/20"
                      : "bg-ink/5 text-ink-secondary")
                  }
                >
                  {rad.pille}
                </span>
              </div>

              <p className="mt-1.5 text-xs text-ink-secondary">
                {rad.begrunnelse}
              </p>

              {rad.data ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-tertiary">Kjøp</dt>
                    <dd className="tabular-nums">{rad.data.kjop}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-tertiary">Intervall</dt>
                    <dd>{rad.data.intervall}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-tertiary">Dager mellom</dt>
                    <dd className="tabular-nums">{rad.data.dager}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-tertiary">Typisk beløp</dt>
                    <dd className="tabular-nums">{rad.data.belop}</dd>
                  </div>
                </dl>
              ) : null}

              {rad.highlight ? (
                <span className="mt-4 inline-flex rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">
                  Last opp kontrakt
                </span>
              ) : (
                <span className="mt-4 inline-flex rounded-lg border border-border px-3 py-1.5 text-xs text-ink-secondary">
                  Last opp kontrakt
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
