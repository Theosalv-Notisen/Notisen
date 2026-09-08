import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "@/lib/fiken-oauth";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * GET /api/fiken/oauth/start
 * Starter OAuth-flyten: setter en state-cookie og sender brukeren til Fiken.
 * Callback krever uansett sesjon – sjekken her er for ryddighet / mindre støy.
 */
export async function GET(request: Request) {
  if (!(await getCurrentUser())) {
    return NextResponse.redirect(
      new URL("/login?next=/settings", request.url),
    );
  }

  const state = randomUUID();

  const cookieStore = await cookies();
  cookieStore.set("fiken_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: env.fikenClientId(),
      redirectUri: env.fikenRedirectUri(),
      state,
    }),
  );
}
