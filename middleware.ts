import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Tynn wrapper – all logikk ligger i lib/supabase/middleware.ts.
 * Fornyer sesjonen og beskytter /dashboard + /settings.
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Alle stier bortsett fra:
     * - api (route handlers gjør egne auth-sjekker; slipper et getUser()-
     *   nettverkskall per API-request)
     * - _next/static, _next/image (byggeartefakter)
     * - favicon.ico og vanlige bildefiler
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
