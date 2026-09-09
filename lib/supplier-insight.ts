/**
 * Del 1 av forhandlingscopiloten: innsikt fra kundens EGNE Fiken-data.
 *
 * Tar alle kjøp for ett Fiken-selskap + hvilken leverandør vi ser på, og regner
 * ut tre ting – utelukkende fra tallene som faktisk ligger i regnskapet:
 *
 *   1. Prisutvikling: har beløpet per transaksjon økt over tid?
 *   2. Mulig overlapp: dekker andre leverandører samme regnskapskonto?
 *   3. Årlig forbruk: hvor mye går til denne leverandøren siste 12 mnd, og hvor
 *      stor andel av de samlede leverandørkostnadene det er.
 *
 * INGEN fabrikerte bransjetall. Alt her er kundens egne, etterprøvbare tall.
 *
 * Ren funksjon – ingen nettverk, ingen `Date.now()`. `today` ('ÅÅÅÅ-MM-DD')
 * sendes inn så logikken kan testes tabelldrevet.
 */

import { purchaseTotalNok, type FikenPurchase } from "./fiken.ts";

/** Minste antall transaksjoner før vi sier noe om prisutvikling. */
const MIN_TX_FOR_TREND = 4;
/** Historikken må spenne minst så mange dager for en meningsfull trend. */
const MIN_TREND_SPAN_DAYS = 180;
/** Mindre endring enn dette regnes som støy og vises ikke. */
const MIN_TREND_PCT = 5;
/** Prisøkning fra og med dette flagges tydelig i UI-et. */
export const NOTABLE_INCREASE_PCT = 10;
/** Innenfor hver halvdel: relativt standardavvik over dette = for ustabilt til å tallfeste. */
const MAX_GROUP_SPREAD = 0.35;
/** En leverandør må ha minst så mange kjøp for å telle som «overlappende avtale». */
const MIN_TX_FOR_OVERLAP = 2;

/**
 * Vanlige kontoer i norsk standard kontoplan. Kun for å gjøre en overlapp
 * lesbar («Programvare/IT-tjenester» i stedet for «konto 6552»). Ikke bransjetall.
 */
const ACCOUNT_LABELS: Record<string, string> = {
  "6300": "Leie av lokale",
  "6310": "Leasing av lokale",
  "6340": "Lys og varme",
  "6360": "Renhold",
  "6395": "Renovasjon, vann, avløp",
  "6420": "Leie datasystemer",
  "6440": "Leie transportmidler",
  "6490": "Annen leiekostnad",
  "6540": "Inventar",
  "6550": "Driftsmateriell",
  "6552": "Programvare / IT-tjenester",
  "6553": "Programvare årlig vedlikehold",
  "6560": "Rekvisita",
  "6590": "Annet driftsmateriell",
  "6700": "Revisjons- og regnskapshonorar",
  "6720": "Honorar for økonomisk rådgivning",
  "6790": "Annen fremmed tjeneste",
  "6800": "Kontorrekvisita",
  "6840": "Aviser, tidsskrifter, bøker",
  "6860": "Møter, kurs, oppdatering",
  "6900": "Telefon",
  "6907": "Datakommunikasjon",
  "6940": "Porto",
  "7040": "Forsikring transportmidler",
  "7500": "Forsikringspremie",
  "7770": "Bank- og kortgebyr",
  "7790": "Annen kostnad",
};

export function categoryLabel(account: string | null): string | null {
  if (!account) return null;
  return ACCOUNT_LABELS[account] ?? `Konto ${account}`;
}

export type PriceTrend = {
  /** Prosentvis endring i typisk transaksjonsbeløp. +18 = 18 % dyrere. */
  changePct: number;
  earlierMedianNok: number;
  recentMedianNok: number;
  /** Datoen for den eldste transaksjonen i sammenligningen. */
  since: string;
  /** Datoen for den nyeste transaksjonen i sammenligningen. */
  until: string;
};

export type SpendShare = {
  /** Sum til denne leverandøren siste 12 mnd. */
  supplierAnnualNok: number;
  /** Sum til alle leverandører siste 12 mnd. */
  totalAnnualNok: number;
  /** Andel av samlede leverandørkostnader, i prosent. */
  sharePct: number;
};

export type OverlapMatch = {
  fikenContactId: number;
  supplierName: string;
  /** Regnskapskontoen begge leverandørene i hovedsak føres på. */
  account: string;
  categoryLabel: string;
};

export type SupplierInsight = {
  fikenContactId: number;
  supplierName: string;
  transactionCount: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  dominantAccount: string | null;
  dominantCategoryLabel: string | null;
  priceTrend: PriceTrend | null;
  spend: SpendShare | null;
  overlaps: OverlapMatch[];
  /** true hvis vi ikke fant noen kjøp for leverandøren i det hele tatt. */
  noData: boolean;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Relativt standardavvik (variasjonskoeffisient). 0 = helt likt hver gang. */
function relativeSpread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (m === 0) return Infinity;
  const variance =
    xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance) / Math.abs(m);
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Kontoen med størst beløp på ett bilag (leverandørens «kategori» for kjøpet). */
function dominantAccountOfPurchase(p: FikenPurchase): string | null {
  let best: { account: string; abs: number } | null = null;
  for (const line of p.lines ?? []) {
    const account = line.account?.trim();
    if (!account) continue;
    const abs = Math.abs((line.netPrice ?? 0) + (line.vat ?? 0));
    if (!best || abs > best.abs) best = { account, abs };
  }
  return best?.account ?? null;
}

/** Mest brukte konto på tvers av en leverandørs bilag. Eksportert – også brukt
 * av `lib/recurring.ts` for benchmark-kategorisering (del 3). */
export function dominantFikenAccount(
  purchases: FikenPurchase[],
): string | null {
  const counts = new Map<string, number>();
  for (const p of purchases) {
    const a = dominantAccountOfPurchase(p);
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best: { account: string; n: number } | null = null;
  for (const [account, n] of counts) {
    if (!best || n > best.n) best = { account, n };
  }
  return best?.account ?? null;
}

type PricePoint = { date: string; amountNok: number };

function computePriceTrend(points: PricePoint[]): PriceTrend | null {
  const positive = points
    .filter((p) => p.amountNok > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (positive.length < MIN_TX_FOR_TREND) return null;
  const span = daysBetween(
    positive[0].date,
    positive[positive.length - 1].date,
  );
  if (span < MIN_TREND_SPAN_DAYS) return null;

  // Sammenlign den eldste og den nyeste tredjedelen (min. 2 i hver).
  const groupSize = Math.max(2, Math.floor(positive.length / 3));
  const earlier = positive.slice(0, groupSize);
  const recent = positive.slice(positive.length - groupSize);

  const earlierAmounts = earlier.map((p) => p.amountNok);
  const recentAmounts = recent.map((p) => p.amountNok);

  // Er beløpene innad i en gruppe sprikende (forbruksbasert fakturering e.l.),
  // blir en enkelt prosentendring misvisende – da sier vi heller ingenting.
  if (
    relativeSpread(earlierAmounts) > MAX_GROUP_SPREAD ||
    relativeSpread(recentAmounts) > MAX_GROUP_SPREAD
  ) {
    return null;
  }

  const earlierMedian = median(earlierAmounts);
  const recentMedian = median(recentAmounts);
  if (earlierMedian <= 0) return null;

  const changePct = ((recentMedian - earlierMedian) / earlierMedian) * 100;
  if (Math.abs(changePct) < MIN_TREND_PCT) return null;

  return {
    changePct: Math.round(changePct),
    earlierMedianNok: Math.round(earlierMedian),
    recentMedianNok: Math.round(recentMedian),
    since: earlier[earlier.length - 1].date,
    until: recent[recent.length - 1].date,
  };
}

export function computeSupplierInsight(
  allPurchases: FikenPurchase[],
  targetContactId: number,
  today: string,
): SupplierInsight {
  // Gruppér alle bilag på leverandør (contactId).
  const bySupplier = new Map<
    number,
    { name: string; purchases: FikenPurchase[] }
  >();
  for (const p of allPurchases) {
    const id = p.supplier?.contactId;
    if (!id) continue;
    const g = bySupplier.get(id) ?? {
      name: p.supplier?.name ?? "Ukjent leverandør",
      purchases: [],
    };
    g.purchases.push(p);
    bySupplier.set(id, g);
  }

  const target = bySupplier.get(targetContactId);
  const targetPurchases = target?.purchases ?? [];

  const base: SupplierInsight = {
    fikenContactId: targetContactId,
    supplierName: target?.name ?? "Ukjent leverandør",
    transactionCount: targetPurchases.length,
    firstPurchaseDate: null,
    lastPurchaseDate: null,
    dominantAccount: null,
    dominantCategoryLabel: null,
    priceTrend: null,
    spend: null,
    overlaps: [],
    noData: targetPurchases.length === 0,
  };
  if (targetPurchases.length === 0) return base;

  const sorted = [...targetPurchases].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  base.firstPurchaseDate = sorted[0].date;
  base.lastPurchaseDate = sorted[sorted.length - 1].date;

  // ── 1. Prisutvikling ──────────────────────────────────────────────
  base.priceTrend = computePriceTrend(
    sorted.map((p) => ({ date: p.date, amountNok: purchaseTotalNok(p) })),
  );

  // ── 2. Kategori + mulig overlapp ──────────────────────────────────
  const dominantAccount = dominantFikenAccount(targetPurchases);
  base.dominantAccount = dominantAccount;
  base.dominantCategoryLabel = categoryLabel(dominantAccount);

  if (dominantAccount) {
    for (const [contactId, g] of bySupplier) {
      if (contactId === targetContactId) continue;
      if (g.purchases.length < MIN_TX_FOR_OVERLAP) continue;
      if (dominantFikenAccount(g.purchases) !== dominantAccount) continue;
      base.overlaps.push({
        fikenContactId: contactId,
        supplierName: g.name,
        account: dominantAccount,
        categoryLabel: categoryLabel(dominantAccount) ?? `Konto ${dominantAccount}`,
      });
    }
    base.overlaps.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }

  // ── 3. Årlig forbruk + andel ──────────────────────────────────────
  const since = addDaysIso(today, -365);
  const annualFor = (purchases: FikenPurchase[]) =>
    purchases
      .filter((p) => p.date >= since && p.date <= today)
      .reduce((sum, p) => sum + Math.max(0, purchaseTotalNok(p)), 0);

  const supplierAnnual = annualFor(targetPurchases);
  let totalAnnual = 0;
  for (const g of bySupplier.values()) totalAnnual += annualFor(g.purchases);

  if (supplierAnnual > 0 && totalAnnual > 0) {
    base.spend = {
      supplierAnnualNok: Math.round(supplierAnnual),
      totalAnnualNok: Math.round(totalAnnual),
      sharePct: Math.round((supplierAnnual / totalAnnual) * 100),
    };
  }

  return base;
}
