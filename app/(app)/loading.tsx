/**
 * Vises umiddelbart ved navigasjon mens server-siden rendrer. Gjør at
 * sidebytter føles raske selv når data hentes fra Supabase/Fiken.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="h-8 w-40 rounded bg-ink/10" />
      <div className="mt-3 h-4 w-2/3 rounded bg-ink/5" />

      <div className="mt-8 space-y-3">
        <div className="h-28 rounded-xl border border-border bg-surface" />
        <div className="h-28 rounded-xl border border-border bg-surface" />
        <div className="h-28 rounded-xl border border-border bg-surface" />
      </div>
    </div>
  );
}
