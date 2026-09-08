"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Toppmeny-lenkene for de innloggede sidene. Klientkomponent kun for å kunne
 * markere den aktive siden med `usePathname` – selve navigasjonen er vanlige
 * <Link>-er.
 */
const LINKS = [
  { href: "/dashboard", label: "Oversikt" },
  { href: "/kontrakter", label: "Kontrakter" },
  { href: "/settings", label: "Innstillinger" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "font-medium text-accent underline decoration-2 underline-offset-8"
                : "text-ink-secondary hover:text-ink"
            }
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
