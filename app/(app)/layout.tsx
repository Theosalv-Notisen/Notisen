import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

/**
 * Layout for de innloggede sidene (/dashboard, /settings).
 * Header med navigasjon + utloggingsknapp. Selve tilgangskontrollen
 * skjer i middleware.ts og i requireUser() på hver side.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 dark:border-white/15">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="font-semibold">
            Notisen
          </Link>

          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="opacity-80 hover:opacity-100">
              Oversikt
            </Link>
            <Link href="/settings" className="opacity-80 hover:opacity-100">
              Innstillinger
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-black/15 px-3 py-1.5 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Logg ut
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
    </div>
  );
}
