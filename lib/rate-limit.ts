/**
 * Rate limiting for auth-endepunktene (innlogging, registrering, passordreset).
 *
 * Backend: Upstash Redis via `@upstash/ratelimit` (sliding window) – det
 * etablerte mønsteret for Next.js/Vercel. Er `UPSTASH_REDIS_REST_URL` /
 * `_TOKEN` ikke satt, er rate limiting DEAKTIVERT (alt slipper gjennom) og
 * appen virker som før.
 *
 * To sjekker per handling: én per IP (bred – distribuert gjetting fra én kilde)
 * og én per identifikator/e-post (målrettet mot én konto).
 *
 * Kun server-side (`headers()` fra next/headers).
 */

import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";
import { env } from "./env.ts";
import {
  pickClientIp,
  RATE_LIMIT_RULES,
  type RateLimitAction,
} from "./rate-limit-rules.ts";

export { RATE_LIMIT_RULES, type RateLimitAction };

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = env.upstashRedisUrl();
  const token = env.upstashRedisToken();
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

const limiterCache = new Map<string, Ratelimit>();

function getLimiter(action: RateLimitAction, scope: "ip" | "id"): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cacheKey = `${action}:${scope}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    const [limit, window] = RATE_LIMIT_RULES[action][scope];
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        limit,
        window as Parameters<typeof Ratelimit.slidingWindow>[1],
      ),
      prefix: `rl:${cacheKey}`,
      analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

/** Klient-IP fra Vercel-headerne, eller "unknown" (lokalt / bak proxy uten header). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

/**
 * Sjekker rate limit for `action`. `identifier` = e-post e.l. (valgfri – uten
 * den kjøres kun IP-sjekken). Returnerer `{ allowed: false }` når enten
 * IP- eller identifikator-grensen er nådd.
 *
 * Feiler Redis, eller er den ikke satt opp → `{ allowed: true }`: rate limiting
 * skal aldri i seg selv låse ekte brukere ute.
 */
export async function rateLimit(
  action: RateLimitAction,
  identifier?: string | null,
): Promise<{ allowed: boolean }> {
  const ipLimiter = getLimiter(action, "ip");
  const idLimiter = getLimiter(action, "id");
  if (!ipLimiter && !idLimiter) return { allowed: true };

  const id = identifier?.trim().toLowerCase() || null;

  try {
    const results = await Promise.all([
      ipLimiter ? ipLimiter.limit(await clientIp()) : Promise.resolve({ success: true }),
      idLimiter && id ? idLimiter.limit(id) : Promise.resolve({ success: true }),
    ]);
    return { allowed: results.every((r) => r.success) };
  } catch (err) {
    console.error("Rate limit-sjekk feilet – slipper forespørselen gjennom:", err);
    return { allowed: true };
  }
}
