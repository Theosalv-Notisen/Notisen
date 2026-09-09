"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { card } from "@/components/ui/card";

/**
 * Del 1 av forhandlingscopiloten, klient-side: henter
 * `/api/contracts/<id>/insight` etter at siden er lastet og viser
 * prisutvikling, forbruk og mulig overlapp for leverandøren.
 *
 * Henter i bakgrunnen så en treg/manglende Fiken-kobling aldri blokkerer
 * kontraktsdetaljsiden. Er det ingenting nyttig å vise (manuell avtale,
 * ingen kjøp, teknisk feil) rendrer komponenten ingenting.
 */

const NOTABLE_INCREASE_PCT = 10;

type Insight = {
  supplierName: string;
  transactionCount: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  dominantCategoryLabel: string | null;
  priceTrend: {
    changePct: number;
    earlierMedianNok: number;
    recentMedianNok: number;
    since: string;
    until: string;
  } | null;
  spend: {
    supplierAnnualNok: number;
    totalAnnualNok: number;
    sharePct: number;
  } | null;
  overlaps: {
    fikenContactId: number;
    supplierName: string;
    categoryLabel: string;
  }[];
};

type Response =
  | { available: true; insight: Insight }
  | { available: false; reason: string };

function kr(n: number): string {
  return `${n.toLocaleString("nb-NO")} kr`;
}

export function SupplierInsight({ contractId }: { contractId: string }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "done"; data: Response } | { kind: "failed" }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/contracts/${contractId}/insight`)
      .then((r) => r.json())
      .then((data: Response) => {
        if (alive) setState({ kind: "done", data });
      })
      .catch(() => {
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [contractId]);

  if (state.kind === "loading") {
    return (
      <section className="mt-12 border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Innsikt fra regnskapet</h2>
        <p className="mt-2 text-sm text-ink-tertiary">Henter tall fra Fiken …</p>
      </section>
    );
  }

  if (state.kind === "failed") return null;

  const { data } = state;

  if (!data.available) {
    if (data.reason === "not_connected") {
      return (
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="text-sm font-semibold">Innsikt fra regnskapet</h2>
          <p className="mt-2 text-sm text-ink-tertiary">
            Koble til Fiken under Innstillinger for å se prisutvikling og forbruk
            for denne leverandøren.
          </p>
        </section>
      );
    }
    if (data.reason === "reauth") {
      return (
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="text-sm font-semibold">Innsikt fra regnskapet</h2>
          <p className="mt-2 text-sm text-ink-tertiary">
            Fiken-tilkoblingen må fornyes (Innstillinger) for å vise innsikt.
          </p>
        </section>
      );
    }
    if (data.reason === "no_data") {
      return (
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="text-sm font-semibold">Innsikt fra regnskapet</h2>
          <p className="mt-2 text-sm text-ink-tertiary">
            Fant ingen kjøp fra denne leverandøren i Fiken ennå.
          </p>
        </section>
      );
    }
    // manual, no_company, fiken_error, error → ikke vis noe.
    return null;
  }

  const { insight } = data;
  const trend = insight.priceTrend;
  const notableIncrease = trend != null && trend.changePct >= NOTABLE_INCREASE_PCT;

  return (
    <section className="mt-12 border-t border-border pt-6">
      <h2 className="text-sm font-semibold">Innsikt fra regnskapet</h2>
      <p className="mt-1 text-xs text-ink-tertiary">
        Hentet direkte fra kjøpene dine i Fiken
        {insight.transactionCount > 0
          ? ` (${insight.transactionCount} ${
              insight.transactionCount === 1 ? "kjøp" : "kjøp"
            }${
              insight.firstPurchaseDate
                ? ` siden ${insight.firstPurchaseDate}`
                : ""
            })`
          : ""}
        .
      </p>

      <div className={card + " mt-3 space-y-4"}>
        {/* Prisutvikling */}
        <div>
          <div className="text-xs text-ink-tertiary">Prisutvikling</div>
          {trend ? (
            notableIncrease ? (
              <Alert variant="warning" className="mt-1">
                Prisen har økt <strong>{trend.changePct} %</strong> – fra rundt{" "}
                {kr(trend.earlierMedianNok)} til {kr(trend.recentMedianNok)} per
                faktura ({trend.since} → {trend.until}).
              </Alert>
            ) : (
              <p className="mt-1 text-sm text-ink-secondary">
                {trend.changePct > 0
                  ? `Prisen har økt ${trend.changePct} %`
                  : `Prisen har gått ned ${Math.abs(trend.changePct)} %`}{" "}
                – fra rundt {kr(trend.earlierMedianNok)} til{" "}
                {kr(trend.recentMedianNok)} per faktura ({trend.since} →{" "}
                {trend.until}).
              </p>
            )
          ) : (
            <p className="mt-1 text-sm text-ink-secondary">
              Ingen tydelig prisendring å lese ut av historikken.
            </p>
          )}
        </div>

        {/* Årlig forbruk + andel */}
        {insight.spend ? (
          <div className="border-t border-border pt-4">
            <div className="text-xs text-ink-tertiary">Forbruk siste 12 mnd</div>
            <p className="mt-1 text-sm text-ink-secondary">
              Du har betalt <strong>{kr(insight.spend.supplierAnnualNok)}</strong>{" "}
              til {insight.supplierName} det siste året – {insight.spend.sharePct}{" "}
              % av de samlede leverandørkostnadene dine (
              {kr(insight.spend.totalAnnualNok)}).
            </p>
          </div>
        ) : null}

        {/* Mulig overlapp */}
        {insight.overlaps.length > 0 ? (
          <div className="border-t border-border pt-4">
            <div className="text-xs text-ink-tertiary">Mulig overlapp</div>
            <p className="mt-1 text-sm text-ink-secondary">
              {insight.overlaps.map((o) => o.supplierName).join(", ")}{" "}
              {insight.overlaps.length === 1 ? "føres" : "føres også"} på samme
              konto
              {insight.overlaps[0].categoryLabel
                ? ` (${insight.overlaps[0].categoryLabel})`
                : ""}
              . Sjekk om avtalene overlapper.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
