import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatDeadline,
  STATUS_LABEL,
  type ContractStatus,
} from "@/lib/contract-status";
import {
  CATEGORY_FILTERS,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  compareContracts,
  contractCategory,
  type ContractCategory,
} from "@/lib/contract-category";
import { Alert } from "@/components/ui/alert";
import { card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type ContractRow = {
  id: string;
  status: ContractStatus;
  next_deadline: string | null;
  deadline_rolled_at: string | null;
  needs_review: boolean;
  archived_at: string | null;
  source: string;
  storage_path: string | null;
  original_filename: string | null;
  created_at: string;
  supplier: { name: string } | null;
};

const BASE_SELECT =
  "id, status, next_deadline, deadline_rolled_at, needs_review, storage_path, original_filename, created_at, supplier:supplier_id (name)";

/** Progressivt smalere select-er – valgfrie kolonner kan mangle før migrasjon. */
const SELECTS = [
  `${BASE_SELECT}, archived_at, source`,
  `${BASE_SELECT}, archived_at`,
  BASE_SELECT,
];

const PILL_CLASS: Record<ContractCategory, string> = {
  aktiv: "bg-status-good-tint text-status-good",
  venter: "bg-ink/5 text-ink-secondary",
  utloper: "bg-status-warning-tint text-status-warning",
  utlopt: "bg-status-critical-tint text-status-critical",
  avsluttet: "bg-ink/5 text-ink-tertiary",
};

function CategoryPill({ category }: { category: ContractCategory }) {
  return (
    <span
      className={
        "shrink-0 rounded-full px-2 py-0.5 text-xs " + PILL_CLASS[category]
      }
    >
      {CATEGORY_SHORT[category]}
    </span>
  );
}

export default async function KontrakterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser("/kontrakter");
  const { status: statusFilter } = await searchParams;
  const supabase = await createClient();

  const fetchContracts = (sel: string) =>
    supabase
      .from("contract")
      .select(sel)
      .neq("status", "draft")
      .order("created_at", { ascending: false });

  let res = await fetchContracts(SELECTS[0]);
  for (let i = 1; i < SELECTS.length && res.error; i++) {
    if (!/archived_at|source/.test(res.error.message)) break;
    res = await fetchContracts(SELECTS[i]);
  }
  const { error } = res;

  const raw = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
  const contracts: ContractRow[] = raw.map((r) => ({
    archived_at: null,
    source: "fiken",
    storage_path: null,
    ...r,
  })) as ContractRow[];

  const withCategory = contracts.map((c) => ({
    row: c,
    category: contractCategory(c),
  }));

  const counts = withCategory.reduce<Record<string, number>>((acc, { category }) => {
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});

  const activeFilter =
    statusFilter && CATEGORY_FILTERS.some((f) => f.key === statusFilter)
      ? statusFilter
      : "";

  const shown = withCategory
    .filter(({ category }) => (activeFilter ? category === activeFilter : true))
    .sort((a, b) => compareContracts(a.row, b.row));

  const filterHref = (key: string) =>
    key ? `/kontrakter?status=${key}` : "/kontrakter";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kontrakter</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-secondary">
            Alle avtalene dine, sortert etter hvor nær oppsigelsesfristen er. Du
            bekrefter selv en kontrakt før den overvåkes.
          </p>
        </div>
        <Link
          href="/kontrakter/ny"
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent-tint"
        >
          + Ny kontrakt
        </Link>
      </div>

      {error ? (
        <Alert variant="critical" className="mt-8">
          Klarte ikke hente kontraktene nå. Prøv igjen om litt.
        </Alert>
      ) : contracts.length === 0 ? (
        <div className={card + " mt-8 text-sm text-ink-secondary"}>
          Ingen kontrakter enda. Legg til en{" "}
          <Link href="/kontrakter/ny" className="text-accent underline">
            manuelt
          </Link>
          , eller gå til{" "}
          <Link href="/dashboard" className="text-accent underline">
            Finn avtaler
          </Link>{" "}
          og last opp en kontrakt for en Fiken-leverandør.
        </div>
      ) : (
        <>
          <nav className="mt-6 flex flex-wrap gap-2">
            {CATEGORY_FILTERS.map((f) => {
              const isActive = f.key === activeFilter;
              const n = f.key ? (counts[f.key] ?? 0) : contracts.length;
              return (
                <Link
                  key={f.key}
                  href={filterHref(f.key)}
                  aria-current={isActive ? "true" : undefined}
                  className={
                    "rounded-full border px-3 py-1 text-sm tabular-nums " +
                    (isActive
                      ? "border-accent bg-accent-tint text-accent-hover"
                      : "border-border text-ink-secondary hover:bg-ink/5")
                  }
                >
                  {f.label} {n}
                </Link>
              );
            })}
          </nav>

          {shown.length === 0 ? (
            <div className={card + " mt-6 text-sm text-ink-secondary"}>
              Ingen kontrakter i «{CATEGORY_LABEL[activeFilter as ContractCategory]}».
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {shown.map(({ row: c, category }) => (
                <li
                  key={c.id}
                  className={
                    card +
                    " p-4 " +
                    (category === "avsluttet" ? "opacity-60" : "")
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/kontrakter/${c.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.supplier?.name ?? "Ukjent leverandør"}
                      </Link>
                      <CategoryPill category={category} />
                    </div>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-ink-tertiary">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-tertiary">Frist</dt>
                      <dd className="tabular-nums">
                        {formatDeadline(c.next_deadline)}
                      </dd>
                      {c.deadline_rolled_at && category !== "avsluttet" ? (
                        <dd className="mt-0.5 text-xs text-status-warning">
                          Frist rullet automatisk – sjekk
                        </dd>
                      ) : null}
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Kilde</dt>
                      <dd className="truncate">
                        {c.source === "manual"
                          ? c.original_filename
                            ? `Manuelt · ${c.original_filename}`
                            : "Lagt til manuelt"
                          : (c.original_filename ?? "Fra Fiken")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-tertiary">Status</dt>
                      <dd>{CATEGORY_LABEL[category]}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
