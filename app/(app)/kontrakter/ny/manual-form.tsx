"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";
import { inputClass, labelClass } from "@/components/ui/field";
import {
  ALLOWED_REMINDER_OFFSETS,
  DEFAULT_REMINDER_OFFSETS,
} from "@/lib/reminder-offsets";

/**
 * Skjema for å legge til en kontrakt manuelt (avtaler som ikke går via Fiken).
 * Poster multipart til /api/contracts/manual (PDF er valgfri), navigerer så til
 * detaljsiden. Samme frist-/varslingslogikk som de andre kontraktene.
 */
export function ManualForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const defaultOffsets = new Set<number>(DEFAULT_REMINDER_OFFSETS);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/contracts/manual", {
        method: "POST",
        body: new FormData(e.currentTarget),
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
        setError(json.error ?? "Klarte ikke lagre kontrakten. Prøv igjen.");
        setBusy(false);
        return;
      }
      router.push(`/kontrakter/${json.contractId}`);
    } catch {
      setError("Nettverksfeil. Prøv igjen.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      {sessionExpired ? (
        <Alert variant="critical">
          Økten din er utløpt.{" "}
          <a href="/login?next=/kontrakter/ny" className="underline">
            Logg inn på nytt
          </a>
          .
        </Alert>
      ) : null}
      {error ? <Alert variant="critical">{error}</Alert> : null}

      <label className={labelClass}>
        Hvem er avtalen med?
        <input
          type="text"
          name="supplier_name"
          required
          maxLength={200}
          placeholder="F.eks. Skyfjord Programvare AS"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Startdato
        <input
          type="date"
          name="contract_start"
          className={inputClass + " tabular-nums"}
        />
      </label>

      <label className={labelClass}>
        Bindingstid utløper
        <input
          type="date"
          name="binding_until"
          className={inputClass + " tabular-nums"}
        />
      </label>

      <label className={labelClass}>
        Fornyelsesdato
        <input
          type="date"
          name="renewal_date"
          className={inputClass + " tabular-nums"}
        />
      </label>

      <label className={labelClass}>
        Avtaleperiode (måneder)
        <input
          type="number"
          name="term_months"
          min={0}
          className={inputClass + " w-40 tabular-nums"}
        />
      </label>

      <label className={labelClass}>
        Oppsigelsesfrist (dager)
        <input
          type="number"
          name="notice_period_days"
          min={0}
          className={inputClass + " w-40 tabular-nums"}
        />
      </label>

      <label className={labelClass}>
        Fornyes automatisk
        <select name="auto_renews" defaultValue="" className={inputClass}>
          <option value="">Vet ikke</option>
          <option value="true">Ja</option>
          <option value="false">Nei</option>
        </select>
      </label>

      <fieldset>
        <legend className={labelClass}>Varsle meg før fristen</legend>
        <p className="mt-1 text-xs text-ink-tertiary">
          Du får én e-post per avkrysset tidspunkt. Standard er 90, 30 og 7 dager
          før.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {ALLOWED_REMINDER_OFFSETS.map((days) => (
            <label key={days} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="reminder_offsets"
                value={days}
                defaultChecked={defaultOffsets.has(days)}
                className="accent-accent"
              />
              <span className="tabular-nums">
                {days} {days === 1 ? "dag" : "dager"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={labelClass}>
        Kontrakt-PDF (valgfritt, maks 4 MB)
        <input
          type="file"
          name="file"
          accept="application/pdf"
          className="mt-1 block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border file:border-border file:px-3 file:py-1.5 file:text-sm"
        />
      </label>

      <div>
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Lagrer …" : "Legg til kontrakt"}
        </button>
        <p className="mt-2 text-xs text-ink-tertiary">
          Fristen regnes ut fra feltene du fyller inn. Mangler det data til å
          regne ut en frist, legges kontrakten inn uten varsling til du fyller
          ut mer.
        </p>
      </div>
    </form>
  );
}
