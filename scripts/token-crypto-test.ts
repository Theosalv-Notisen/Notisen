/**
 * Ren enhetstest av lib/token-crypto.ts. Ingen nett, ingen DB.
 *
 * Kjør:  npm run token-crypto:test
 *
 * Setter en egen tilfeldig TOKEN_ENC_KEY FØR modulen importeres (dynamisk
 * import under), så scriptet kjører uten .env. Samme PASS/FAIL-stil som
 * scripts/deadline-test.ts.
 */

import { randomBytes } from "node:crypto";

// MÅ settes før token-crypto.ts tas i bruk – env.tokenEncKey() leser miljøet
// (lazy, per kall). Dynamisk import under garanterer rekkefølgen.
const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
process.env.TOKEN_ENC_KEY = KEY_A;

const { encryptToken, decryptToken, TokenDecryptError } = await import(
  "../lib/token-crypto.ts"
);

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  const suffix = !ok && detail ? ` – ${detail}` : "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${suffix}`);
  if (!ok) failures++;
}

function throwsTokenDecryptError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof TokenDecryptError;
  }
}

// ── Round-trip for ulike klartekster ────────────────────────────────
const samples: Array<[string, string]> = [
  ["opakt access token", "aB3kf9-XyZ_1234567890.abcdefghij"],
  ["refresh token", "rt_9f8e7d6c5b4a3210-ZZZ"],
  ["tom streng", ""],
  ["unicode", "æøå ÆØÅ 日本語 🔑 — naïve"],
  ["lang streng", "x".repeat(4096)],
];

for (const [name, plaintext] of samples) {
  const encrypted = encryptToken(plaintext);
  check(
    `Round-trip (${name}) – dekryptert == original`,
    decryptToken(encrypted) === plaintext,
  );
  check(
    `Round-trip (${name}) – kryptert har v1:-prefiks`,
    encrypted.startsWith("v1:"),
    encrypted.slice(0, 12),
  );
}

// ── Ikke-deterministisk (tilfeldig IV), men begge dekrypterer likt ──
{
  const plaintext = "samme-input-to-ganger";
  const a = encryptToken(plaintext);
  const b = encryptToken(plaintext);
  check("encryptToken(x) !== encryptToken(x) (tilfeldig IV)", a !== b, `${a}\n${b}`);
  check(
    "begge chiffertekstene dekrypterer til x",
    decryptToken(a) === plaintext && decryptToken(b) === plaintext,
  );
}

// ── Tolerant lesing: klartekst uten prefiks returneres uendret ──────
check(
  'decryptToken("uten-prefiks") returnerer uendret',
  decryptToken("uten-prefiks") === "uten-prefiks",
);
check(
  "decryptToken(klartekst-token) returnerer uendret",
  decryptToken("aB3kf9-XyZ_1234567890") === "aB3kf9-XyZ_1234567890",
);
check('decryptToken("") returnerer ""', decryptToken("") === "");

// ── Feil nøkkel → TokenDecryptError ────────────────────────────────
{
  const encrypted = encryptToken("hemmelig-token");
  process.env.TOKEN_ENC_KEY = KEY_B;
  check(
    "feil nøkkel → TokenDecryptError",
    throwsTokenDecryptError(() => decryptToken(encrypted)),
  );
  process.env.TOKEN_ENC_KEY = KEY_A;
  check(
    "riktig nøkkel igjen → dekrypterer fint",
    decryptToken(encrypted) === "hemmelig-token",
  );
}

// ── Tuklet ciphertext / tag → TokenDecryptError ────────────────────
{
  const encrypted = encryptToken("token-som-skal-tukles");
  const parts = encrypted.split(":");

  // Tukl med FØRSTE tegn: det koder alltid 6 hele bits av byte 0, så endringen
  // slår alltid gjennom i de dekodede bytene. (Siste tegn i et base64url-segment
  // kan kode en delvis byte – å endre det kan bli en no-op.)
  const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

  const tamperedCt = [parts[0], parts[1], parts[2], flip(parts[3])].join(":");
  check(
    "tuklet ciphertext → TokenDecryptError",
    throwsTokenDecryptError(() => decryptToken(tamperedCt)),
  );

  const tamperedTag = [parts[0], parts[1], flip(parts[2]), parts[3]].join(":");
  check(
    "tuklet auth tag → TokenDecryptError",
    throwsTokenDecryptError(() => decryptToken(tamperedTag)),
  );
}

// ── Malformert struktur → TokenDecryptError ────────────────────────
check(
  'malformert "v1:bare-en-del" → TokenDecryptError',
  throwsTokenDecryptError(() => decryptToken("v1:bare-en-del")),
);
check(
  'malformert "v1:a:b:c:d" (for mange deler) → TokenDecryptError',
  throwsTokenDecryptError(() => decryptToken("v1:a:b:c:d")),
);
check(
  'malformert "v1:!!!:@@@:###" (ugyldig base64url-lengder) → TokenDecryptError',
  throwsTokenDecryptError(() => decryptToken("v1:!!!:@@@:###")),
);

console.log(
  `\n${failures === 0 ? "ALLE TESTER OK" : `${failures} TEST(ER) FEILET`}`,
);
process.exit(failures === 0 ? 0 : 1);
