/**
 * Liten Fiken API-klient (https://api.fiken.no/api/v2).
 *
 * Autentisering: personlig API-nøkkel sendt som `Authorization: Bearer <token>`.
 * Lag nøkkelen i Fiken: Rediger konto -> Sikkerhet -> Personlige API-nøkler.
 *
 * Denne modulen kjører kun på serveren (API-routes, cron, server actions).
 * Token-en skal ALDRI eksponeres mot nettleseren.
 */

const BASE_URL = "https://api.fiken.no/api/v2";

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
  supplier?: boolean;
  customer?: boolean;
};

export type FikenPurchase = {
  purchaseId: number;
  date: string;
  kind: string;
  supplierId?: number;
  lines?: unknown[];
  paid?: boolean;
};

export class FikenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "FikenError";
  }
}

export class FikenClient {
  constructor(private readonly token: string) {
    if (!token) throw new Error("FikenClient: mangler API-token");
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
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      // Fiken-data endrer seg sjelden i løpet av sekunder – la Next cache kort.
      next: { revalidate: 60 },
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

  /** Alle selskaper token-en har tilgang til. */
  companies() {
    return this.getAll<FikenCompany>("/companies");
  }

  /** Leverandører for ett selskap. */
  suppliers(companySlug: string) {
    return this.getAll<FikenContact>(`/companies/${companySlug}/contacts`, {
      supplier: true,
    });
  }

  /** Alle kjøp/bilag for ett selskap (brukes til å utlede gjentakende bilag). */
  purchases(companySlug: string) {
    return this.getAll<FikenPurchase>(`/companies/${companySlug}/purchases`);
  }
}
