import { NextResponse } from "next/server";
import { FikenError } from "./fiken.ts";
import {
  FikenReauthRequiredError,
  NoFikenConnectionError,
} from "./fiken-connection.ts";

/** Felles feil-til-JSON for Fiken-relaterte route handlers. */
export function errorResponse(err: unknown) {
  if (err instanceof NoFikenConnectionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof FikenReauthRequiredError) {
    return NextResponse.json(
      { error: err.message, reconnect: true },
      { status: 409 },
    );
  }
  if (err instanceof FikenError) {
    return NextResponse.json(
      { error: err.message, status: err.status, body: err.body },
      { status: err.status === 401 ? 401 : 502 },
    );
  }
  const message = err instanceof Error ? err.message : "Ukjent feil";
  return NextResponse.json({ error: message }, { status: 500 });
}
