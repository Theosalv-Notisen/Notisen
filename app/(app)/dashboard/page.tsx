import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError } from "@/lib/fiken";
import {
  analyzeRecurring,
  type Confidence,
  type SupplierRecurrence,
} from "@/lib/recurring";

export const dynamic = "force-dynamic";

const BADGE_TEXT: Record<Confidence, string> = {
  high: "Sannsynlig løpende avtale",
  medium: "Mulig løpende",
  low: "Engangs",
  none: "Engangs",
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

async function loadDashboard(): Promise<DashboardData> {
  try {
    const fiken = await getFikenClientForCurrentUser();
    const companies = await fiken.companies();

    const result = await Promise.all(
      companies.map(async (company) => ({
        name: company.name,
        slug: company.slug,
        rows: analyzeRecurring(await fiken.purchases(company.slug)),
      })),
    );

    return { kind: "ok", companies: result };
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

function SupplierCard({ row }: { row: SupplierRecurrence }) {
  const highlight = row.isLikelyRecurring;

  return (
    <li
      className={
        "rounded-xl border p-4 " +
        (highlight
          ? "border-black/25 bg-black/5 dark:border-white/30 dark:bg-white/10"
          : "border-black/10 dark:border-white/15")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-medium">{row.supplierName}</h3>
        <span className="shrink-0 rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20">
          {BADGE_TEXT[row.confidence]}
        </span>
      </div>

      <p className="mt-2 text-sm opacity-75">{row.reason}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="opacity-60">Antall kjøp</dt>
          <dd>{row.occurrences}</dd>
        </div>
        <div>
          <dt className="opacity-60">Intervall</dt>
          <dd>
            {row.cadence
              ? row.cadence.label
              : row.medianGapDays != null
                ? `ca. ${row.medianGapDays} dager`
                : "ukjent"}
          </dd>
        </div>
        <div>
          <dt className="opacity-60">Dager mellom</dt>
          <dd>{row.medianGapDays != null ? row.medianGapDays : "–"}</dd>
        </div>
        <div>
          <dt className="opacity-60">Typisk beløp</dt>
          <dd>{formatNok(row.medianAmountNok)}</dd>
        </div>
      </dl>
    </li>
  );
}

export default async function DashboardPage() {
  await requireUser("/dashboard");
  const data = await loadDashboard();

  if (data.kind === "not_connected") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Oversikt</h1>
        <div className="mt-8 rounded-xl border border-black/10 p-6 dark:border-white/15">
          <p className="text-sm opacity-75">
            Du har ikke koblet til Fiken enda. Koble til for å se leverandørene
            dine og hvilke som ser ut som løpende avtaler.
          </p>
          <Link
            href="/settings"
            className="mt-4 inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Gå til innstillinger
          </Link>
        </div>
      </div>
    );
  }

  if (data.kind === "reauth") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Oversikt</h1>
        <div className="mt-8 rounded-xl border border-black/10 p-6 dark:border-white/15">
          <p className="text-sm opacity-75">
            Tilkoblingen til Fiken har utløpt. Du må fornye tilkoblingen for å se
            oppdaterte tall.
          </p>
          <Link
            href="/settings"
            className="mt-4 inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Forny tilkobling
          </Link>
        </div>
      </div>
    );
  }

  if (data.kind === "fiken_error") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Oversikt</h1>
        <p className="mt-8 rounded-xl border border-black/10 p-6 text-sm opacity-75 dark:border-white/15">
          Klarte ikke hente data fra Fiken nå. Prøv igjen om litt.
        </p>
      </div>
    );
  }

  if (data.kind === "error") {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Oversikt</h1>
        <p className="mt-8 rounded-xl border border-black/10 p-6 text-sm opacity-75 dark:border-white/15">
          Noe gikk galt da vi hentet dataene dine. Prøv igjen om litt.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Oversikt</h1>
      <p className="mt-2 text-sm opacity-70">
        Leverandører fra Fiken, sortert etter hvor sannsynlig det er at de er en
        løpende avtale.
      </p>

      {data.companies.length === 0 ? (
        <p className="mt-8 text-sm opacity-75">
          Fant ingen selskaper i Fiken-tilkoblingen.
        </p>
      ) : null}

      {data.companies.map((company) => (
        <section key={company.slug} className="mt-8">
          <h2 className="font-medium">{company.name}</h2>

          {company.rows.length === 0 ? (
            <p className="mt-2 text-sm opacity-60">
              Ingen kjøp med leverandør å analysere.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {company.rows.map((row) => (
                <SupplierCard key={row.supplierId} row={row} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
