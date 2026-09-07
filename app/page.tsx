export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Notisen</h1>
      <p className="mt-3 text-lg opacity-80">
        Aldri gå glipp av en oppsigelsesfrist igjen.
      </p>

      <div className="mt-10 rounded-xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="font-medium">Kom i gang</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm opacity-80">
          <li>Legg inn Fiken-nøkkel i <code>.env.local</code></li>
          <li>
            Kjør <code>npm run fiken:suppliers</code> for å teste tilkoblingen
          </li>
          <li>
            Åpne{" "}
            <a className="underline" href="/api/fiken/suppliers">
              /api/fiken/suppliers
            </a>{" "}
            for å se leverandørene som JSON
          </li>
        </ol>
      </div>
    </main>
  );
}
