import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface StoreConfig {
  name: string;
  domain: string;
  currency: string;
  status: "active" | "paused";
  token?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface Config {
  apiVersion: string;
  stores: StoreConfig[];
}

function parseStore(raw: unknown, index: number): StoreConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`stores[${index}] must be an object`);
  }
  const s = raw as Record<string, unknown>;

  if (typeof s.name !== "string" || !s.name)
    throw new Error(`stores[${index}]: "name" is required`);
  if (typeof s.domain !== "string" || !s.domain)
    throw new Error(`stores[${index}] "${s.name}": "domain" is required`);
  if (typeof s.currency !== "string" || !s.currency)
    throw new Error(`stores[${index}] "${s.name}": "currency" is required`);
  if (s.status !== "active" && s.status !== "paused")
    throw new Error(
      `stores[${index}] "${s.name}": "status" must be "active" or "paused"`
    );

  const hasToken = typeof s.token === "string" && s.token.length > 0;
  const hasCreds =
    typeof s.clientId === "string" && typeof s.clientSecret === "string";
  if (!hasToken && !hasCreds) {
    throw new Error(
      `stores[${index}] "${s.name}": must have "token" or both "clientId" and "clientSecret"`
    );
  }

  return {
    name: s.name,
    domain: s.domain,
    currency: s.currency,
    status: s.status as "active" | "paused",
    ...(typeof s.token === "string" ? { token: s.token } : {}),
    ...(typeof s.clientId === "string" ? { clientId: s.clientId } : {}),
    ...(typeof s.clientSecret === "string"
      ? { clientSecret: s.clientSecret }
      : {}),
  };
}

export function loadConfig(): Config {
  const configPath = resolve(
    process.env.STORES_CONFIG ?? "./stores.config.json"
  );

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (cause) {
    throw new Error(`Cannot read config from "${configPath}": ${cause}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("Config must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.stores)) {
    throw new Error('Config: "stores" must be an array');
  }

  const apiVersion =
    process.env.SHOPIFY_API_VERSION ??
    (typeof r.apiVersion === "string" ? r.apiVersion : "2026-04");

  return {
    apiVersion,
    stores: r.stores.map((s, i) => parseStore(s, i)),
  };
}
