import Link from "next/link";
import { sendPasswordReset } from "./actions";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";

/**
 * «Glemt passord?» – steg 1: skriv inn e-post, vi ber Supabase sende en
 * tilbakestillingslenke. Server-komponent, poster til sendPasswordReset.
 */
export default async function GlemtPassordPage({
  searchParams,
}: {
  searchParams: Promise<{ sendt?: string; feil?: string }>;
}) {
  const { sendt, feil } = await searchParams;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Link href="/">
        <Logo size="lg" />
      </Link>
      <h1 className="mt-8 text-2xl font-bold tracking-tight">Glemt passord?</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Skriv inn e-postadressen din, så sender vi deg en lenke for å sette et
        nytt passord.
      </p>

      {feil === "tomt" ? (
        <Alert variant="critical" className="mt-4">
          Fyll inn e-postadressen din.
        </Alert>
      ) : null}

      {sendt ? (
        <Alert variant="good" className="mt-4">
          Hvis det finnes en konto på denne adressen, har vi sendt en e-post med
          en lenke for å tilbakestille passordet. Sjekk også søppelpost-mappen.
        </Alert>
      ) : null}

      {!sendt ? (
        <form action={sendPasswordReset} className="mt-6 space-y-4">
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

          <button type="submit" className={btnPrimary + " w-full"}>
            Send lenke
          </button>
        </form>
      ) : null}

      <p className="mt-6 text-sm text-ink-secondary">
        <Link href="/login" className="text-accent underline">
          Tilbake til innlogging
        </Link>
      </p>
    </main>
  );
}
