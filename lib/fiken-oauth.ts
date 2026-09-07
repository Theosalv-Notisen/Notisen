/**
 * Fiken OAuth2 – authorization code flow.
 *
 * Fiken krever OAuth for integrasjoner som brukes av andre enn deg selv:
 * "Personlige API-nøkler er kun for personlig bruk. Integrasjoner som
 *  benyttes av andre må benytte OAuth."
 *
 * Docs: https://api.fiken.no/api/v2/docs  (securityScheme fiken_api_oauth)
 *   authorizationUrl: https://fiken.no/oauth/authorize
 *   tokenUrl:         https://fiken.no/oauth/token
 *   ingen scopes – tokenet får tilgang til selskapene brukeren godkjenner.
 */

export const FIKEN_AUTHORIZE_URL = "https://fiken.no/oauth/authorize";
export const FIKEN_TOKEN_URL = "https://fiken.no/oauth/token";

export type FikenTokens = {
  accessToken: string;
  refreshToken: string;
  /** Unix-ms når access token utløper (litt konservativt). */
  expiresAt: number;
};

type RawTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

/** URL brukeren sendes til for å godkjenne Notisen mot sin Fiken-konto. */
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(FIKEN_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

function basicAuth(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/** Litt margin så vi ikke bruker et token som utløper "akkurat nå". */
function toTokens(raw: RawTokenResponse): FikenTokens {
  const skewMs = 60_000;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000 - skewMs,
  };
}

async function postToken(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string,
): Promise<FikenTokens> {
  const res = await fetch(FIKEN_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Fiken token-endepunkt svarte ${res.status}: ${text}`);
  }
  return toTokens(JSON.parse(text) as RawTokenResponse);
}

/** Bytt authorization code (fra callback) mot access + refresh token. */
export function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<FikenTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  return postToken(body, params.clientId, params.clientSecret);
}

/** Hent nytt access token når det gamle er utløpt. */
export function refreshTokens(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<FikenTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  return postToken(body, params.clientId, params.clientSecret);
}
