/**
 * Sletting av én kontrakt: DB-rad + tilhørende PDF i storage.
 *
 * INGEN `server-only`: tar supabase-klienten inn som parameter, så
 * testscript kan importere og kjøre denne direkte via `node`.
 *
 * Rekkefølge: DB-raden FØRST, så storage. DB-raden er sannheten –
 * `reminder_log` cascader via FK, og en gjenværende fil er liten og ufarlig.
 * Motsatt rekkefølge kunne etterlatt en rad som peker på en manglende fil.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteContractResult = {
  /** True bare hvis en rad faktisk ble slettet (fantes OG var eid av brukeren). */
  deleted: boolean;
  /** Stien til PDF-en som ble (forsøkt) fjernet, hvis noen. */
  storagePath: string | null;
  /** Satt hvis DB-raden ble slettet, men fila ikke lot seg fjerne. */
  storageError: string | null;
};

export async function deleteContractById(
  supabase: SupabaseClient,
  userId: string,
  contractId: string,
): Promise<DeleteContractResult> {
  // DB-rad først. `.eq("user_id", ...)` gjør at et treff = raden fantes OG er eid.
  const { data, error } = await supabase
    .from("contract")
    .delete()
    .eq("id", contractId)
    .eq("user_id", userId)
    .select("storage_path")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    // Ikke funnet ELLER ikke eid – ikke en falsk suksess.
    return { deleted: false, storagePath: null, storageError: null };
  }

  const storagePath = (data.storage_path as string | null) ?? null;
  let storageError: string | null = null;

  if (storagePath) {
    const { error: rmErr } = await supabase.storage
      .from("contracts")
      .remove([storagePath]);
    if (rmErr) {
      console.error(
        "Klarte ikke slette PDF fra storage for kontrakt",
        contractId,
        rmErr.message,
      );
      storageError = rmErr.message;
    }
  }

  return { deleted: true, storagePath, storageError };
}
