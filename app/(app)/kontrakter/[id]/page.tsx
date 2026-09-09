import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatDeadline,
  isStuckProcessing,
  STATUS_LABEL,
  type ContractStatus,
} from "@/lib/contract-status";
import { confirmContract } from "../actions";
import { ExtractControls } from "./extract-controls";
import { DeleteButton } from "./delete-button";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";
import {
  ALLOWED_REMINDER_OFFSETS,
  effectiveReminderOffsets,
} from "@/lib/reminder-offsets";

export const dynamic = "force-dynamic";

type ContractDetail = {
  id: string;
  status: ContractStatus;
  updated_at: string | null;
  original_filename: string | null;
  contract_start: string | null;
  term_months: number | null;
  binding_until: string | null;
  auto_renews: boolean | null;
  renewal_date: string | null;
  notice_period_days: number | null;
  extraction_confidence: "high" | "medium" | "low" | null;
  extraction_notes: string | null;
  extraction_error: string | null;
  needs_review: boolean;
  next_deadline: string | null;
  deadline_rolled_at: string | null;
  llm_model: string | null;
  llm_raw: unknown;
  supplier: { name: string; organization_number: string | null } | null;
};

/**
 * Leser `reminder_offsets` i et eget, isolert kall. Er kolonnen ikke migrert
 * inn ennå (`add column reminder_offsets integer[]`), svarer PostgREST med en
 * feil – vi svelger den og lar kontrakten falle tilbake på standardtersklene.
 */
async function readReminderOffsets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<number[] | null> {
  const { data, error } = await supabase
    .from("contract")
    .select("reminder_offsets")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data?.reminder_offsets as number[] | null) ?? null;
}

type Quote = { field: string; quote: string };

function quotesFor(llmRaw: unknown, field: string): string[] {
  if (!llmRaw || typeof llmRaw !== "object") return [];
  const quotes = (llmRaw as { source_quotes?: Quote[] }).source_quotes;
  if (!Array.isArray(quotes)) return [];
  return quotes
    .filter((q) => q && q.field === field && typeof q.quote === "string")
    .map((q) => q.quote);
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Høy",
  medium: "Middels",
  low: "Lav",
};

function Belegg({ quotes }: { quotes: string[] }) {
  if (quotes.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs text-ink-tertiary">
      {quotes.map((q, i) => (
        <li key={i} className="border-l-2 border-border pl-2">
          «{q}»
        </li>
      ))}
    </ul>
  );
}

export default async function KontraktDetaljPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    bekreftet?: string;
    uten_frist?: string;
    justert?: string;
    feil?: "slett" | "bekreft" | string;
  }>;
}) {
  const { id } = await params;
  const { bekreftet, uten_frist, justert, feil } = await searchParams;
  await requireUser(`/kontrakter/${id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract")
    .select(
      "id, status, updated_at, original_filename, contract_start, term_months, binding_until, auto_renews, renewal_date, notice_period_days, extraction_confidence, extraction_notes, extraction_error, needs_review, next_deadline, deadline_rolled_at, llm_model, llm_raw, supplier:supplier_id (name, organization_number)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <Alert variant="critical">
        Klarte ikke hente kontrakten nå. Prøv igjen om litt.
      </Alert>
    );
  }
  if (!data) notFound();

  const c = data as unknown as ContractDetail;
  const showForm = c.status === "extracted" || c.status === "confirmed";

  const storedOffsets = showForm ? await readReminderOffsets(supabase, id) : null;
  const activeOffsets = new Set(effectiveReminderOffsets(storedOffsets));

  return (
    <div>
      <Link
        href="/kontrakter"
        className="text-sm text-ink-secondary hover:text-ink"
      >
        ← Alle kontrakter
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {c.supplier?.name ?? "Ukjent leverandør"}
        </h1>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-ink-secondary">
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
      </div>

      <p className="mt-1 text-sm text-ink-secondary">
        {c.supplier?.organization_number
          ? `Org.nr ${c.supplier.organization_number} · `
          : ""}
        <a
          href={`/api/contracts/${c.id}/file`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Åpne PDF{c.original_filename ? ` (${c.original_filename})` : ""}
        </a>
      </p>

      {bekreftet && uten_frist ? (
        <Alert variant="warning" className="mt-4">
          Kontrakten er lagret, men vi fant ingen dato å telle ned til. Da får du
          ikke påminnelser for denne før du legger inn en frist (startdato +
          varighet, bindingstid eller fornyelsesdato) manuelt.
        </Alert>
      ) : bekreftet ? (
        <Alert variant="good" className="mt-4">
          Kontrakten er bekreftet. Nå kan den utløse påminnelser.
        </Alert>
      ) : null}

      {justert ? (
        <Alert variant="warning" className="mt-4">
          Noen felt ble justert ved lagring: {justert}. Sjekk verdiene og lagre
          på nytt om noe ble feil.
        </Alert>
      ) : null}

      {feil === "slett" ? (
        <Alert variant="critical" className="mt-4">
          Klarte ikke slette kontrakten. Den finnes kanskje ikke lenger, eller du
          har ikke tilgang til den.
        </Alert>
      ) : null}

      {feil === "bekreft" ? (
        <Alert variant="critical" className="mt-4">
          Klarte ikke bekrefte kontrakten. Den finnes kanskje ikke lenger, eller
          du har ikke tilgang til den.
        </Alert>
      ) : null}

      {c.deadline_rolled_at ? (
        <Alert variant="warning" className="mt-4">
          {c.next_deadline
            ? `Forrige periodes oppsigelsesfrist er passert. Ny frist er beregnet til ${formatDeadline(
                c.next_deadline,
              )}. Sjekk at den stemmer – lagre på nytt for å bekrefte.`
            : "Forrige frist er passert, og vi klarte ikke regne ut en ny (avtalen fornyes ikke automatisk, eller feltene er mangelfulle). Gå gjennom feltene og lagre, eller slett kontrakten hvis den er avsluttet."}
        </Alert>
      ) : null}

      {c.needs_review && c.status !== "confirmed" ? (
        <Alert variant="neutral" className="mt-4">
          Denne trenger en gjennomgang. Sjekk feltene mot PDF-en og bekreft.
        </Alert>
      ) : null}

      {/* ── Tilstandsavhengige kontroller ─────────────────────────── */}
      {c.status === "draft" ? (
        <p className="mt-6 text-sm text-ink-secondary">
          PDF-en er ikke ferdig lastet opp. Last opp kontrakten på nytt.
        </p>
      ) : null}

      {c.status === "uploaded" ? (
        <ExtractControls contractId={c.id} mode="run" />
      ) : null}

      {c.status === "processing" ? (
        <ExtractControls
          contractId={c.id}
          mode={isStuckProcessing(c.updated_at) ? "stuck" : "processing"}
        />
      ) : null}

      {c.status === "failed" ? (
        <div className="mt-4">
          <Alert variant="critical">
            Tolkningen feilet: {c.extraction_error ?? "ukjent feil"}
          </Alert>
          <ExtractControls contractId={c.id} mode="retry" />
        </div>
      ) : null}

      {/* ── Uttrukne felt + bekreft-skjema ────────────────────────── */}
      {showForm ? (
        <>
          <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-ink-tertiary">Beregnet oppsigelsesfrist</dt>
              <dd className="flex flex-wrap items-center gap-2 tabular-nums">
                {formatDeadline(c.next_deadline)}
                <StatusBadge deadline={c.next_deadline} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Konfidens fra tolkningen</dt>
              <dd>
                {c.extraction_confidence
                  ? (CONFIDENCE_LABEL[c.extraction_confidence] ??
                    c.extraction_confidence)
                  : "–"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Modell</dt>
              <dd className="truncate">{c.llm_model ?? "–"}</dd>
            </div>
            {c.extraction_notes ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-tertiary">Merknader fra tolkningen</dt>
                <dd>{c.extraction_notes}</dd>
              </div>
            ) : null}
          </dl>

          <form action={confirmContract} className="mt-8 space-y-5">
            <input type="hidden" name="id" value={c.id} />

            <div>
              <label className={labelClass}>
                Startdato
                <input
                  type="date"
                  name="contract_start"
                  defaultValue={c.contract_start ?? ""}
                  className={inputClass + " tabular-nums"}
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "contract_start")} />
            </div>

            <div>
              <label className={labelClass}>
                Bindingstid utløper
                <input
                  type="date"
                  name="binding_until"
                  defaultValue={c.binding_until ?? ""}
                  className={inputClass + " tabular-nums"}
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "binding_until")} />
            </div>

            <div>
              <label className={labelClass}>
                Fornyelsesdato
                <input
                  type="date"
                  name="renewal_date"
                  defaultValue={c.renewal_date ?? ""}
                  className={inputClass + " tabular-nums"}
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "renewal_date")} />
            </div>

            <div>
              <label className={labelClass}>
                Avtaleperiode (måneder)
                <input
                  type="number"
                  name="term_months"
                  min={0}
                  defaultValue={c.term_months ?? ""}
                  className={inputClass + " w-40 tabular-nums"}
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "term_months")} />
            </div>

            <div>
              <label className={labelClass}>
                Oppsigelsesfrist (dager)
                <input
                  type="number"
                  name="notice_period_days"
                  min={0}
                  defaultValue={c.notice_period_days ?? ""}
                  className={inputClass + " w-40 tabular-nums"}
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "notice_period_days")} />
            </div>

            <div>
              <label className={labelClass}>
                Fornyes automatisk
                <select
                  name="auto_renews"
                  defaultValue={
                    c.auto_renews === null ? "" : c.auto_renews ? "true" : "false"
                  }
                  className={inputClass}
                >
                  <option value="">Vet ikke</option>
                  <option value="true">Ja</option>
                  <option value="false">Nei</option>
                </select>
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "auto_renews")} />
            </div>

            <fieldset>
              <legend className={labelClass}>Varsle meg før fristen</legend>
              <p className="mt-1 text-xs text-ink-tertiary">
                Du får én e-post per avkrysset tidspunkt. Standard er 30 og 7
                dager før.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {ALLOWED_REMINDER_OFFSETS.map((days) => (
                  <label
                    key={days}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="reminder_offsets"
                      value={days}
                      defaultChecked={activeOffsets.has(days)}
                      className="accent-accent"
                    />
                    <span className="tabular-nums">
                      {days} {days === 1 ? "dag" : "dager"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button type="submit" className={btnPrimary}>
              {c.status === "confirmed"
                ? "Lagre endringer"
                : "Bekreft kontrakten"}
            </button>
            <p className="text-xs text-ink-tertiary">
              Fristen regnes ut på nytt fra feltene når du bekrefter. Først når
              kontrakten er bekreftet kan den utløse påminnelser.
            </p>
          </form>
        </>
      ) : null}

      {/* ── Faresone ──────────────────────────────────────────────── */}
      <section className="mt-16 border-t border-status-critical/25 pt-6">
        <h2 className="text-sm font-semibold text-status-critical">Faresone</h2>
        <p className="mt-1 text-xs text-ink-tertiary">
          Sletting fjerner kontrakten, PDF-en og alle planlagte påminnelser
          permanent. Dette kan ikke angres.
        </p>
        <div className="mt-3">
          <DeleteButton contractId={c.id} />
        </div>
      </section>
    </div>
  );
}
