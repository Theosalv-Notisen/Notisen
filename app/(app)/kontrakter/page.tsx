import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatDeadline,
  STATUS_LABEL,
  type ContractStatus,
} from "@/lib/contract-status";

export const dynamic = "force-dynamic";

type ContractRow = {
  id: string;
  status: ContractStatus;
  next_deadline: string | null;
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
      "id, status, next_deadline, needs_review, original_filename, created_at, supplier:supplier_id (name)",
    )
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  const contracts = (data ?? []) as unknown as ContractRow[];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Kontrakter</h1>
      <p className="mt-2 text-sm opacity-70">
        Kontrakter du har lastet opp. Notisen leser dem og foreslår en
        oppsigelsesfrist – du bekrefter selv før noe varsel sendes.
      </p>

      {error ? (
        <p className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-700 dark:text-red-300">
          Klarte ikke hente kontraktene nå. Prøv igjen om litt.
        </p>
      ) : contracts.length === 0 ? (
        <p className="mt-8 rounded-xl border border-black/10 p-6 text-sm opacity-75 dark:border-white/15">
          Ingen kontrakter enda. Gå til{" "}
          <Link href="/dashboard" className="underline">
            oversikten
          </Link>{" "}
          og last opp en kontrakt for en leverandør.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {contracts.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={`/kontrakter/${c.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {c.supplier?.name ?? "Ukjent leverandør"}
                </Link>
                <span className="shrink-0 rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20">
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="opacity-60">Frist</dt>
                  <dd>{formatDeadline(c.next_deadline)}</dd>
                </div>
                <div>
                  <dt className="opacity-60">Fil</dt>
                  <dd className="truncate">{c.original_filename ?? "–"}</dd>
                </div>
                <div>
                  <dt className="opacity-60">Gjennomgang</dt>
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
