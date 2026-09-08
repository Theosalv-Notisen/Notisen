"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Laster opp PDF-en via fetch (ikke vanlig form-post) fordi
 * /api/contracts/upload svarer med JSON `{ contractId }` – vi navigerer selv
 * til detaljsiden etterpå.
 */
export function UploadForm({
  companySlug,
  fikenContactId,
}: {
  companySlug: string;
  fikenContactId: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("companySlug", companySlug);
    data.set("fikenContactId", String(fikenContactId));

    setBusy(true);
    try {
      const res = await fetch("/api/contracts/upload", {
        method: "POST",
        body: data,
      });
      const json = (await res.json().catch(() => ({}))) as {
        contractId?: string;
        error?: string;
      };
      if (res.status === 401) {
        setSessionExpired(true);
        setBusy(false);
        return;
      }
      if (!res.ok || !json.contractId) {
        setError(json.error ?? "Opplasting feilet. Prøv igjen.");
        setBusy(false);
        return;
      }
      router.push(`/kontrakter/${json.contractId}`);
    } catch {
      setError("Nettverksfeil under opplasting. Prøv igjen.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {sessionExpired ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Økten din er utløpt.{" "}
          <a href="/login?next=/kontrakter" className="underline">
            Logg inn på nytt
          </a>
          .
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <label className="block text-sm">
        Kontrakt-PDF (maks 4 MB)
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-black/15 file:px-3 file:py-1.5 file:text-sm dark:file:border-white/20"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy ? "Laster opp …" : "Last opp kontrakt"}
      </button>
    </form>
  );
}
