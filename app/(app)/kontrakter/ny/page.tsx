import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  FikenReauthRequiredError,
  getFikenClientForCurrentUser,
  NoFikenConnectionError,
} from "@/lib/fiken-connection";
import { FikenError, type FikenContact } from "@/lib/fiken";
import { UploadForm } from "./upload-form";

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
    <p className="mt-8 rounded-xl border border-black/10 p-6 text-sm opacity-75 dark:border-white/15">
      {children}
    </p>
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

  if (!company || !contact || !Number.isFinite(contactId)) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Last opp kontrakt</h1>
        <Melding>
          Mangler informasjon om hvilken leverandør kontrakten gjelder. Gå til{" "}
          <Link href="/dashboard" className="underline">
            oversikten
          </Link>{" "}
          og velg «Last opp kontrakt» på en leverandør.
        </Melding>
      </div>
    );
  }

  const result = await lookupContact(company, contactId);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Last opp kontrakt</h1>

      {result.kind === "ok" ? (
        <>
          <p className="mt-2 text-sm opacity-70">
            Leverandør:{" "}
            <span className="font-medium opacity-100">
              {result.contact.name}
            </span>
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
          <Link href="/settings" className="underline">
            innstillinger
          </Link>
          .
        </Melding>
      ) : null}

      {result.kind === "reauth" ? (
        <Melding>
          Fiken-tilkoblingen har utløpt. Forny den under{" "}
          <Link href="/settings" className="underline">
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
