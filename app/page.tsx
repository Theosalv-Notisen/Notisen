export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Notisen</h1>
      <p className="mt-3 text-lg opacity-80">
        Aldri gå glipp av en oppsigelsesfrist igjen.
      </p>

      <div className="mt-10 rounded-xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="font-medium">Status</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm opacity-80">
          <li>Fiken OAuth-flyt: /api/fiken/oauth/start → callback</li>
          <li>Gjenkjenning av løpende avtaler: lib/recurring.ts</li>
          <li>
            Test mot ekte data uten resten av appen:{" "}
            <code>npm run fiken:test</code>
          </li>
        </ul>
        <p className="mt-4 text-sm opacity-60">
          Innlogging (Supabase Auth), dashboard og PDF-opplasting kommer.
        </p>
      </div>
    </main>
  );
}
