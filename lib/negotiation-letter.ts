/**
 * Del 2 av forhandlingscopiloten: lag et utkast til brev/e-post brukeren kan
 * sende leverandøren selv – enten en oppsigelse eller en reforhandlings-
 * forespørsel som viser til den dokumenterte prisutviklingen fra del 1.
 *
 * Claude API brukes på samme måte som kontraktsekstraheringen. Vi sender
 * ALDRI noe på brukerens vegne – utkastet vises i et redigerbart felt.
 *
 * Prompten er ren og testbar (lib/negotiation-letter-prompt.ts). Denne fila
 * gjør selve API-kallet og er server-only.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import {
  buildLetterPrompt,
  type LetterFacts,
  type LetterKind,
} from "./negotiation-letter-prompt.ts";

export {
  buildLetterPrompt,
  letterFactLines,
  type LetterFacts,
  type LetterKind,
} from "./negotiation-letter-prompt.ts";

/** Samme modell som kontraktsekstraheringen. */
export const LETTER_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1400;

export type LetterResult = { text: string; model: string };

export async function generateNegotiationLetter(
  kind: LetterKind,
  facts: LetterFacts,
  today: string,
): Promise<LetterResult> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const { system, user } = buildLetterPrompt(kind, facts, today);

  const response = await client.messages.create({
    model: LETTER_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      `Claude ga ingen tekst tilbake (stop_reason: ${response.stop_reason}).`,
    );
  }

  return { text, model: response.model };
}
