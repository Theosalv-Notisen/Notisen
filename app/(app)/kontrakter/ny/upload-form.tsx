"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { labelClass } from "@/components/ui/field";

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
        <Alert variant="critical">
          Økten din er utløpt.{" "}
          <a href="/login?next=/kontrakter" className="underline">
            Logg inn på nytt
          </a>
          .
        </Alert>
      ) : null}
      {error ? <Alert variant="critical">{error}</Alert> : null}

      <label className={labelClass}>
        Kontrakt-PDF (maks 4 MB)
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="mt-1 block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border file:border-border file:px-3 file:py-1.5 file:text-sm"
        />
      </label>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Laster opp …" : "Last opp kontrakt"}
      </button>
    </form>
  );
}
