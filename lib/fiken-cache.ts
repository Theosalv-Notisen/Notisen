/**
 * Cachet henting av Fiken-kjøp for ett selskap.
 *
 * De tunge Fiken-kallene (alle bilag) endrer seg ikke fra minutt til minutt.
 * Vi cacher dem 3 minutter per (bruker, selskap) – `token` er med som argument
 * slik at et rotert token gir cache-miss. Samme tag som Oversikt-siden, så
 * kontosletting tømmer også denne.
 *
 * Kun server-side.
 */

import "server-only";

import { unstable_cache } from "next/cache";
import { FikenClient, type FikenPurchase } from "./fiken.ts";
import { fikenDataTag } from "./cache-tags.ts";

export function loadCompanyPurchases(userId: string) {
  return unstable_cache(
    async (token: string, companySlug: string): Promise<FikenPurchase[]> => {
      const client = new FikenClient(token);
      return client.purchases(companySlug);
    },
    ["fiken-company-purchases", userId],
    { revalidate: 180, tags: [fikenDataTag(userId)] },
  );
}
