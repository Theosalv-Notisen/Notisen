import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { btnSecondarySm } from "@/components/ui/button-styles";

/**
 * Felles topptekst for de offentlige sidene (forsiden, /personvern).
 * Logo lenker til forsiden + «Logg inn»-knapp.
 */
export function MarketingHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" aria-label="Notisen – til forsiden">
          <Logo size="xl" />
        </Link>
        <Link href="/login" className={btnSecondarySm}>
          Logg inn
        </Link>
      </div>
    </header>
  );
}
