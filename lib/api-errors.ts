import { NextResponse } from "next/server";
import { FikenError } from "./fiken.ts";
import {
  FikenReauthRequiredError,
  NoFikenConnectionError,
  NotAuthenticatedError,
} from "./fiken-connection.ts";
import { TokenDecryptError } from "./token-crypto.ts";

/** Felles feil-til-JSON for Fiken-relaterte route handlers. */
export function errorResponse(err: unknown) {
  if (err instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof NoFikenConnectionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof FikenReauthRequiredError) {
    return NextResponse.json(
      { error: err.message, reconnect: true },
      { status: 409 },
    );
  }
  if (err instanceof TokenDecryptError) {
    // Drift-/konfigfeil (feil eller manglende TOKEN_ENC_KEY). Ikke noe brukeren
    // fikser med reconnect – ikke lekk detaljer.
    return NextResponse.json(
      {
        error:
          "Teknisk feil ved lesing av Fiken-tilkobling. Kontakt support.",
      },
      { status: 500 },
    );
  }
  if (err instanceof FikenError) {
    return NextResponse.json(
      { error: err.message, status: err.status, body: err.body },
      { status: err.status === 401 ? 401 : 502 },
    );
  }
  // Uventet feil: logg detaljen server-side, gi bruker en generisk melding
  // (rå `err.message` kan avsløre f.eks. manglende miljøvariabler).
  console.error("Uventet feil i Fiken-route:", err);
  return NextResponse.json(
    { error: "Noe gikk galt. Prøv igjen om litt." },
    { status: 500 },
  );
}
