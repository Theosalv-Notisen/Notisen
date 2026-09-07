/**
 * Ende-til-ende-test av Fiken-integrasjonen – uten at resten av appen
 * (Supabase, innlogging) trenger å være satt opp.
 *
 * Kjør:  npm run fiken:test
 *
 * Gjør følgende:
 *   1. OAuth2 authorization code flow mot Fiken (åpner nettleser, lytter på
 *      redirect-URI-en lokalt, bytter code mot tokens).
 *   2. Cacher tokens i .fiken-tokens.json (git-ignorert), og refresher dem
 *      automatisk neste gang de er utløpt.
 *   3. Henter selskaper, leverandører og alle kjøp/bilag.
 *   4. Kjører gjenkjenningslogikken i lib/recurring.ts og skriver ut en rapport.
 *
 * Krever i .env.local:  FIKEN_CLIENT_ID, FIKEN_CLIENT_SECRET
 * (og evt. FIKEN_REDIRECT_URI hvis den avviker fra localhost:3000-standarden).
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { env } from "../lib/env.ts";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
  type FikenTokens,
} from "../lib/fiken-oauth.ts";
import { FikenClient } from "../lib/fiken.ts";
import { analyzeRecurring } from "../lib/recurring.ts";

const TOKEN_CACHE = new URL("../.fiken-tokens.json", import.meta.url);

const clientId = env.fikenClientId();
const clientSecret = env.fikenClientSecret();
const redirectUri = env.fikenRedirectUri();

// ─────────────────────────────────────────────────────────────
// Token-håndtering
// ─────────────────────────────────────────────────────────────

async function loadCachedTokens(): Promise<FikenTokens | null> {
  try {
    return JSON.parse(await readFile(TOKEN_CACHE, "utf8")) as FikenTokens;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: FikenTokens): Promise<void> {
  await writeFile(TOKEN_CACHE, JSON.stringify(tokens, null, 2) + "\n");
}

/** Kjør hele OAuth-flyten: åpne nettleser, fang opp redirect, bytt code. */
function runOAuthFlow(): Promise<FikenTokens> {
  const { port, pathname } = new URL(redirectUri);
  const state = randomUUID();

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== pathname) {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const returnedState = reqUrl.searchParams.get("state");
      const error = reqUrl.searchParams.get("error");

      const finish = (msg: string) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem">
          <h2>${msg}</h2><p>Du kan lukke denne fanen og gå tilbake til terminalen.</p>`);
        server.close();
      };

      if (error) {
        finish(`Fiken avviste tilgang: ${error}`);
        reject(new Error(`OAuth-feil: ${error}`));
        return;
      }
      if (!code || returnedState !== state) {
        finish("Noe gikk galt (manglende code eller feil state).");
        reject(new Error("Ugyldig callback fra Fiken"));
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens({
          code,
          clientId,
          clientSecret,
          redirectUri,
        });
        finish("Notisen er koblet til Fiken ✔");
        resolve(tokens);
      } catch (err) {
        finish("Klarte ikke bytte code mot token – se terminalen.");
        reject(err);
      }
    });

    server.on("error", reject);
    server.listen(Number(port), () => {
      const authUrl = buildAuthorizeUrl({ clientId, redirectUri, state });
      console.log("\nÅpner Fiken for godkjenning ...");
      console.log("Hvis nettleseren ikke åpner seg, lim inn denne URL-en:\n");
      console.log("  " + authUrl + "\n");
      spawn("open", [authUrl], { stdio: "ignore" }).on("error", () => {});
    });
  });
}

/** Gyldig access token – fra cache, via refresh, eller ny full flyt. */
async function getAccessToken(): Promise<string> {
  let tokens = await loadCachedTokens();

  if (tokens && tokens.expiresAt > Date.now()) return tokens.accessToken;

  if (tokens?.refreshToken) {
    try {
      console.log("Access token utløpt – henter nytt via refresh token ...");
      tokens = await refreshTokens({
        refreshToken: tokens.refreshToken,
        clientId,
        clientSecret,
      });
      await saveTokens(tokens);
      return tokens.accessToken;
    } catch (err) {
      console.log("Refresh feilet, kjører full innlogging på nytt.", err);
    }
  }

  tokens = await runOAuthFlow();
  await saveTokens(tokens);
  return tokens.accessToken;
}

// ─────────────────────────────────────────────────────────────
// Rapport
// ─────────────────────────────────────────────────────────────

const BADGE: Record<string, string> = {
  high: "●●●  SANNSYNLIG LØPENDE",
  medium: "●●○  MULIG LØPENDE",
  low: "●○○  TROLIG ENGANGS",
  none: "○○○  ENGANGS",
};

async function main() {
  const token = await getAccessToken();
  const fiken = new FikenClient(token);

  const companies = await fiken.companies();
  console.log(
    `\nTilkoblet. ${companies.length} selskap: ${companies
      .map((c) => c.name)
      .join(", ")}`,
  );

  for (const company of companies) {
    const [suppliers, purchases] = await Promise.all([
      fiken.suppliers(company.slug),
      fiken.purchases(company.slug),
    ]);

    console.log(`\n${"=".repeat(64)}`);
    console.log(`${company.name}  (${company.slug})`);
    console.log(
      `${suppliers.length} leverandører · ${purchases.length} kjøp/bilag`,
    );
    console.log("=".repeat(64));

    const analysis = analyzeRecurring(purchases);

    if (analysis.length === 0) {
      console.log("\nIngen kjøp med leverandør å analysere.");
      continue;
    }

    for (const r of analysis) {
      console.log(`\n${BADGE[r.confidence]}   ${r.supplierName}`);
      console.log(`   ${r.reason}`);
      for (const p of r.points) {
        console.log(
          `     ${p.date}   ${p.totalNok.toLocaleString("nb-NO")} kr   (#${p.purchaseId})`,
        );
      }
      if (r.gapsDays.length) {
        console.log(`   intervaller (dager): ${r.gapsDays.join(", ")}`);
      }
    }

    const flagged = analysis.filter((r) => r.isLikelyRecurring);
    console.log(`\n${"-".repeat(64)}`);
    console.log(
      `Foreslår kontraktopplasting for ${flagged.length} leverandør(er): ` +
        (flagged.map((r) => r.supplierName).join(", ") || "(ingen)"),
    );
  }
}

main().catch((err) => {
  console.error("\nFEIL:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
