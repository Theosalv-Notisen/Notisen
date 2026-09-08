"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { btnPrimary } from "@/components/ui/button-styles";

/**
 * Knapper/poller for tolkningsflyten på detaljsiden.
 *
 * - "run"        : kontrakten er lastet opp, ikke tolket → "Kjør uttrekk"
 * - "retry"      : forrige forsøk feilet → "Prøv igjen" (force=1)
 * - "processing" : tolkning pågår → oppdaterer siden med jevne mellomrom.
 *                  Gir opp etter ~5 min og viser "Prøv igjen" i stedet for
 *                  en evig spinner.
 * - "stuck"      : kontrakten har hengt i 'processing' for lenge (server
 *                  bestemte det) → "Prøv igjen" med en gang.
 */
const POLL_MS = 4000;
const MAX_POLLS = 75; // ~5 minutter

export function ExtractControls({
  contractId,
  mode,
}: {
  contractId: string;
  mode: "run" | "retry" | "processing" | "stuck";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (mode !== "processing" || gaveUp) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls >= MAX_POLLS) {
        setGaveUp(true);
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [mode, gaveUp, router]);

  const showStuck = mode === "stuck" || gaveUp;

  // Fersk tolkning pågår – bare vis at siden oppdaterer seg selv.
  if (mode === "processing" && !showStuck) {
    return (
      <p className="mt-4 text-sm text-ink-secondary">
        Leser kontrakten … siden oppdaterer seg selv.
      </p>
    );
  }

  // "retry" og "stuck"/ga-opp starter et nytt forsøk med force=1.
  const forceRetry = mode === "retry" || showStuck;

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const url = forceRetry
        ? `/api/contracts/${contractId}/extract?force=1`
        : `/api/contracts/${contractId}/extract`;
      const res = await fetch(url, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Klarte ikke starte tolkningen.");
        setBusy(false);
        return;
      }
      setGaveUp(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Nettverksfeil. Prøv igjen.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {showStuck ? (
        <Alert variant="neutral">
          Dette tar lengre tid enn normalt. Tolkningen kan ha stoppet – prøv å
          kjøre den på nytt.
        </Alert>
      ) : null}
      {error ? <Alert variant="critical">{error}</Alert> : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={btnPrimary}
      >
        {busy ? "Starter …" : forceRetry ? "Prøv igjen" : "Kjør uttrekk"}
      </button>
    </div>
  );
}
