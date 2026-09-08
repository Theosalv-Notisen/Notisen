"use client";

import { useState } from "react";
import { deleteAccount } from "./actions";
import { btnDanger } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";

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
      <label className={labelClass}>
        Skriv inn e-postadressen din for å bekrefte
        <input
          type="email"
          name="bekreftelse"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          className={inputClass + " max-w-xs"}
        />
      </label>
      <button
        type="submit"
        disabled={mismatch}
        className={btnDanger + " disabled:cursor-not-allowed"}
      >
        Slett kontoen min permanent
      </button>
    </form>
  );
}
