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
  llm_model: string | null;
  llm_raw: unknown;
  supplier: { name: string; organization_number: string | null } | null;
};

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
    <ul className="mt-1 space-y-1 text-xs opacity-60">
      {quotes.map((q, i) => (
        <li key={i} className="border-l-2 border-black/20 pl-2 dark:border-white/20">
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
      "id, status, updated_at, original_filename, contract_start, term_months, binding_until, auto_renews, renewal_date, notice_period_days, extraction_confidence, extraction_notes, extraction_error, needs_review, next_deadline, llm_model, llm_raw, supplier:supplier_id (name, organization_number)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-300">
        Klarte ikke hente kontrakten nå. Prøv igjen om litt.
      </p>
    );
  }
  if (!data) notFound();

  const c = data as unknown as ContractDetail;
  const showForm = c.status === "extracted" || c.status === "confirmed";

  return (
    <div>
      <Link href="/kontrakter" className="text-sm opacity-70 hover:opacity-100">
        ← Alle kontrakter
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          {c.supplier?.name ?? "Ukjent leverandør"}
        </h1>
        <span className="shrink-0 rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20">
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
      </div>

      <p className="mt-1 text-sm opacity-70">
        {c.supplier?.organization_number
          ? `Org.nr ${c.supplier.organization_number} · `
          : ""}
        <a
          href={`/api/contracts/${c.id}/file`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Åpne PDF{c.original_filename ? ` (${c.original_filename})` : ""}
        </a>
      </p>

      {bekreftet && uten_frist ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Kontrakten er lagret, men vi fant ingen dato å telle ned til. Da får du
          ikke påminnelser for denne før du legger inn en frist (startdato +
          varighet, bindingstid eller fornyelsesdato) manuelt.
        </p>
      ) : bekreftet ? (
        <p className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          Kontrakten er bekreftet. Nå kan den utløse påminnelser.
        </p>
      ) : null}

      {justert ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Noen felt ble justert ved lagring: {justert}. Sjekk verdiene og lagre
          på nytt om noe ble feil.
        </p>
      ) : null}

      {feil === "slett" ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Klarte ikke slette kontrakten. Den finnes kanskje ikke lenger, eller du
          har ikke tilgang til den.
        </p>
      ) : null}

      {feil === "bekreft" ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Klarte ikke bekrefte kontrakten. Den finnes kanskje ikke lenger, eller
          du har ikke tilgang til den.
        </p>
      ) : null}

      {c.needs_review && c.status !== "confirmed" ? (
        <p className="mt-4 rounded-lg border border-black/15 bg-black/5 p-3 text-sm dark:border-white/20 dark:bg-white/10">
          Denne trenger en gjennomgang. Sjekk feltene mot PDF-en og bekreft.
        </p>
      ) : null}

      {/* ── Tilstandsavhengige kontroller ─────────────────────────── */}
      {c.status === "draft" ? (
        <p className="mt-6 text-sm opacity-70">
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
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            Tolkningen feilet: {c.extraction_error ?? "ukjent feil"}
          </p>
          <ExtractControls contractId={c.id} mode="retry" />
        </div>
      ) : null}

      {/* ── Uttrukne felt + bekreft-skjema ────────────────────────── */}
      {showForm ? (
        <>
          <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="opacity-60">Beregnet oppsigelsesfrist</dt>
              <dd>{formatDeadline(c.next_deadline)}</dd>
            </div>
            <div>
              <dt className="opacity-60">Konfidens fra tolkningen</dt>
              <dd>
                {c.extraction_confidence
                  ? (CONFIDENCE_LABEL[c.extraction_confidence] ??
                    c.extraction_confidence)
                  : "–"}
              </dd>
            </div>
            <div>
              <dt className="opacity-60">Modell</dt>
              <dd className="truncate">{c.llm_model ?? "–"}</dd>
            </div>
            {c.extraction_notes ? (
              <div className="sm:col-span-2">
                <dt className="opacity-60">Merknader fra tolkningen</dt>
                <dd>{c.extraction_notes}</dd>
              </div>
            ) : null}
          </dl>

          <form action={confirmContract} className="mt-8 space-y-5">
            <input type="hidden" name="id" value={c.id} />

            <div>
              <label className="block text-sm">
                Startdato
                <input
                  type="date"
                  name="contract_start"
                  defaultValue={c.contract_start ?? ""}
                  className="mt-1 block rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "contract_start")} />
            </div>

            <div>
              <label className="block text-sm">
                Bindingstid utløper
                <input
                  type="date"
                  name="binding_until"
                  defaultValue={c.binding_until ?? ""}
                  className="mt-1 block rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "binding_until")} />
            </div>

            <div>
              <label className="block text-sm">
                Fornyelsesdato
                <input
                  type="date"
                  name="renewal_date"
                  defaultValue={c.renewal_date ?? ""}
                  className="mt-1 block rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "renewal_date")} />
            </div>

            <div>
              <label className="block text-sm">
                Avtaleperiode (måneder)
                <input
                  type="number"
                  name="term_months"
                  min={0}
                  defaultValue={c.term_months ?? ""}
                  className="mt-1 block w-40 rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "term_months")} />
            </div>

            <div>
              <label className="block text-sm">
                Oppsigelsesfrist (dager)
                <input
                  type="number"
                  name="notice_period_days"
                  min={0}
                  defaultValue={c.notice_period_days ?? ""}
                  className="mt-1 block w-40 rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                />
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "notice_period_days")} />
            </div>

            <div>
              <label className="block text-sm">
                Fornyes automatisk
                <select
                  name="auto_renews"
                  defaultValue={
                    c.auto_renews === null ? "" : c.auto_renews ? "true" : "false"
                  }
                  className="mt-1 block rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
                >
                  <option value="">Vet ikke</option>
                  <option value="true">Ja</option>
                  <option value="false">Nei</option>
                </select>
              </label>
              <Belegg quotes={quotesFor(c.llm_raw, "auto_renews")} />
            </div>

            <button
              type="submit"
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              {c.status === "confirmed"
                ? "Lagre endringer"
                : "Bekreft kontrakten"}
            </button>
            <p className="text-xs opacity-60">
              Fristen regnes ut på nytt fra feltene når du bekrefter. Først når
              kontrakten er bekreftet kan den utløse påminnelser.
            </p>
          </form>
        </>
      ) : null}

      {/* ── Faresone ──────────────────────────────────────────────── */}
      <section className="mt-16 border-t border-red-500/20 pt-6">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
          Faresone
        </h2>
        <p className="mt-1 text-xs opacity-60">
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
