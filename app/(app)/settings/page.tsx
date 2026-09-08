import { requireUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError } from "@/lib/fiken";
import { DeleteAccountForm } from "./delete-account-form";

export const dynamic = "force-dynamic";

type FikenStatus =
  | { kind: "connected"; companies: string[] }
  | { kind: "not_connected" }
  | { kind: "reauth" }
  | { kind: "error"; message: string };

async function loadFikenStatus(): Promise<FikenStatus> {
  try {
    const fiken = await getFikenClientForCurrentUser();
    const companies = await fiken.companies();
    return { kind: "connected", companies: companies.map((c) => c.name) };
  } catch (err) {
    if (err instanceof NoFikenConnectionError) return { kind: "not_connected" };
    if (err instanceof FikenReauthRequiredError) return { kind: "reauth" };
    if (err instanceof FikenError) {
      return {
        kind: "error",
        message: "Klarte ikke hente status fra Fiken akkurat nå.",
      };
    }
    console.error("Uventet feil ved henting av Fiken-status:", err);
    return {
      kind: "error",
      message: "Noe gikk galt da vi hentet Fiken-status. Prøv igjen om litt.",
    };
  }
}

/** Kortkoder fra OAuth-callback → norsk brukertekst. */
function fikenErrorText(code: string): string {
  switch (code) {
    case "invalid_state":
      return "Noe gikk galt underveis (utløpt eller ugyldig forsøk). Prøv å koble til på nytt.";
    case "exchange_failed":
      return "Klarte ikke fullføre tilkoblingen mot Fiken. Prøv igjen om litt.";
    case "access_denied":
      return "Tilgang ble ikke godkjent i Fiken.";
    default:
      return "Kobling til Fiken feilet. Prøv å koble til på nytt.";
  }
}

function ConnectButton({ label }: { label: string }) {
  return (
    <a
      href="/api/fiken/oauth/start"
      className="inline-block rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
    >
      {label}
    </a>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    fiken?: string;
    fiken_error?: string;
    slett_feil?: string;
  }>;
  // fiken: "connected" | "disconnected" | "disconnect_failed"
}) {
  const user = await requireUser("/settings");
  const { fiken, fiken_error, slett_feil } = await searchParams;
  const status = await loadFikenStatus();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Innstillinger</h1>

      {fiken === "connected" ? (
        <p className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          Notisen er nå koblet til Fiken.
        </p>
      ) : null}
      {fiken === "disconnected" ? (
        <p className="mt-4 rounded-lg border border-black/15 bg-black/5 p-3 text-sm dark:border-white/20 dark:bg-white/10">
          Fiken-tilkoblingen er fjernet fra Notisen. Husk at du også må fjerne
          Notisen sin tilgang inne i Fiken hvis du vil trekke den helt tilbake.
        </p>
      ) : null}
      {fiken === "disconnect_failed" ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Klarte ikke koble fra Fiken nå. Prøv igjen om litt.
        </p>
      ) : null}
      {fiken_error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {fikenErrorText(fiken_error)}
        </p>
      ) : null}
      {slett_feil ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {slett_feil === "bekreftelse"
            ? "E-posten du skrev inn stemmer ikke."
            : "Klarte ikke fullføre slettingen. Kontoen din er fortsatt aktiv – prøv igjen om litt."}
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="font-medium">Fiken</h2>

        {status.kind === "not_connected" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm opacity-70">
              Ikke koblet til. Koble til Fiken for å hente leverandører og kjøp.
            </p>
            <ConnectButton label="Koble til Fiken" />
          </div>
        ) : null}

        {status.kind === "connected" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm opacity-70">
              Koblet til Fiken. Selskaper:{" "}
              {status.companies.length > 0
                ? status.companies.join(", ")
                : "(ingen selskaper funnet)"}
            </p>
            <form action="/api/fiken/disconnect" method="post">
              <button
                type="submit"
                className="rounded-lg border border-black/15 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Koble fra
              </button>
            </form>
          </div>
        ) : null}

        {status.kind === "reauth" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm opacity-70">
              Tilkoblingen til Fiken har utløpt. Koble til på nytt for å fortsette.
            </p>
            <ConnectButton label="Koble til Fiken på nytt" />
          </div>
        ) : null}

        {status.kind === "error" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-red-700 dark:text-red-300">
              {status.message}
            </p>
            <ConnectButton label="Koble til Fiken" />
          </div>
        ) : null}
      </section>

      {/* ── Faresone ──────────────────────────────────────────────── */}
      <section className="mt-16 border-t border-red-500/20 pt-6">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
          Faresone
        </h2>
        <p className="mt-1 text-xs opacity-60">
          Sletting fjerner kontoen din, alle kontrakter, alle leverandører og
          alle opplastede PDF-er permanent. Dette kan ikke angres. Husk at du
          også må fjerne Notisen sin tilgang inne i Fiken hvis du vil trekke den
          helt tilbake.
        </p>
        <div className="mt-3">
          {user.email ? (
            <DeleteAccountForm email={user.email} />
          ) : (
            <p className="text-xs opacity-60">
              Sletting av konto krever en registrert e-postadresse. Ta kontakt så
              hjelper vi deg.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
