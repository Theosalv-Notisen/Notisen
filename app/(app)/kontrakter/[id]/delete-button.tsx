"use client";

import { deleteContract } from "../actions";

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
      <button
        type="submit"
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-500/20 dark:text-red-300"
      >
        Slett kontrakten
      </button>
    </form>
  );
}
