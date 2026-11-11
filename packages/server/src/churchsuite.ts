import {
  CHURCHSUITE_API_URL,
  CHURCHSUITE_CLIENT_ID,
  CHURCHSUITE_CLIENT_SECRET,
  CHURCHSUITE_REDIRECT_URI,
  CHURCHSUITE_SCOPES,
  CHURCHSUITE_TOKEN_URL,
} from "./config.js";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

let cached: { token: string; expiresAt: number } | null = null;

function configured(): boolean {
  return Boolean(CHURCHSUITE_CLIENT_ID && CHURCHSUITE_CLIENT_SECRET);
}

function redact(message: string): string {
  return message.replace(/https?:\/\/[^@\s/]+@/g, "https://***@");
}

async function tokenRequest(): Promise<string> {
  if (!configured()) {
    throw new Error(
      "ChurchSuite is not configured. Set WLM_CHURCHSUITE_CLIENT_ID and WLM_CHURCHSUITE_CLIENT_SECRET.",
    );
  }
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: CHURCHSUITE_SCOPES,
  });
  const response = await fetch(CHURCHSUITE_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(
        `${CHURCHSUITE_CLIENT_ID}:${CHURCHSUITE_CLIENT_SECRET}`,
      ).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || response.statusText;
    if (data.error === "unauthorized_client") {
      throw new Error(
        "ChurchSuite rejected the client_credentials grant. These look like OAuth App credentials; " +
          "use an API-enabled user's identifier/secret, or configure the authorization-code flow.",
      );
    }
    throw new Error(`ChurchSuite OAuth ${response.status}: ${redact(detail)}`);
  }
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

async function api<T>(
  path: string,
  query?: Record<string, string | number | string[] | undefined>,
): Promise<T> {
  const token = await tokenRequest();
  const url = new URL(`${CHURCHSUITE_API_URL.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ChurchSuite ${response.status}: ${redact(text.slice(0, 600))}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function churchsuiteStatus(): {
  configured: boolean;
  tokenUrl: string;
  apiUrl: string;
  scopes: string;
  redirectUri: string;
  hasCachedToken: boolean;
} {
  return {
    configured: configured(),
    tokenUrl: CHURCHSUITE_TOKEN_URL,
    apiUrl: CHURCHSUITE_API_URL,
    scopes: CHURCHSUITE_SCOPES,
    redirectUri: CHURCHSUITE_REDIRECT_URI,
    hasCachedToken: Boolean(cached),
  };
}

export async function testChurchsuite(): Promise<{ ok: true; plans: unknown }> {
  const plans = await api("/planning/plans", { per_page: 1 });
  return { ok: true, plans };
}

export async function getChurchsuitePlan(planId: number): Promise<unknown> {
  const result = await api<{ data: unknown }>(`/planning/plans/${planId}`);
  return result.data;
}

interface ChurchsuiteType {
  id: number;
  name: string;
  ccli_tracking?: boolean;
}

let cachedTypes: { at: number; values: ChurchsuiteType[] } | null = null;

export async function listChurchsuiteTypes(): Promise<ChurchsuiteType[]> {
  if (cachedTypes && Date.now() - cachedTypes.at < 5 * 60 * 1000) {
    return cachedTypes.values;
  }
  const result = await api<{ data: ChurchsuiteType[] }>("/planning/types", {
    per_page: 250,
  });
  cachedTypes = { at: Date.now(), values: result.data ?? [] };
  return cachedTypes.values;
}

export async function listChurchsuitePlans(query: {
  from?: string;
  to?: string;
  status?: string;
}): Promise<unknown> {
  return api("/planning/plans", {
    starts_after: query.from,
    starts_before: query.to,
    status: query.status ?? "published",
    per_page: 100,
    order_by: "date:asc",
  });
}

export async function listChurchsuitePlanItems(planIds: number[]): Promise<unknown> {
  return api("/planning/plan_items", {
    "plan_ids[]": planIds.map(String),
    order_by: "order:asc",
    per_page: 250,
  });
}
