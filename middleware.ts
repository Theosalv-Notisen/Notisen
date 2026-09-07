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
     * - _next/static, _next/image (byggeartefakter)
     * - favicon.ico og vanlige bildefiler
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
