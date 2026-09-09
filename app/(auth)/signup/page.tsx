import Link from "next/link";
import { redirect } from "next/navigation";
import { signUp } from "../actions";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";

/**
 * Registreringsside. Server-komponent, poster til signUp-action.
 * E-postbekreftelse er av i dev, så brukeren blir logget inn med en gang.
 */
const FEIL_TEKST: Record<string, string> = {
  "svakt-passord": "Passordet er for svakt. Bruk minst 6 tegn.",
  "for-langt-passord": "Passordet er for langt. Maks 72 tegn.",
  "ugyldig-epost": "Ugyldig e-postadresse.",
  tomt: "Fyll ut både e-post og passord.",
  rate: "For mange forsøk. Vent noen minutter og prøv igjen.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; feil?: string }>;
}) {
  if (await getCurrentUser()) redirect("/kontrakter");

  const { next, feil } = await searchParams;
  const nextPath = next ?? "/kontrakter";
  const error = feil
    ? (FEIL_TEKST[feil] ?? "Kunne ikke opprette bruker.")
    : null;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Link href="/">
        <Logo size="lg" />
      </Link>
      <h1 className="mt-8 text-2xl font-bold tracking-tight">Registrer deg</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Opprett en konto for å komme i gang med Notisen.
      </p>

      {error ? (
        <Alert variant="critical" className="mt-4">
          <p>{error}</p>
          <p className="mt-1">
            Har du allerede en konto? Prøv å logge inn eller nullstille passordet.
          </p>
        </Alert>
      ) : null}

      <form action={signUp} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={nextPath} />

        <label className={labelClass}>
          E-post
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Passord
          <input
            type="password"
            name="password"
            required
            minLength={6}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>

        <button type="submit" className={btnPrimary + " w-full"}>
          Registrer deg
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-secondary">
        Har du allerede konto?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="text-accent underline"
        >
          Logg inn
        </Link>
      </p>
    </main>
  );
}
