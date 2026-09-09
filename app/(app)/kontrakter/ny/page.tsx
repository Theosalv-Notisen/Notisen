import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError, type FikenContact } from "@/lib/fiken";
import { UploadForm } from "./upload-form";
import { ManualForm } from "./manual-form";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";

type Lookup =
  | { kind: "ok"; contact: FikenContact }
  | { kind: "not_found" }
  | { kind: "not_connected" }
  | { kind: "reauth" }
  | { kind: "error" };

async function lookupContact(
  companySlug: string,
  contactId: number,
): Promise<Lookup> {
  try {
    const fiken = await getFikenClientForCurrentUser();
    const suppliers = await fiken.suppliers(companySlug);
    const contact = suppliers.find((s) => s.contactId === contactId);
    return contact ? { kind: "ok", contact } : { kind: "not_found" };
  } catch (err) {
    if (err instanceof NoFikenConnectionError) return { kind: "not_connected" };
    if (err instanceof FikenReauthRequiredError) return { kind: "reauth" };
    if (err instanceof FikenError) return { kind: "error" };
    console.error("Feil ved oppslag av Fiken-kontakt:", err);
    return { kind: "error" };
  }
}

function Melding({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="neutral" className="mt-8">
      {children}
    </Alert>
  );
}

export default async function NyKontraktPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; contact?: string }>;
}) {
  await requireUser("/kontrakter/ny");
  const { company, contact } = await searchParams;
  const contactId = Number(contact);

  // Uten Fiken-leverandør i URL-en → manuell registrering.
  if (!company || !contact || !Number.isFinite(contactId)) {
    return (
      <div>
        <Link
          href="/kontrakter"
          className="text-sm text-ink-secondary hover:text-ink"
        >
          ← Alle kontrakter
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Ny kontrakt</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Legg til en avtale som ikke går via Fiken, eller som Notisen ikke har
          fanget opp. Har du en Fiken-leverandør, gå heller til{" "}
          <Link href="/dashboard" className="text-accent underline">
            Finn avtaler
          </Link>
          .
        </p>
        <ManualForm />
      </div>
    );
  }

  const result = await lookupContact(company, contactId);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Last opp kontrakt</h1>

      {result.kind === "ok" ? (
        <>
          <p className="mt-2 text-sm text-ink-secondary">
            Leverandør:{" "}
            <span className="font-medium text-ink">{result.contact.name}</span>
            {result.contact.organizationNumber
              ? ` · org.nr ${result.contact.organizationNumber}`
              : ""}
          </p>
          <UploadForm companySlug={company} fikenContactId={contactId} />
        </>
      ) : null}

      {result.kind === "not_found" ? (
        <Melding>
          Fant ikke denne leverandøren i Fiken. Den kan ha blitt fjernet eller
          endret.
        </Melding>
      ) : null}

      {result.kind === "not_connected" ? (
        <Melding>
          Du må koble til Fiken først. Gå til{" "}
          <Link href="/settings" className="text-accent underline">
            innstillinger
          </Link>
          .
        </Melding>
      ) : null}

      {result.kind === "reauth" ? (
        <Melding>
          Fiken-tilkoblingen har utløpt. Forny den under{" "}
          <Link href="/settings" className="text-accent underline">
            innstillinger
          </Link>
          .
        </Melding>
      ) : null}

      {result.kind === "error" ? (
        <Melding>Klarte ikke hente leverandøren fra Fiken nå. Prøv igjen om litt.</Melding>
      ) : null}
    </div>
  );
}
