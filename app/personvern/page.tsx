import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Personvernerklæring – Notisen",
  description:
    "Hvordan Notisen behandler personopplysninger: hva vi samler inn, hvorfor, hvem vi deler med, hvor lenge vi lagrer og hvilke rettigheter du har.",
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-12 text-xl font-bold tracking-tight text-ink">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-ink-secondary">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-secondary marker:text-ink-tertiary">
      {children}
    </ul>
  );
}

const BEHANDLINGER: {
  type: string;
  eksempel: string;
  formaal: string;
  grunnlag: string;
}[] = [
  {
    type: "Kontoopplysninger",
    eksempel: "E-postadresse, passord (kryptert)",
    formaal: "Opprette og administrere din brukerkonto",
    grunnlag: "Oppfyllelse av avtale (GDPR art. 6(1)(b))",
  },
  {
    type: "Fiken-tilgangsnøkler",
    eksempel: "OAuth-tilgangstoken til din Fiken-konto",
    formaal: "Hente leverandør- og kjøpsdata fra din regnskapsbok",
    grunnlag: "Oppfyllelse av avtale",
  },
  {
    type: "Leverandør- og transaksjonsdata fra Fiken",
    eksempel:
      "Leverandørnavn, organisasjonsnummer, beløp, datoer for kjøp",
    formaal: "Oppdage mønstre som tyder på løpende avtaler",
    grunnlag: "Oppfyllelse av avtale",
  },
  {
    type: "Opplastede kontrakter",
    eksempel: "PDF-filer du selv laster opp",
    formaal: "Lese ut fornyelses- og oppsigelsesfrister med KI",
    grunnlag: "Oppfyllelse av avtale",
  },
  {
    type: "Kontraktsdetaljer",
    eksempel:
      "Startdato, bindingstid, oppsigelsesfrist, fornyelsesdato",
    formaal: "Beregne når du skal varsles",
    grunnlag: "Oppfyllelse av avtale",
  },
  {
    type: "Varslings-e-post",
    eksempel: "E-postadresse, innhold i påminnelse",
    formaal: "Sende deg påminnelser før frister",
    grunnlag: "Oppfyllelse av avtale",
  },
  {
    type: "Bruksdata",
    eksempel: "Innlogginger, feillogger",
    formaal: "Drift, sikkerhet og feilsøking",
    grunnlag: "Berettiget interesse (GDPR art. 6(1)(f))",
  },
];

export default function PersonvernPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Personvernerklæring for Notisen
          </h1>
          <p className="mt-3 text-sm text-ink-tertiary">
            Sist oppdatert: 09.09.2026
          </p>

          <H2>1. Hvem er ansvarlig for dine personopplysninger?</H2>
          <P>
            Notisen leveres av Theodor Salvesen («vi», «oss»). Vi er
            behandlingsansvarlig for personopplysningene som behandles gjennom
            tjenesten.
          </P>
          <P>
            Kontakt:{" "}
            <a
              href="mailto:kontakt@notisen.no"
              className="text-accent hover:text-accent-hover"
            >
              kontakt@notisen.no
            </a>
          </P>

          <H2>2. Hva er Notisen?</H2>
          <P>
            Notisen er en tjeneste som kobler seg til din bedrifts
            Fiken-regnskap, oppdager tilbakevendende leverandørbetalinger som kan
            tyde på løpende avtaler, og lar deg laste opp kontrakter slik at vi
            kan hente ut fornyelses- og oppsigelsesfrister automatisk. Vi sender
            deg en e-postpåminnelse i god tid før en frist løper ut.
          </P>

          <H2>3. Hvilke personopplysninger behandler vi, og hvorfor</H2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-ink">
                  <th className="py-2 pr-4 font-medium">Type opplysning</th>
                  <th className="py-2 pr-4 font-medium">Eksempel</th>
                  <th className="py-2 pr-4 font-medium">Formål</th>
                  <th className="py-2 font-medium">Behandlingsgrunnlag</th>
                </tr>
              </thead>
              <tbody className="text-ink-secondary">
                {BEHANDLINGER.map((rad) => (
                  <tr
                    key={rad.type}
                    className="border-b border-border align-top"
                  >
                    <td className="py-3 pr-4 text-ink">{rad.type}</td>
                    <td className="py-3 pr-4">{rad.eksempel}</td>
                    <td className="py-3 pr-4">{rad.formaal}</td>
                    <td className="py-3">{rad.grunnlag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            Merk: Når en leverandør i Fiken-regnskapet er et
            enkeltpersonforetak, kan leverandørens navn og organisasjonsnummer
            regnes som en personopplysning knyttet til en identifiserbar fysisk
            person. Vi behandler denne informasjonen kun for å oppdage og følge
            opp avtaler på vegne av deg som kunde – ikke til egne formål.
          </P>

          <H2>4. Hvem deler vi opplysninger med (våre databehandlere)</H2>
          <P>
            Vi bruker følgende underleverandører til å levere tjenesten. Alle er
            bundet av databehandleravtaler (DPA) som stiller krav til sikkerhet
            og bruk av dine data:
          </P>
          <UL>
            <li>
              <strong className="font-medium text-ink">Supabase</strong>{" "}
              (database, filer og innlogging) – lagrer kontodata, kontraktsdata
              og opplastede PDF-er. Serverregion: EU (Frankfurt).
            </li>
            <li>
              <strong className="font-medium text-ink">Anthropic</strong>{" "}
              (Claude API) – leser innholdet i opplastede PDF-er for å hente ut
              datoer og vilkår. Innholdet sendes til Anthropics API for
              behandling; Anthropic sletter denne inndataen innen 30 dager, og
              bruker den ikke til å trene egne modeller.
            </li>
            <li>
              <strong className="font-medium text-ink">Resend</strong> – sender
              e-postpåminnelser på våre vegne. Lagrer en logg over sendte
              e-poster (mottakeradresse, tidspunkt, leveringsstatus) i 30 dager,
              og sletter den deretter automatisk.
            </li>
            <li>
              <strong className="font-medium text-ink">Fiken</strong> – kilden
              til regnskaps- og leverandørdataene. Du kobler selv til din egen
              Fiken-konto, og kan når som helst koble fra i appen.
            </li>
            <li>
              <strong className="font-medium text-ink">Vercel</strong> – drifter
              selve applikasjonen (serverne appen kjører på).
            </li>
            <li>
              <strong className="font-medium text-ink">Upstash</strong> – lagrer
              korte, midlertidige tellere for å begrense antall
              innloggings-/registrerings-/passordreset-forsøk
              (misbruksbeskyttelse). Ingen personopplysninger utover
              IP-adresse/e-post i selve telleren.
            </li>
            <li>
              <strong className="font-medium text-ink">Sentry</strong> – mottar
              tekniske feilmeldinger fra serveren ved uventede feil, for
              feilsøking. Kan i sjeldne tilfeller inneholde deler av tekniske
              data knyttet til forespørselen som feilet.
            </li>
          </UL>
          <P>
            Vi selger aldri personopplysninger videre, og bruker dem ikke til
            markedsføring mot tredjeparter.
          </P>

          <H2>5. Overføring utenfor EU/EØS</H2>
          <P>
            Enkelte av underleverandørene våre (blant annet Anthropic) kan
            behandle data på servere utenfor EU/EØS. Slike overføringer er dekket
            av EUs standard personvernbestemmelser (Standard Contractual Clauses,
            SCC), som er inkludert i databehandleravtalene med disse
            leverandørene.
          </P>

          <H2>6. Hvor lenge lagrer vi opplysningene dine</H2>
          <P>
            Vi lagrer opplysningene dine så lenge du har en aktiv konto hos oss.
            Sletter du kontoen din, sletter vi umiddelbart tilhørende
            kontraktsdata, opplastede filer og Fiken-tilgangsnøkler fra den
            aktive databasen.
          </P>
          <P>
            Enkelte kopier kan likevel finnes en kort periode etter sletting, av
            tekniske og sikkerhetsmessige grunner:
          </P>
          <UL>
            <li>
              <strong className="font-medium text-ink">
                Sikkerhetskopier (backup):
              </strong>{" "}
              Vår databaseleverandør (Supabase) tar automatiske sikkerhetskopier
              som roterer ut etter cirka 7 dager. Data som er slettet fra den
              aktive databasen kan derfor finnes i en sikkerhetskopi i inntil 7
              dager før den også forsvinner permanent.
            </li>
            <li>
              <strong className="font-medium text-ink">
                E-postleveringslogger:
              </strong>{" "}
              Vår e-postleverandør (Resend) fører logg over sendte varsler (f.eks.
              tidspunkt og leveringsstatus) i 30 dager, og sletter den deretter
              automatisk.
            </li>
            <li>
              <strong className="font-medium text-ink">Innloggingslogg:</strong>{" "}
              Vi fører en teknisk logg over innlogginger og kontohendelser – tidspunkt
              og IP-adresse for innlogging, utlogging og passordendring – av
              hensyn til sikkerhet og misbrukskontroll. Denne behandles separat
              fra kontraktsdataene dine og slettes automatisk 90 dager etter at
              hendelsen skjedde.
            </li>
          </UL>

          <H2>7. Dine rettigheter</H2>
          <P>
            Du har etter personopplysningsloven/GDPR rett til å:
          </P>
          <UL>
            <li>Få innsyn i hvilke opplysninger vi har om deg</li>
            <li>Få rettet feil opplysninger</li>
            <li>Få slettet opplysningene dine</li>
            <li>
              Få utlevert opplysningene dine i et maskinlesbart format
              (dataportabilitet)
            </li>
            <li>
              Trekke tilbake samtykke og protestere mot behandling basert på
              berettiget interesse
            </li>
            <li>
              Klage til Datatilsynet (
              <a
                href="https://www.datatilsynet.no"
                className="text-accent hover:text-accent-hover"
                target="_blank"
                rel="noopener noreferrer"
              >
                datatilsynet.no
              </a>
              ) hvis du mener vi behandler opplysningene dine i strid med
              regelverket
            </li>
          </UL>
          <P>
            Ønsker du å bruke noen av disse rettighetene, kontakt oss på{" "}
            <a
              href="mailto:kontakt@notisen.no"
              className="text-accent hover:text-accent-hover"
            >
              kontakt@notisen.no
            </a>
            .
          </P>

          <H2>8. Sikkerhet</H2>
          <P>
            Vi bruker radbasert tilgangskontroll (Row Level Security) slik at
            hver kunde kun kan se sine egne data, og krypterer trafikk til og fra
            tjenesten (TLS).
          </P>
          <P>
            Tilgangsnøklene (OAuth-tokens) Notisen mottar fra Fiken lagres
            kryptert i databasen med AES-256-GCM. Krypteringsnøkkelen oppbevares
            adskilt fra databasen, som en miljøvariabel hos driftsleverandøren
            (Vercel), og er verken lagret i databasen eller i kildekoden. Nøklene
            dekrypteres kun midlertidig i minnet på serveren i det øyeblikket
            Notisen gjør et API-kall mot Fiken på dine vegne, og de logges aldri.
            Dette kommer i tillegg til krypteringen Supabase
            (databaseleverandøren) har på lagringsnivå.
          </P>
          <P>
            Vi bruker rate limiting på innlogging, registrering og
            passordtilbakestilling for å beskytte mot automatiserte angrep, og
            overvåker produksjonsmiljøet for uventede feil.
          </P>

          <H2>9. Endringer i personvernerklæringen</H2>
          <P>
            Vi kan oppdatere denne erklæringen ved behov, for eksempel når vi tar
            i bruk nye underleverandører. Ved vesentlige endringer varsler vi deg
            på e-post.
          </P>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
