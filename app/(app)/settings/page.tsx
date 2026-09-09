import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError } from "@/lib/fiken";
import { hasActiveBenchmarkConsent } from "@/lib/benchmark";
import { DeleteAccountForm } from "./delete-account-form";
import {
  enableBenchmarkConsent,
  disableBenchmarkConsent,
} from "./actions";
import { Alert } from "@/components/ui/alert";
import { btnPrimary, btnSecondary } from "@/components/ui/button-styles";
import { card } from "@/components/ui/card";

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
    Sentry.captureException(err, { tags: { area: "settings" } });
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
    <a href="/api/fiken/oauth/start" className={btnPrimary}>
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
    benchmark?: string;
  }>;
  // fiken: "connected" | "disconnected" | "disconnect_failed"
  // benchmark: "pa" | "av" | "migrasjon"
}) {
  const user = await requireUser("/settings");
  const { fiken, fiken_error, slett_feil, benchmark } = await searchParams;
  const status = await loadFikenStatus();
  const supabase = await createClient();
  const benchmarkOn = await hasActiveBenchmarkConsent(supabase, user.id);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Innstillinger</h1>

      {fiken === "connected" ? (
        <Alert variant="good" className="mt-4">
          Notisen er nå koblet til Fiken.
        </Alert>
      ) : null}
      {fiken === "disconnected" ? (
        <Alert variant="neutral" className="mt-4">
          Fiken-tilkoblingen er fjernet fra Notisen. Husk at du også må fjerne
          Notisen sin tilgang inne i Fiken hvis du vil trekke den helt tilbake.
        </Alert>
      ) : null}
      {fiken === "disconnect_failed" ? (
        <Alert variant="critical" className="mt-4">
          Klarte ikke koble fra Fiken nå. Prøv igjen om litt.
        </Alert>
      ) : null}
      {fiken_error ? (
        <Alert variant="critical" className="mt-4">
          {fikenErrorText(fiken_error)}
        </Alert>
      ) : null}
      {slett_feil ? (
        <Alert variant="critical" className="mt-4">
          {slett_feil === "bekreftelse"
            ? "E-posten du skrev inn stemmer ikke."
            : "Klarte ikke fullføre slettingen. Kontoen din er fortsatt aktiv – prøv igjen om litt."}
        </Alert>
      ) : null}

      <section className={card + " mt-8"}>
        <h2 className="font-medium">Fiken</h2>

        {status.kind === "not_connected" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-ink-secondary">
              Ikke koblet til. Koble til Fiken for å hente leverandører og kjøp.
            </p>
            <ConnectButton label="Koble til Fiken" />
          </div>
        ) : null}

        {status.kind === "connected" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-ink-secondary">
              Koblet til Fiken. Selskaper:{" "}
              {status.companies.length > 0
                ? status.companies.join(", ")
                : "(ingen selskaper funnet)"}
            </p>
            <form action="/api/fiken/disconnect" method="post">
              <button type="submit" className={btnSecondary}>
                Koble fra
              </button>
            </form>
          </div>
        ) : null}

        {status.kind === "reauth" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-ink-secondary">
              Tilkoblingen til Fiken har utløpt. Koble til på nytt for å fortsette.
            </p>
            <ConnectButton label="Koble til Fiken på nytt" />
          </div>
        ) : null}

        {status.kind === "error" ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-status-critical">{status.message}</p>
            <ConnectButton label="Koble til Fiken" />
          </div>
        ) : null}
      </section>

      {/* ── Anonym prissammenligning (del 3, opt-in) ──────────────── */}
      <section className={card + " mt-8"}>
        <h2 className="font-medium">Anonym prissammenligning</h2>
        {benchmark === "pa" ? (
          <Alert variant="good" className="mt-3">
            Takk! Notisen kan nå bruke anonymiserte pristall fra regnskapet ditt
            til å bygge en sammenligning på tvers av bedrifter.
          </Alert>
        ) : null}
        {benchmark === "av" ? (
          <Alert variant="neutral" className="mt-3">
            Avslått. Datapunktene som var samlet inn fra deg er slettet.
          </Alert>
        ) : null}
        {benchmark === "migrasjon" ? (
          <Alert variant="critical" className="mt-3">
            Denne funksjonen krever en databaseoppdatering som ikke er kjørt ennå.
          </Alert>
        ) : null}

        <p className="mt-3 text-sm text-ink-secondary">
          Du kan la Notisen bruke <strong>anonymiserte, kategoriserte</strong>{" "}
          pristall fra regnskapet ditt til å bygge opp en sammenligning på tvers
          av bedrifter – slik at du senere kan se om andre betaler mindre for
          liknende tjenester. Ingen leverandørnavn, kontonumre eller beløp som
          kan spores tilbake til deg blir delt, og sammenligningstall vises ikke
          til noen før mange nok bedrifter har blitt med. Du kan skru det av når
          som helst – da slettes det som er samlet inn fra deg.
        </p>
        <p className="mt-2 text-sm">
          Status:{" "}
          <strong>{benchmarkOn ? "Aktivert" : "Ikke aktivert"}</strong>
        </p>
        <form
          action={benchmarkOn ? disableBenchmarkConsent : enableBenchmarkConsent}
          className="mt-3"
        >
          <button type="submit" className={btnSecondary}>
            {benchmarkOn ? "Skru av" : "Aktiver"}
          </button>
        </form>
      </section>

      {/* ── Faresone ──────────────────────────────────────────────── */}
      <section className="mt-16 border-t border-status-critical/25 pt-6">
        <h2 className="text-sm font-semibold text-status-critical">Faresone</h2>
        <p className="mt-1 text-xs text-ink-tertiary">
          Sletting fjerner kontoen din, alle kontrakter, alle leverandører og
          alle opplastede PDF-er permanent. Dette kan ikke angres. Husk at du
          også må fjerne Notisen sin tilgang inne i Fiken hvis du vil trekke den
          helt tilbake.
        </p>
        <div className="mt-3">
          {user.email ? (
            <DeleteAccountForm email={user.email} />
          ) : (
            <p className="text-xs text-ink-tertiary">
              Sletting av konto krever en registrert e-postadresse. Ta kontakt så
              hjelper vi deg.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
