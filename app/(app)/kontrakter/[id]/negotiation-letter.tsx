"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { btnPrimary, btnSecondary } from "@/components/ui/button-styles";

/**
 * Del 2 av forhandlingscopiloten: lag et utkast til oppsigelse eller
 * reforhandling med Claude, rediger fritt, og kopier det. Notisen sender
 * ingenting – brukeren sender selv.
 */

type LetterKind = "cancellation" | "renegotiation";

const KIND_LABEL: Record<LetterKind, string> = {
  cancellation: "Oppsigelse",
  renegotiation: "Reforhandling",
};

export function NegotiationLetter({
  contractId,
  initialDraft,
  initialKind,
  initialAt,
}: {
  contractId: string;
  initialDraft: string | null;
  initialKind: LetterKind | null;
  initialAt: string | null;
}) {
  const [text, setText] = useState(initialDraft ?? "");
  const [kind, setKind] = useState<LetterKind | null>(initialKind);
  const [busy, setBusy] = useState<LetterKind | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(initialAt);
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate(k: LetterKind) {
    if (
      text.trim() &&
      !window.confirm(
        "Dette erstatter teksten du har nå. Vil du fortsette?",
      )
    ) {
      return;
    }
    setBusy(k);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/contracts/${contractId}/letter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: k }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        text?: string;
        savedAt?: string | null;
        error?: string;
      };
      if (!res.ok || !json.text) {
        setError(json.error ?? "Klarte ikke lage utkastet.");
        return;
      }
      setText(json.text);
      setKind(k);
      setSavedAt(json.savedAt ?? null);
      setDirty(false);
    } catch {
      setError("Nettverksfeil. Prøv igjen.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/letter`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        savedAt?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Klarte ikke lagre.");
        return;
      }
      setSavedAt(json.savedAt ?? new Date().toISOString());
      setDirty(false);
    } catch {
      setError("Nettverksfeil. Prøv igjen.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Klarte ikke kopiere automatisk – marker teksten og kopier selv.");
    }
  }

  const anyBusy = busy !== null;

  return (
    <section className="mt-12 border-t border-border pt-6">
      <h2 className="text-sm font-semibold">Utkast til brev</h2>
      <p className="mt-1 text-xs text-ink-tertiary">
        Claude lager et utkast fra kontraktsdetaljene (og prisutviklingen fra
        Fiken hvis vi har den). Du redigerer og sender selv – Notisen sender
        ingenting.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => generate("cancellation")}
          disabled={anyBusy}
          className={btnSecondary}
        >
          {busy === "cancellation" ? "Lager utkast …" : "Lag oppsigelse"}
        </button>
        <button
          type="button"
          onClick={() => generate("renegotiation")}
          disabled={anyBusy}
          className={btnSecondary}
        >
          {busy === "renegotiation"
            ? "Lager utkast …"
            : "Lag reforhandlingsbrev"}
        </button>
      </div>

      {error ? (
        <Alert variant="critical" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {text ? (
        <div className="mt-4">
          {kind ? (
            <p className="text-xs text-ink-tertiary">
              Type: {KIND_LABEL[kind]}
              {savedAt && !dirty ? " · lagret" : ""}
              {dirty ? " · ikke lagret" : ""}
            </p>
          ) : null}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
              setCopied(false);
            }}
            rows={16}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-ink-tertiary">
            Sjekk alltid navn, datoer og [plassholdere] før du sender. Utkastet
            er et forslag, ikke juridisk rådgivning.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              disabled={anyBusy}
              className={btnPrimary}
            >
              {copied ? "Kopiert ✓" : "Kopier"}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={anyBusy || !dirty}
              className={btnSecondary}
            >
              {busy === "save" ? "Lagrer …" : "Lagre endringer"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
