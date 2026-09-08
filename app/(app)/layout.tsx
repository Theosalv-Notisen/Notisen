import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { btnSecondarySm } from "@/components/ui/button-styles";

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
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/dashboard">
            <Logo size="sm" />
          </Link>

          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/dashboard"
              className="text-ink-secondary hover:text-ink"
            >
              Oversikt
            </Link>
            <Link
              href="/kontrakter"
              className="text-ink-secondary hover:text-ink"
            >
              Kontrakter
            </Link>
            <Link
              href="/settings"
              className="text-ink-secondary hover:text-ink"
            >
              Innstillinger
            </Link>
            <form action={signOut}>
              <button type="submit" className={btnSecondarySm}>
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
