"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Knapper/poller for tolkningsflyten på detaljsiden.
 *
 * - "run"        : kontrakten er lastet opp, ikke tolket → "Kjør uttrekk"
 * - "retry"      : forrige forsøk feilet → "Prøv igjen" (force=1)
 * - "processing" : tolkning pågår → oppdaterer siden hvert 4. sekund
 */
export function ExtractControls({
  contractId,
  mode,
}: {
  contractId: string;
  mode: "run" | "retry" | "processing";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "processing") return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [mode, router]);

  if (mode === "processing") {
    return (
      <p className="mt-4 text-sm opacity-70">
        Leser kontrakten … siden oppdaterer seg selv.
      </p>
    );
  }

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const url =
        mode === "retry"
          ? `/api/contracts/${contractId}/extract?force=1`
          : `/api/contracts/${contractId}/extract`;
      const res = await fetch(url, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Klarte ikke starte tolkningen.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Nettverksfeil. Prøv igjen.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {busy
          ? "Starter …"
          : mode === "retry"
            ? "Prøv igjen"
            : "Kjør uttrekk"}
      </button>
    </div>
  );
}
