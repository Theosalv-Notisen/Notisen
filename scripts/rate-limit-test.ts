/**
 * Test av de rene delene i lib/rate-limit-rules.ts. Ingen nettverk / Redis.
 *
 * Kjør:  npm run rate-limit:test
 *
 * (Selve limiting-en krever Upstash Redis og testes manuelt i prod – se
 * oppsummeringen. Er UPSTASH_* ikke satt, er rate limiting deaktivert.)
 */

import {
  isValidDuration,
  pickClientIp,
  RATE_LIMIT_RULES,
  type RateLimitAction,
} from "../lib/rate-limit-rules.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` – ${detail}` : ""}`);
  if (!ok) failures++;
}

// Alle regel-vinduer må være gyldige Upstash Duration-strenger, og
// id-grensen må være strengere enn (eller lik) ip-grensen for antall.
for (const action of Object.keys(RATE_LIMIT_RULES) as RateLimitAction[]) {
  const r = RATE_LIMIT_RULES[action];
  check(
    `${action}: ip-vindu «${r.ip[1]}» er gyldig Duration`,
    isValidDuration(r.ip[1]),
  );
  check(
    `${action}: id-vindu «${r.id[1]}» er gyldig Duration`,
    isValidDuration(r.id[1]),
  );
  check(
    `${action}: id-grense (${r.id[0]}) <= ip-grense (${r.ip[0]})`,
    r.id[0] <= r.ip[0],
  );
  check(`${action}: begge grenser > 0`, r.ip[0] > 0 && r.id[0] > 0);
}

check("isValidDuration avviser tull", !isValidDuration("10 minutter") && !isValidDuration("abc"));

// pickClientIp
check(
  "pickClientIp: første adresse i x-forwarded-for",
  pickClientIp("203.0.113.7, 70.41.3.18, 150.172.238.178", null) === "203.0.113.7",
);
check(
  "pickClientIp: trimmer whitespace",
  pickClientIp("  198.51.100.4  ", null) === "198.51.100.4",
);
check(
  "pickClientIp: faller til x-real-ip",
  pickClientIp(null, "192.0.2.44") === "192.0.2.44",
);
check(
  "pickClientIp: «unknown» når begge mangler",
  pickClientIp(null, null) === "unknown" &&
    pickClientIp("", "") === "unknown" &&
    pickClientIp(undefined, undefined) === "unknown",
);

console.log(failures === 0 ? "\nALLE TESTER OK" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
