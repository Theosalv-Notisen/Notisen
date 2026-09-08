import Link from "next/link";
import { redirect } from "next/navigation";
import { signUp } from "../actions";
import { getCurrentUser } from "@/lib/auth";

/**
 * Registreringsside. Server-komponent, poster til signUp-action.
 * E-postbekreftelse er av i dev, så brukeren blir logget inn med en gang.
 */
const FEIL_TEKST: Record<string, string> = {
  "svakt-passord": "Passordet er for svakt. Bruk minst 6 tegn.",
  "for-langt-passord": "Passordet er for langt. Maks 72 tegn.",
  "ugyldig-epost": "Ugyldig e-postadresse.",
  tomt: "Fyll ut både e-post og passord.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; feil?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");

  const { next, feil } = await searchParams;
  const nextPath = next ?? "/dashboard";
  const error = feil
    ? (FEIL_TEKST[feil] ?? "Kunne ikke opprette bruker.")
    : null;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Registrer deg</h1>
      <p className="mt-2 text-sm opacity-70">
        Opprett en konto for å komme i gang med Notisen.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <p>{error}</p>
          <p className="mt-1 opacity-80">
            Har du allerede en konto? Prøv å logge inn eller nullstille passordet.
          </p>
        </div>
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
