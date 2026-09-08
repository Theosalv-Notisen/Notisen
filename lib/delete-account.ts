/**
 * Sletting av en hel konto: alle PDF-er i storage + brukeren i auth.users
 * (som cascader all DB: fiken_connection, supplier, contract, reminder_log).
 *
 * INGEN `server-only`: tar admin-klienten inn som parameter, så testscript
 * kan importere og kjøre denne direkte via `node`.
 *
 * Rekkefølge: storage-filene FØRST, så `auth.admin.deleteUser`. Feiler noen
 * fil-sletting kaster vi FØR brukeren slettes – da kan brukeren logge inn og
 * prøve igjen. Er brukeren først borte, kan hen aldri retrye.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "contracts";
const LIST_LIMIT = 1000;
const REMOVE_BATCH = 100;

export type DeleteAccountResult = {
  /** Antall storage-objekter funnet under `<userId>/`. */
  storageFilesFound: number;
  /** Antall storage-objekter som faktisk ble slettet. */
  storageFilesDeleted: number;
  /** Feilmeldinger fra listing/sletting av storage. Ikke-tom => vi kastet. */
  storageErrors: string[];
  /** True bare hvis `auth.admin.deleteUser` gikk igjennom. */
  userDeleted: boolean;
};

export async function deleteAccountData(
  admin: SupabaseClient,
  userId: string,
): Promise<DeleteAccountResult> {
  const result: DeleteAccountResult = {
    storageFilesFound: 0,
    storageFilesDeleted: 0,
    storageErrors: [],
    userDeleted: false,
  };

  // ── 1. List alle objekter under `<userId>/` ────────────────────────────
  // Paginer til en side kommer tilbake med færre enn LIST_LIMIT rader –
  // da vet vi at vi har sett alt. Stopper vi for tidlig, blir filer
  // liggende igjen stille når en bruker har > 1000 kontrakter.
  const paths: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(userId, {
      limit: LIST_LIMIT,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      result.storageErrors.push(`Listing av storage feilet: ${error.message}`);
      break;
    }
    const entries = data ?? [];
    for (const entry of entries) {
      if (entry.id === null) {
        // En «mappe» – skal ikke forekomme med vår flate stikonvensjon.
        result.storageErrors.push(`Uventet mappe i storage: ${entry.name}`);
        continue;
      }
      paths.push(`${userId}/${entry.name}`);
    }
    if (entries.length < LIST_LIMIT) break;
    offset += LIST_LIMIT;
  }

  result.storageFilesFound = paths.length;

  // ── 2. Slett i batcher à 100 ──────────────────────────────────────────
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { data, error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) {
      result.storageErrors.push(
        `Sletting av storage-batch feilet: ${error.message}`,
      );
      continue;
    }
    result.storageFilesDeleted += (data ?? []).length;
  }

  // ── 3. Avbryt hvis noe storage-arbeid feilet – IKKE slett brukeren ────
  if (result.storageErrors.length > 0) {
    throw new Error(
      `Klarte ikke rydde alle storage-filer for bruker ${userId} ` +
        `(${result.storageFilesDeleted}/${result.storageFilesFound} slettet). ` +
        `Feil: ${result.storageErrors.join(" | ")}. Brukeren ble IKKE slettet.`,
    );
  }

  // ── 4. Hard delete av brukeren (cascader all DB) ─────────────────────
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    throw new Error(
      `Klarte ikke slette bruker ${userId}: ${delErr.message}`,
    );
  }
  result.userDeleted = true;

  return result;
}
