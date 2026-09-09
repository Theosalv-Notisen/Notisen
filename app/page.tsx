import type { Metadata } from "next";
import Link from "next/link";
import { DashboardMockup } from "@/components/marketing/dashboard-mockup";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { btnPrimary, btnSecondary } from "@/components/ui/button-styles";

export const metadata: Metadata = {
  title: "Notisen – påminnelser om oppsigelsesfrister",
  description:
    "Notisen kobler seg til Fiken, finner de løpende leverandøravtalene dine og varsler deg i god tid før oppsigelsesfristen løper ut.",
};

const STEG = [
  {
    tittel: "Koble til Fiken",
    tekst: "Koble til din bedrifts Fiken-regnskap med noen få klikk.",
  },
  {
    tittel: "Finn de løpende avtalene",
    tekst:
      "Notisen oppdager tilbakevendende leverandørbetalinger som kan tyde på løpende avtaler.",
  },
  {
    tittel: "Last opp kontraktene",
    tekst:
      "Last opp kontraktene dine – vi leser ut fornyelses- og oppsigelsesfrister automatisk med KI.",
  },
  {
    tittel: "Få påminnelse i tide",
    tekst:
      "Du får en e-postpåminnelse i god tid før fristen løper ut – 90, 60 og 30 dager før.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-6 pt-16 pb-16 sm:pt-20">
          <h1 className="max-w-3xl text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.5rem]">
            Hold oversikt over oppsigelsesfristene i bedriftens avtaler.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-secondary">
            Notisen kobler seg til regnskapet ditt i Fiken, finner de løpende
            leverandøravtalene, og minner deg på i god tid før du blir bundet for
            et nytt år.
          </p>
          <div className="mt-8">
            <Link href="/signup" className={btnPrimary}>
              Kom i gang
            </Link>
          </div>
          <p className="mt-4 max-w-xl text-sm text-ink-tertiary">
            Notisen henter kun leverandørene og kjøpene dine fra Fiken og gjør
            aldri endringer i regnskapet. Du kan koble fra når som helst.
          </p>

          <div className="mt-14 sm:mt-16">
            <DashboardMockup />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="text-xl font-bold tracking-tight">
              Slik fungerer det
            </h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2">
              {STEG.map((steg, i) => (
                <li
                  key={steg.tittel}
                  className="rounded-xl border border-border bg-surface p-5"
                >
                  <span className="text-sm font-bold tabular-nums text-accent">
                    {i + 1}
                  </span>
                  <h3 className="mt-1 font-medium">{steg.tittel}</h3>
                  <p className="mt-1 text-sm text-ink-secondary">{steg.tekst}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="text-xl font-bold tracking-tight">Hvorfor Notisen?</h2>
          <p className="mt-4 max-w-2xl text-ink-secondary">
            En oppsigelsesfrist er lett å glemme. Si at du har en
            programvareavtale til 5 000 kr i måneden med tre måneders
            oppsigelsesfrist. Glipper fristen, sitter bedriften bundet et nytt år
            – 60 000 kr, for en dato noen rett og slett glemte. Notisen holder
            styr på fristene, så det ikke skjer.
          </p>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="text-xl font-bold tracking-tight">
              Kom i gang med Notisen
            </h2>
            <p className="mt-2 text-ink-secondary">
              Det tar et par minutter å koble til Fiken.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/signup" className={btnPrimary}>
                Kom i gang
              </Link>
              <Link href="/login" className={btnSecondary}>
                Logg inn
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
