import Link from "next/link";
import { signUp } from "../actions";

/**
 * Registreringsside. Server-komponent, poster til signUp-action.
 * E-postbekreftelse er av i dev, så brukeren blir logget inn med en gang.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = next ?? "/dashboard";

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Registrer deg</h1>
      <p className="mt-2 text-sm opacity-70">
        Opprett en konto for å komme i gang med Notisen.
      </p>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <form action={signUp} className="mt-6 space-y-4">
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
            minLength={6}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Registrer deg
        </button>
      </form>

      <p className="mt-6 text-sm opacity-70">
        Har du allerede konto?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="underline"
        >
          Logg inn
        </Link>
      </p>
    </main>
  );
}
