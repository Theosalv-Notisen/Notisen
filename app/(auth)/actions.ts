"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Server actions for registrering, innlogging og utlogging.
 * Ingen klient-JS – skjemaene poster rett hit.
 */

/** Der en innlogget bruker lander uten et eksplisitt `next`. */
const DEFAULT_LANDING = "/kontrakter";

/**
 * Beskytt mot "open redirect": bare en enkel intern sti godtas.
 * Alt annet (protokoll-relativt `//`, `/\`, kontrolltegn som nettleseren
 * stripper til noe farlig, absolutte URL-er) faller tilbake til DEFAULT_LANDING.
 */
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return DEFAULT_LANDING;
  // Må starte med én "/" fulgt av noe som ikke er "/" eller "\".
  if (!/^\/[^/\\]/.test(value)) return DEFAULT_LANDING;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return DEFAULT_LANDING; // kontrolltegn
  }
  try {
    const url = new URL(value, "http://localhost");
    if (url.origin !== "http://localhost") return DEFAULT_LANDING;
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_LANDING;
  }
}

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    next: safeNext(formData.get("next")),
  };
}

/**
 * Oversett Supabase-signup-feil til en kort kode. Sidene oversetter koden til
 * norsk tekst. Vi lekker aldri rå `error.message` – bl.a. for å ikke bekrefte
 * om en e-post allerede finnes.
 */
function signupFeilkode(message: string): string {
  const m = message.toLowerCase();
  // bcrypt-grensen er 72 bytes – Supabase-feilen nevner "72" eller "long".
  if (m.includes("72") || m.includes("too long") || m.includes("for langt")) {
    return "for-langt-passord";
  }
  if (m.includes("password")) return "svakt-passord";
  if (m.includes("valid") && m.includes("email")) return "ugyldig-epost";
  return "ukjent";
}

export async function signUp(formData: FormData) {
  const { email, password, next } = readCredentials(formData);

  if (!email || !password) {
    redirect(`/signup?feil=tomt&next=${encodeURIComponent(next)}`);
  }
  if (password.length > 72) {
    redirect(`/signup?feil=for-langt-passord&next=${encodeURIComponent(next)}`);
  }

  if (!(await rateLimit("signup", email)).allowed) {
    redirect(`/signup?feil=rate&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(
      `/signup?feil=${signupFeilkode(error.message)}&next=${encodeURIComponent(next)}`,
    );
  }

  redirect(next);
}

export async function signIn(formData: FormData) {
  const { email, password, next } = readCredentials(formData);

  if (!email || !password) {
    redirect(`/login?feil=tomt&next=${encodeURIComponent(next)}`);
  }

  if (!(await rateLimit("login", email)).allowed) {
    redirect(`/login?feil=rate&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Alltid generisk: ikke avslør om e-posten finnes.
    redirect(`/login?feil=ugyldig&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
