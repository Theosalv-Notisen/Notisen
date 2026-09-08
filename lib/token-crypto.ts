/**
 * Kryptering av Fiken OAuth-tokens før de lagres i Supabase.
 *
 * INGEN `import "server-only"`: testscriptet importerer denne via `node`.
 * Importerer kun `./env.ts` – ikke `next/*`, ikke Supabase.
 *
 * Format på lagret verdi:
 *   v1:<base64url(iv)>:<base64url(tag)>:<base64url(ciphertext)>
 * base64url er uten padding og uten `:` / `+` / `/`, så skilletegnet kan aldri
 * kollidere med innholdet.
 *
 * `decryptToken` er tolerant: en verdi uten `v1:`-prefiks returneres uendret,
 * så den ene klartekst-raden i prod (og selve deploy-vinduet) fortsetter å virke.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.ts";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "v1:";

/**
 * Feil under dekryptering: feil `TOKEN_ENC_KEY`, tuklet data eller ødelagt
 * format. Dette er en drift-/konfigfeil – ikke noe brukeren fikser med en ny
 * Fiken-tilkobling – derfor en EGEN klasse (ikke `FikenReauthRequiredError`).
 */
export class TokenDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptError";
  }
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/** Krypterer en klartekst-streng. Returnerer alltid en `v1:`-streng. */
export function encryptToken(plaintext: string): string {
  const key = env.tokenEncKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    toBase64Url(iv),
    toBase64Url(tag),
    toBase64Url(ciphertext),
  ].join(":");
}

/**
 * Dekrypterer en lagret verdi.
 * - Uten `v1:`-prefiks: returneres uendret (tolerant lesing – bakoverkomp).
 * - Med prefiks: dekrypteres; alle feil kastes som `TokenDecryptError`.
 */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new TokenDecryptError("Ugyldig format på kryptert token.");
  }

  const [, ivB64, tagB64, ctB64] = parts;

  try {
    const key = env.tokenEncKey();
    const iv = fromBase64Url(ivB64);
    const tag = fromBase64Url(tagB64);
    const ciphertext = fromBase64Url(ctB64);

    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
      throw new Error("Feil lengde på IV eller auth tag.");
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new TokenDecryptError(
      `Klarte ikke dekryptere token: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
