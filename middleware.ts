import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Tynn wrapper – all logikk ligger i lib/supabase/middleware.ts.
 * Fornyer sesjonen og beskytter /dashboard + /settings + /kontrakter + /admin.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /*
   * Kjør KUN på sider der sesjonen faktisk betyr noe: de beskyttede sidene
   * (auth-sjekk + token-refresh) og innloggings-/registreringssidene (som
   * redirecter en allerede innlogget bruker videre). Alt annet – forsiden,
   * statiske filer, API-ruter (egne auth-sjekker), ikoner – slipper et
   * `getUser()`-nettverkskall per request.
   */
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/kontrakter/:path*",
    "/admin/:path*",
    "/login",
    "/signup",
  ],
};
