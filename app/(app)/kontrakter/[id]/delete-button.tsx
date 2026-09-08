"use client";

import { deleteContract } from "../actions";
import { btnDanger } from "@/components/ui/button-styles";

/**
 * Slett-knapp for kontrakt-detaljsiden. Ligger i "Faresone"-seksjonen.
 * `window.confirm` før innsending så et uhell ikke sletter noe permanent.
 */
export function DeleteButton({ contractId }: { contractId: string }) {
  return (
    <form
      action={deleteContract}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Slette denne kontrakten permanent? Dette kan ikke angres.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={contractId} />
      <button type="submit" className={btnDanger}>
        Slett kontrakten
      </button>
    </form>
  );
}
