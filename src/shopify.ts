import type { StoreConfig } from "./config.js";

export interface ShopifyResponse {
  data?: unknown;
  errors?: unknown;
  extensions?: unknown;
}

// Token cache for optional OAuth client credentials flow
interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, TokenCache>();

async function getAccessToken(store: StoreConfig): Promise<string> {
  if (store.token) return store.token;

  if (!store.clientId || !store.clientSecret) {
    throw new Error(
      `Store "${store.name}": no token or client credentials configured`
    );
  }

  const cached = tokenCache.get(store.name);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const res = await fetch(
    `https://${store.domain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: store.clientId,
        client_secret: store.clientSecret,
        grant_type: "client_credentials",
      }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Token exchange for "${store.name}" failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  const ttl = (data.expires_in ?? 86400) * 1000;
  tokenCache.set(store.name, {
    token: data.access_token,
    expiresAt: Date.now() + ttl,
  });
  return data.access_token;
}

function isThrottled(resp: ShopifyResponse): boolean {
  if (Array.isArray(resp.errors)) {
    const errs = resp.errors as Array<{ extensions?: { code?: string } }>;
    if (errs.some((e) => e.extensions?.code === "THROTTLED")) return true;
  }
  const ext = resp.extensions as
    | {
        cost?: {
          throttleStatus?: {
            currentlyAvailable?: number;
            maximumAvailable?: number;
          };
        };
      }
    | undefined;
  const ts = ext?.cost?.throttleStatus;
  if (ts?.currentlyAvailable !== undefined && ts.maximumAvailable !== undefined) {
    return ts.currentlyAvailable < ts.maximumAvailable * 0.1;
  }
  return false;
}

async function queryOnce(
  store: StoreConfig,
  apiVersion: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<ShopifyResponse> {
  const token = await getAccessToken(store);
  const res = await fetch(
    `https://${store.domain}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return res.json() as Promise<ShopifyResponse>;
}

export async function queryStore(
  store: StoreConfig,
  apiVersion: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<ShopifyResponse> {
  const MAX_ATTEMPTS = 3;
  let delay = 1000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const resp = await queryOnce(store, apiVersion, query, variables);
    if (!isThrottled(resp) || attempt === MAX_ATTEMPTS - 1) return resp;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }

  // unreachable — satisfies TypeScript control flow
  return queryOnce(store, apiVersion, query, variables);
}

export async function queryAllStores(
  stores: StoreConfig[],
  apiVersion: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<Record<string, ShopifyResponse | { error: string }>> {
  const CONCURRENCY = 5;
  const results: Record<string, ShopifyResponse | { error: string }> = {};

  for (let i = 0; i < stores.length; i += CONCURRENCY) {
    const chunk = stores.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (store) => {
        try {
          return {
            name: store.name,
            result: await queryStore(store, apiVersion, query, variables),
          };
        } catch (e) {
          return { name: store.name, result: { error: String(e) } };
        }
      })
    );
    for (const { name, result } of settled) results[name] = result;
  }

  return results;
}
