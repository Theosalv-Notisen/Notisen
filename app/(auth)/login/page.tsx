import Link from "next/link";
import { signIn } from "../actions";

/**
 * Innloggingsside. Server-komponent, poster til signIn-action.
 */
const FEIL_TEKST: Record<string, string> = {
  ugyldig: "Feil e-post eller passord.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; feil?: string; slettet?: string }>;
}) {
  const { next, feil, slettet } = await searchParams;
  const nextPath = next ?? "/dashboard";
  const error = feil ? (FEIL_TEKST[feil] ?? "Innlogging feilet.") : null;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Logg inn</h1>
      <p className="mt-2 text-sm opacity-70">
        Logg inn for å se leverandørene dine og koble til Fiken.
      </p>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {slettet ? (
        <p className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          Kontoen din er slettet. All data og alle opplastede filer er fjernet
          permanent. Husk at du også må fjerne Notisen sin tilgang inne i Fiken
          hvis du vil trekke den helt tilbake.
        </p>
      ) : null}

      <form action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={nextPath} />

        <label className="block text-sm">
          E-post
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
          />
        </label>

        <label className="block text-sm">
          Passord
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Logg inn
        </button>
      </form>

      <p className="mt-6 text-sm opacity-70">
        Har du ikke konto?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(nextPath)}`}
          className="underline"
        >
          Registrer deg
        </Link>
      </p>
    </main>
  );
}
