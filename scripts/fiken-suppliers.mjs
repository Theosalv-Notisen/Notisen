/**
 * Frittstående test av Fiken-tilkoblingen.
 *
 * Bruk:
 *   1. Legg FIKEN_API_TOKEN inn i .env.local
 *   2. Kjør:  npm run fiken:suppliers
 *
 * Scriptet:
 *   - henter alle selskaper (companies) token-en har tilgang til
 *   - henter leverandørene (contacts?supplier=true) for hvert selskap
 *   - skriver ut en enkel tabell
 *
 * Ingen avhengigheter, bruker global fetch (Node 20+).
 */

const BASE_URL = "https://api.fiken.no/api/v2";
const token = process.env.FIKEN_API_TOKEN;

if (!token) {
  console.error(
    "\n  Mangler FIKEN_API_TOKEN.\n" +
      "  Lag en personlig API-nøkkel i Fiken:\n" +
      "  Rediger konto -> Sikkerhet -> Personlige API-nøkler\n" +
      "  og legg den i .env.local som:  FIKEN_API_TOKEN=...\n",
  );
  process.exit(1);
}

/** Hent én side fra Fiken, med feilhåndtering. */
async function fikenGet(path, params = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Fiken svarte ${res.status} ${res.statusText} for ${url.pathname}\n${body}`,
    );
  }

  const pageCount = Number(res.headers.get("Fiken-Api-Page-Count") ?? "1");
  return { data: await res.json(), pageCount };
}

/** Hent alle sider for en liste-endepunkt. */
async function fikenGetAll(path, params = {}) {
  const pageSize = 100;
  const first = await fikenGet(path, { ...params, page: 0, pageSize });
  let all = first.data;
  for (let page = 1; page < first.pageCount; page++) {
    const next = await fikenGet(path, { ...params, page, pageSize });
    all = all.concat(next.data);
  }
  return all;
}

async function main() {
  console.log("Kobler til Fiken ...\n");

  const companies = await fikenGetAll("/companies");
  if (companies.length === 0) {
    console.log("Fant ingen selskaper for denne nøkkelen.");
    return;
  }

  for (const company of companies) {
    console.log(`\n=== ${company.name}  (slug: ${company.slug}) ===`);

    const suppliers = await fikenGetAll(
      `/companies/${company.slug}/contacts`,
      { supplier: true },
    );

    if (suppliers.length === 0) {
      console.log("  (ingen leverandører registrert)");
      continue;
    }

    console.log(`  ${suppliers.length} leverandører:\n`);
    for (const s of suppliers) {
      const org = s.organizationNumber ? ` · org ${s.organizationNumber}` : "";
      const email = s.email ? ` · ${s.email}` : "";
      console.log(`  - [${s.contactId}] ${s.name}${org}${email}`);
    }
  }

  console.log("\nFerdig. Tilkoblingen fungerer.\n");
}

main().catch((err) => {
  console.error("\nFEIL:", err.message, "\n");
  process.exit(1);
});
