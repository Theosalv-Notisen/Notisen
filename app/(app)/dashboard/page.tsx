import Link from "next/link";
import { unstable_cache } from "next/cache";
import { getCurrentUser, requireUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenClient, FikenError } from "@/lib/fiken";
import {
  analyzeRecurring,
  type Confidence,
  type SupplierRecurrence,
} from "@/lib/recurring";
import { Alert } from "@/components/ui/alert";
import { btnPrimary, btnSecondarySm } from "@/components/ui/button-styles";
import { card, cardTight } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const BADGE_TEXT: Record<Confidence, string> = {
  high: "Sannsynlig løpende avtale",
  medium: "Mulig løpende",
  low: "Muligens løpende (usikker)",
  none: "Engangs",
};

/** Fylt statuspille: grønn for løpende-kandidatene, nøytral grå for resten. */
const BADGE_CLASS: Record<Confidence, string> = {
  high: "bg-accent-tint text-accent-hover",
  medium: "bg-accent-tint text-accent-hover",
  low: "bg-ink/5 text-ink-secondary",
  none: "bg-ink/5 text-ink-secondary",
};

type CompanyRows = {
  name: string;
  slug: string;
  rows: SupplierRecurrence[];
};

type DashboardData =
  | { kind: "ok"; companies: CompanyRows[] }
  | { kind: "not_connected" }
  | { kind: "reauth" }
  | { kind: "fiken_error" }
  | { kind: "error" };

/**
 * De tunge Fiken-kallene (selskaper + alle bilag per selskap), cachet i
 * 3 minutter per bruker. Fiken-data endrer seg ikke fra minutt til minutt, så
 * bare den første Oversikt-lasten i vinduet betaler for nettverket – resten er
 * umiddelbare. `token` er med som argument slik at et rotert token gir cache-miss.
 */
function loadFikenData(userId: string) {
  return unstable_cache(
    async (token: string): Promise<CompanyRows[]> => {
      const client = new FikenClient(token);
      const companies = await client.companies();
      return Promise.all(
        companies.map(async (company) => ({
          name: company.name,
          slug: company.slug,
          rows: analyzeRecurring(await client.purchases(company.slug)),
        })),
      );
    },
    ["dashboard-fiken", userId],
    { revalidate: 180 },
  );
}

async function loadDashboard(): Promise<DashboardData> {
  try {
    const fiken = await getFikenClientForCurrentUser();
    const user = await getCurrentUser();
    const token = await fiken.resolveToken();

    const companies = await loadFikenData(user!.id)(token);

    return { kind: "ok", companies };
  } catch (err) {
    if (err instanceof NoFikenConnectionError) return { kind: "not_connected" };
    if (err instanceof FikenReauthRequiredError) return { kind: "reauth" };
    if (err instanceof FikenError) return { kind: "fiken_error" };
    console.error("Uventet feil ved lasting av dashboard:", err);
    return { kind: "error" };
  }
}

function formatNok(amount: number | null): string {
  if (amount == null) return "ukjent beløp";
  return `${amount.toLocaleString("nb-NO")} kr`;
}

function SupplierCard({
  row,
  companySlug,
}: {
  row: SupplierRecurrence;
  companySlug: string;
}) {
  const highlight = row.isLikelyRecurring;

  return (
    <li
      className={
        "rounded-xl border p-4 " +
        (highlight
          ? "border-accent bg-accent-tint shadow-sm"
          : "border-border bg-surface")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-medium">{row.supplierName}</h3>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-xs " +
            BADGE_CLASS[row.confidence]
          }
        >
          {BADGE_TEXT[row.confidence]}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-secondary">{row.reason}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-tertiary">Antall kjøp</dt>
          <dd className="tabular-nums">{row.occurrences}</dd>
        </div>
        <div>
          <dt className="text-ink-tertiary">Intervall</dt>
          <dd className="tabular-nums">
            {row.cadence
              ? row.cadence.label
              : row.medianGapDays != null
                ? `ca. ${row.medianGapDays} dager`
                : "ukjent"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-tertiary">Dager mellom</dt>
          <dd className="tabular-nums">
            {row.medianGapDays != null ? row.medianGapDays : "–"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-tertiary">Typisk beløp</dt>
          <dd className="tabular-nums">{formatNok(row.medianAmountNok)}</dd>
        </div>
      </dl>

      <Link
        href={`/kontrakter/ny?company=${encodeURIComponent(
          companySlug,
        )}&contact=${row.supplierId}`}
        className={(highlight ? btnPrimary : btnSecondarySm) + " mt-4"}
      >
        Last opp kontrakt
      </Link>
    </li>
  );
}

export default async function DashboardPage() {
  await requireUser("/dashboard");
  const data = await loadDashboard();

  if (data.kind === "not_connected") {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Oversikt</h1>
        <div className={card + " mt-8"}>
          <p className="text-sm text-ink-secondary">
            Du har ikke koblet til Fiken enda. Koble til for å se leverandørene
            dine og hvilke som ser ut som løpende avtaler.
          </p>
          <Link href="/settings" className={btnPrimary + " mt-4"}>
            Gå til innstillinger
          </Link>
        </div>
      </div>
    );
  }

  if (data.kind === "reauth") {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Oversikt</h1>
        <div className={card + " mt-8"}>
          <p className="text-sm text-ink-secondary">
            Tilkoblingen til Fiken har utløpt. Du må fornye tilkoblingen for å se
            oppdaterte tall.
          </p>
          <Link href="/settings" className={btnPrimary + " mt-4"}>
            Forny tilkobling
          </Link>
        </div>
      </div>
    );
  }

  if (data.kind === "fiken_error") {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Oversikt</h1>
        <Alert variant="neutral" className="mt-8">
          Klarte ikke hente data fra Fiken nå. Prøv igjen om litt.
        </Alert>
      </div>
    );
  }

  if (data.kind === "error") {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Oversikt</h1>
        <Alert variant="critical" className="mt-8">
          Noe gikk galt da vi hentet dataene dine. Prøv igjen om litt.
        </Alert>
      </div>
    );
  }

  const allRows = data.companies.flatMap((c) => c.rows);
  const supplierCount = allRows.length;
  const likelyCount = allRows.filter((r) => r.isLikelyRecurring).length;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Oversikt</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Leverandører fra Fiken, sortert etter hvor sannsynlig det er at de er en
        løpende avtale.
      </p>

      {supplierCount > 0 ? (
        <p className="mt-4 text-sm text-ink-secondary">
          <span className="font-medium text-ink tabular-nums">
            {supplierCount}
          </span>{" "}
          {supplierCount === 1 ? "leverandør" : "leverandører"} fra Fiken
          {" · "}
          <span className="font-medium text-ink tabular-nums">
            {likelyCount}
          </span>{" "}
          {likelyCount === 1
            ? "sannsynlig løpende avtale"
            : "sannsynlige løpende avtaler"}
        </p>
      ) : null}

      {data.companies.length === 0 ? (
        <div className={cardTight + " mt-8 text-sm text-ink-secondary"}>
          Fant ingen selskaper i Fiken-tilkoblingen.
        </div>
      ) : null}

      {data.companies.map((company) => (
        <section key={company.slug} className="mt-8">
          <h2 className="font-medium">{company.name}</h2>

          {company.rows.length === 0 ? (
            <p className="mt-2 text-sm text-ink-tertiary">
              Ingen kjøp med leverandør å analysere.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {company.rows.map((row) => (
                <SupplierCard
                  key={row.supplierId}
                  row={row}
                  companySlug={company.slug}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
