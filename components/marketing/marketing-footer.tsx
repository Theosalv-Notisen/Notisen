import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * Felles bunntekst for de offentlige sidene (forsiden, /personvern).
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-8 text-sm text-ink-tertiary sm:flex-row sm:items-center sm:justify-between">
        <Logo size="sm" />
        <p>Påminnelser om oppsigelsesfrister for bedriftsavtaler.</p>
        <Link href="/personvern" className="hover:text-ink">
          Personvern
        </Link>
      </div>
    </footer>
  );
}
