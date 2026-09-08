/**
 * Sentralt sted for miljøvariabler. Kaster tidlig hvis noe mangler,
 * så feilen blir tydelig i stedet for en rar "undefined" langt inne i koden.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Mangler miljøvariabel: ${name}. Se .env.example og legg den i .env.local.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  // Fiken OAuth2-klient ("Notisen"-appen i Fiken)
  fikenClientId: () => required("FIKEN_CLIENT_ID"),
  fikenClientSecret: () => required("FIKEN_CLIENT_SECRET"),
  fikenRedirectUri: () =>
    optional("FIKEN_REDIRECT_URI") ??
    "http://localhost:3000/api/fiken/oauth/callback",

  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),

  resendApiKey: () => required("RESEND_API_KEY"),
  reminderFromEmail: () => optional("REMINDER_FROM_EMAIL") ?? "varsel@notisen.no",

  /**
   * Basis-URL for appen, brukt til å bygge lenker i e-post o.l.
   * Server-side (ikke NEXT_PUBLIC_). Faller tilbake til lokal dev-URL.
   */
  appUrl: () => optional("APP_URL") ?? "http://localhost:3000",

  cronSecret: () => required("CRON_SECRET"),
  /** Som cronSecret(), men kaster ikke – brukes der vi vil svare 401 selv om variabelen mangler. */
  cronSecretOptional: () => optional("CRON_SECRET"),

  /**
   * Nøkkel for kryptering av Fiken OAuth-tokens før de lagres i Supabase.
   * Nøyaktig 32 bytes, base64-kodet i miljøet. Generer med:
   *   openssl rand -base64 32
   */
  tokenEncKey: (): Buffer => {
    const key = Buffer.from(required("TOKEN_ENC_KEY"), "base64");
    if (key.length !== 32) {
      throw new Error(
        `TOKEN_ENC_KEY må være nøyaktig 32 bytes base64-kodet (fikk ${key.length}). ` +
          "Generer en ny med: openssl rand -base64 32",
      );
    }
    return key;
  },
};
