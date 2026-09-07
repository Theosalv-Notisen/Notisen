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
  fikenToken: () => required("FIKEN_API_TOKEN"),

  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),

  resendApiKey: () => required("RESEND_API_KEY"),
  reminderFromEmail: () => optional("REMINDER_FROM_EMAIL") ?? "varsel@notisen.no",

  cronSecret: () => required("CRON_SECRET"),
};
