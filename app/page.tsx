import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { btnPrimary, btnSecondary } from "@/components/ui/button-styles";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <Logo size="lg" />

      <h1 className="mt-8 text-3xl font-bold tracking-tight">
        Aldri gå glipp av en oppsigelsesfrist igjen.
      </h1>
      <p className="mt-3 text-lg text-ink-secondary">
        Notisen holder styr på oppsigelsesfrister og bindingstid for
        leverandøravtalene dine, og varsler deg i god tid.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/signup" className={btnPrimary}>
          Kom i gang
        </Link>
        <Link href="/login" className={btnSecondary}>
          Logg inn
        </Link>
      </div>

      <ul className="mt-10 space-y-2 text-sm text-ink-secondary">
        <li>Henter leverandørene dine fra Fiken automatisk.</li>
        <li>Leser opplastede kontrakter og foreslår en oppsigelsesfrist.</li>
        <li>Sender e-postvarsel 90, 60 og 30 dager før fristen.</li>
      </ul>
    </main>
  );
}
