import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatDeadline,
  STATUS_LABEL,
  type ContractStatus,
} from "@/lib/contract-status";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type ContractRow = {
  id: string;
  status: ContractStatus;
  next_deadline: string | null;
  deadline_rolled_at: string | null;
  needs_review: boolean;
  original_filename: string | null;
  created_at: string;
  supplier: { name: string } | null;
};

export default async function KontrakterPage() {
  await requireUser("/kontrakter");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contract")
    .select(
      "id, status, next_deadline, deadline_rolled_at, needs_review, original_filename, created_at, supplier:supplier_id (name)",
    )
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  const contracts = (data ?? []) as unknown as ContractRow[];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Kontrakter</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Kontrakter du har lastet opp. Notisen leser dem og foreslår en
        oppsigelsesfrist – du bekrefter selv før noe varsel sendes.
      </p>

      {error ? (
        <Alert variant="critical" className="mt-8">
          Klarte ikke hente kontraktene nå. Prøv igjen om litt.
        </Alert>
      ) : contracts.length === 0 ? (
        <div className={card + " mt-8 text-sm text-ink-secondary"}>
          Ingen kontrakter enda. Gå til{" "}
          <Link href="/dashboard" className="text-accent underline">
            oversikten
          </Link>{" "}
          og last opp en kontrakt for en leverandør.
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {contracts.map((c) => (
            <li key={c.id} className={card + " p-4"}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/kontrakter/${c.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {c.supplier?.name ?? "Ukjent leverandør"}
                  </Link>
                  <StatusBadge deadline={c.next_deadline} />
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-ink-secondary">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-ink-tertiary">Frist</dt>
                  <dd className="tabular-nums">
                    {formatDeadline(c.next_deadline)}
                  </dd>
                  {c.deadline_rolled_at ? (
                    <dd className="mt-0.5 text-xs text-status-warning">
                      Frist rullet automatisk – sjekk
                    </dd>
                  ) : null}
                </div>
                <div>
                  <dt className="text-ink-tertiary">Fil</dt>
                  <dd className="truncate">{c.original_filename ?? "–"}</dd>
                </div>
                <div>
                  <dt className="text-ink-tertiary">Gjennomgang</dt>
                  <dd>
                    {c.needs_review || c.status !== "confirmed"
                      ? "Trenger gjennomgang"
                      : "Bekreftet"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
