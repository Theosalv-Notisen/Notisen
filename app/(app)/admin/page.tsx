import { notFound } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAdminSummary, type AdminUser } from "@/lib/admin-stats";
import type { CategoryInput } from "@/lib/contract-category";
import type { ContractStatus } from "@/lib/contract-status";
import { card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

/**
 * Enkel vekst-oversikt – kun for eier(e) i `ADMIN_EMAILS`. Andre innloggede
 * brukere får 404 (siden finnes «ikke» for dem). Ingen lenke i menyen; åpnes
 * ved å skrive /admin i adressefeltet.
 */
export const dynamic = "force-dynamic";

const CONTRACT_SELECT = "status, needs_review, next_deadline, archived_at";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Oslo",
  });
}

async function loadUsers(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ users: AdminUser[]; error: boolean }> {
  const users: AdminUser[] = [];
  try {
    // listUsers paginerer; hent opptil 20 sider (10 000 brukere) for sikkerhets skyld.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 500,
      });
      if (error) throw error;
      for (const u of data.users) {
        users.push({
          email: u.email ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < 500) break;
    }
    return { users, error: false };
  } catch (err) {
    console.error("Admin: klarte ikke hente brukerliste:", err);
    Sentry.captureException(err, { tags: { area: "admin" } });
    return { users, error: true };
  }
}

export default async function AdminPage() {
  const user = await requireUser("/admin");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();

  const { users, error: usersError } = await loadUsers(admin);

  const { data: contractData, error: contractError } = await admin
    .from("contract")
    .select(CONTRACT_SELECT)
    .neq("status", "draft");

  if (contractError) {
    console.error("Admin: klarte ikke hente kontrakter:", contractError);
    Sentry.captureException(contractError, { tags: { area: "admin" } });
  }

  const contracts: CategoryInput[] = (
    (contractData ?? []) as unknown as Array<Record<string, unknown>>
  ).map((r) => ({
    status: r.status as ContractStatus,
    needs_review: Boolean(r.needs_review),
    next_deadline: (r.next_deadline as string | null) ?? null,
    archived_at: (r.archived_at as string | null) ?? null,
  }));

  const summary = buildAdminSummary(users, contracts, { recentLimit: 15 });

  const numbers: { label: string; value: number | string }[] = [
    { label: "Registrerte brukere", value: usersError ? "–" : summary.userCount },
    { label: "Aktive / bekreftede kontrakter", value: summary.activeContracts },
    { label: "Venter på bekreftelse", value: summary.waitingContracts },
    { label: "Avsluttede kontrakter", value: summary.archivedContracts },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Admin-oversikt</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Rask oversikt over veksten. Kun synlig for eier.
        </p>
      </div>

      {usersError ? (
        <Alert variant="warning">
          Klarte ikke hente brukerlista fra Supabase akkurat nå. Tallene under
          for kontrakter er fortsatt riktige.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {numbers.map((n) => (
          <div key={n.label} className={card}>
            <div className="text-3xl font-semibold text-ink">{n.value}</div>
            <div className="mt-1 text-xs text-ink-secondary">{n.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">Siste innlogginger</h2>
        {summary.recentLogins.length === 0 ? (
          <p className="mt-2 text-sm text-ink-secondary">
            Ingen innlogginger registrert ennå.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
            {summary.recentLogins.map((l, i) => (
              <li
                key={`${l.email}-${i}`}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <span className="truncate text-ink">{l.email}</span>
                <span className="ml-4 shrink-0 text-ink-secondary">
                  {formatDateTime(l.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-tertiary">
          «Siste innlogging» er tidspunktet Supabase sist utstedte en sesjon for
          brukeren (nyeste først).
        </p>
      </div>
    </div>
  );
}
