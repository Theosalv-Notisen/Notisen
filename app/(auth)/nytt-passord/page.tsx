import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { updatePassword } from "./actions";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";

export const dynamic = "force-dynamic";

/**
 * «Glemt passord?» – steg 2: sett nytt passord.
 *
 * Brukeren lander her fra /auth/confirm med en recovery-sesjon. Har de ingen
 * sesjon (lenke utløpt / åpnet i feil nettleser), viser vi en tydelig beskjed
 * i stedet for et skjema som uansett ville feilet.
 */
const FEIL_TEKST: Record<string, string> = {
  svakt: "Passordet er for kort. Bruk minst 6 tegn.",
  langt: "Passordet er for langt. Maks 72 tegn.",
  samme: "Det nye passordet må være forskjellig fra det gamle.",
  "1": "Klarte ikke oppdatere passordet. Prøv igjen, eller be om en ny lenke.",
};

export default async function NyttPassordPage({
  searchParams,
}: {
  searchParams: Promise<{ feil?: string }>;
}) {
  const { feil } = await searchParams;
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Link href="/">
        <Logo size="lg" />
      </Link>
      <h1 className="mt-8 text-2xl font-bold tracking-tight">Sett nytt passord</h1>

      {!user ? (
        <>
          <Alert variant="critical" className="mt-4">
            Lenken er ugyldig eller utløpt. Tilbakestillingslenker varer i kort
            tid og må åpnes i samme nettleser du ba om dem fra.
          </Alert>
          <p className="mt-6 text-sm text-ink-secondary">
            <Link href="/glemt-passord" className="text-accent underline">
              Be om en ny lenke
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-secondary">
            Velg et nytt passord for {user.email}. Du blir logget ut og må logge
            inn med det nye passordet.
          </p>

          {feil ? (
            <Alert variant="critical" className="mt-4">
              {FEIL_TEKST[feil] ?? "Noe gikk galt. Prøv igjen."}
            </Alert>
          ) : null}

          <form action={updatePassword} className="mt-6 space-y-4">
            <label className={labelClass}>
              Nytt passord
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
              Lagre nytt passord
            </button>
          </form>
        </>
      )}
    </main>
  );
}
