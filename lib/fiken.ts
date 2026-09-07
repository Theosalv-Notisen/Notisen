/**
 * Liten Fiken API-klient (https://api.fiken.no/api/v2).
 *
 * Autentisering: OAuth2 access token sendt som `Authorization: Bearer <token>`.
 * Tokenet hentes fra en `fiken_connection`-rad (se lib/fiken-connection.ts),
 * ikke fra en miljøvariabel – Notisen skal kunne kobles til andre bedrifters
 * Fiken-konto.
 *
 * Kjører kun på server (route handlers, cron, scripts).
 */

const BASE_URL = "https://api.fiken.no/api/v2";

/** Enten et fast token, eller en funksjon som gir et (evt. nylig refresh-et). */
export type TokenSource = string | (() => Promise<string>);

export type FikenCompany = {
  name: string;
  slug: string;
  organizationNumber?: string;
};

export type FikenContact = {
  contactId: number;
  name: string;
  email?: string;
  organizationNumber?: string;
  supplierNumber?: number;
  customerNumber?: number;
};

export type FikenOrderLine = {
  lineId?: number;
  description?: string;
  /** Nettobeløp i øre (4500 = 45,00). */
  netPrice?: number;
  /** MVA i øre. */
  vat?: number;
  account?: string;
  vatType?: string;
};

export type FikenPurchase = {
  purchaseId: number;
  transactionId?: number;
  identifier?: string;
  /** Betalingsdato, yyyy-mm-dd. */
  date: string;
  kind: "cash_purchase" | "supplier" | string;
  paid: boolean;
  deleted?: boolean;
  settled?: boolean;
  currency: string;
  lines: FikenOrderLine[];
  supplier?: FikenContact;
};

export class FikenError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "FikenError";
    this.status = status;
    this.body = body;
  }
}

export class FikenClient {
  private readonly token: TokenSource;

  constructor(token: TokenSource) {
    this.token = token;
  }

  private async authHeader(): Promise<string> {
    const t = typeof this.token === "function" ? await this.token() : this.token;
    if (!t) throw new Error("FikenClient: mangler access token");
    return `Bearer ${t}`;
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<{ data: T; pageCount: number }> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: {
        Authorization: await this.authHeader(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new FikenError(
        `Fiken svarte ${res.status} for ${url.pathname}`,
        res.status,
        body,
      );
    }

    return {
      data: (await res.json()) as T,
      pageCount: Number(res.headers.get("Fiken-Api-Page-Count") ?? "1"),
    };
  }

  private async getAll<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T[]> {
    const pageSize = 100;
    const first = await this.get<T[]>(path, { ...params, page: 0, pageSize });
    let all = first.data;
    for (let page = 1; page < first.pageCount; page++) {
      const next = await this.get<T[]>(path, { ...params, page, pageSize });
      all = all.concat(next.data);
    }
    return all;
  }

  /** Alle selskaper tokenet har tilgang til. */
  companies() {
    return this.getAll<FikenCompany>("/companies");
  }

  /** Leverandører for ett selskap. */
  suppliers(companySlug: string) {
    return this.getAll<FikenContact>(`/companies/${companySlug}/contacts`, {
      supplier: true,
    });
  }

  /**
   * Alle kjøp/bilag for ett selskap.
   *
   * `paid`-parameteren i Fiken er litt lumsk: uten den får man kun bilag som
   * ikke er fullt oppgjort. Vi henter derfor både betalte og ubetalte og slår
   * sammen på purchaseId.
   */
  async purchases(companySlug: string): Promise<FikenPurchase[]> {
    const path = `/companies/${companySlug}/purchases`;
    const [paid, unpaid] = await Promise.all([
      this.getAll<FikenPurchase>(path, { paid: true, sortBy: "date asc" }),
      this.getAll<FikenPurchase>(path, { paid: false, sortBy: "date asc" }),
    ]);

    const byId = new Map<number, FikenPurchase>();
    for (const p of [...paid, ...unpaid]) {
      if (!p.deleted) byId.set(p.purchaseId, p);
    }
    return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

/** Sum av et bilag i kroner (netto + mva over alle linjer). */
export function purchaseTotalNok(purchase: FikenPurchase): number {
  const ore = purchase.lines.reduce(
    (sum, l) => sum + (l.netPrice ?? 0) + (l.vat ?? 0),
    0,
  );
  return ore / 100;
}
