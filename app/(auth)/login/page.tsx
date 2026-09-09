import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "../actions";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";

/**
 * Innloggingsside. Server-komponent, poster til signIn-action.
 */
const FEIL_TEKST: Record<string, string> = {
  ugyldig: "Feil e-post eller passord.",
  tomt: "Fyll ut både e-post og passord.",
  rate: "For mange innloggingsforsøk. Vent noen minutter og prøv igjen.",
  reset_ugyldig:
    "Lenken for å tilbakestille passord var ugyldig eller utløpt. Be om en ny.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    feil?: string;
    slettet?: string;
    passord_oppdatert?: string;
  }>;
}) {
  const { next, feil, slettet, passord_oppdatert } = await searchParams;
  // Allerede innlogget → rett til dashbordet (men behold kvitteringene).
  if (!slettet && !passord_oppdatert && (await getCurrentUser())) {
    redirect("/kontrakter");
  }
  const nextPath = next ?? "/kontrakter";
  const error = feil ? (FEIL_TEKST[feil] ?? "Innlogging feilet.") : null;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Link href="/">
        <Logo size="lg" />
      </Link>
      <h1 className="mt-8 text-2xl font-bold tracking-tight">Logg inn</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Logg inn for å se leverandørene dine og koble til Fiken.
      </p>

      {error ? (
        <Alert variant="critical" className="mt-4">
          {error}
        </Alert>
      ) : null}

      {slettet ? (
        <Alert variant="good" className="mt-4">
          Kontoen din er slettet. All data og alle opplastede filer er fjernet
          permanent. Husk at du også må fjerne Notisen sin tilgang inne i Fiken
          hvis du vil trekke den helt tilbake.
        </Alert>
      ) : null}

      {passord_oppdatert ? (
        <Alert variant="good" className="mt-4">
          Passordet er oppdatert. Logg inn med det nye passordet.
        </Alert>
      ) : null}

      <form action={signIn} className="mt-6 space-y-4">
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
            autoComplete="current-password"
            className={inputClass}
          />
        </label>

        <div className="text-sm">
          <Link href="/glemt-passord" className="text-accent underline">
            Glemt passord?
          </Link>
        </div>

        <button type="submit" className={btnPrimary + " w-full"}>
          Logg inn
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-secondary">
        Har du ikke konto?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(nextPath)}`}
          className="text-accent underline"
        >
          Registrer deg
        </Link>
      </p>
    </main>
  );
}
