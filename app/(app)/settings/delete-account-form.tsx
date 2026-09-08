"use client";

import { useState } from "react";
import { deleteAccount } from "./actions";

/**
 * Slett-konto-skjema. Ligger i "Faresone"-seksjonen på innstillingssiden.
 *
 * To hindre mot uhell:
 *  1. Knappen er `disabled` til du har skrevet din egen e-postadresse.
 *  2. `window.confirm` før innsending.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const [value, setValue] = useState("");
  const mismatch = value.trim().toLowerCase() !== email.toLowerCase();

  return (
    <form
      action={deleteAccount}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Dette sletter kontoen din, alle kontrakter og alle PDF-er permanent. Kan ikke angres.",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Skriv inn e-postadressen din for å bekrefte
        <input
          type="email"
          name="bekreftelse"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          className="mt-1 block w-full max-w-xs rounded-lg border border-black/15 px-3 py-2 dark:border-white/20 dark:bg-transparent"
        />
      </label>
      <button
        type="submit"
        disabled={mismatch}
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300"
      >
        Slett kontoen min permanent
      </button>
    </form>
  );
}
