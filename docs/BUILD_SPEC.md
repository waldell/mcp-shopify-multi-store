# Task: Build a multi-store Shopify MCP server

Build a complete MCP server (Model Context Protocol) in **Node.js + TypeScript** that
exposes tools for reading data from multiple Shopify stores at once, going directly
against each store's Admin GraphQL API.

## Tech stack
- Node.js (LTS) + TypeScript (strict mode)
- Official `@modelcontextprotocol/sdk`
- Transport: stdio (`StdioServerTransport`)
- HTTP via built-in `fetch` (Node 18+) — NO headless browser needed. We go
  directly against each store's Admin GraphQL endpoint.
- Admin API version: `2026-01` (configurable via env `SHOPIFY_API_VERSION`).

## Core idea: one router across multiple stores, one token per store
Each store has its own Admin API access token. The server reads a config with all
stores at startup and routes each call to the correct store's endpoint:
`https://{shop}.myshopify.com/admin/api/{version}/graphql.json`
with the header `X-Shopify-Access-Token: {token}`.

Because the rate limit (GraphQL cost / leaky bucket) applies PER store/token, the
same query can be run in parallel across all stores without sharing a budget — that
is exactly what makes multi-store fast.

Example of the central logic:
```ts
async function queryStore(
  store: StoreConfig,
  query: string,
  variables?: Record<string, unknown>
) {
  const res = await fetch(
    `https://${store.domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": store.token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return res.json(); // raw response (data / errors / extensions) — do NOT interpret the fields
}
```

## MCP tools
Expose three generic tools (keep them raw, in the same spirit as YunTrack — return
Shopify's JSON unchanged, add no interpretation):

1. `list_stores`
   - **Input:** none.
   - **Output:** list of configured stores with `name`, `domain`, `currency`,
     `status`. NEVER return the token in the output.

2. `query_store`
   - **Input:** `store: string` (store name), `query: string` (GraphQL),
     `variables?: object`.
   - Read-only: reject any query containing the keyword `mutation` with a clear error.
   - **Output:** raw JSON from that store.

3. `query_all_stores`
   - **Input:** `query: string`, `variables?: object`, `stores?: string[]`
     (default: all stores with `status: "active"`).
   - Run the same query in parallel against the selected stores (limited concurrency, max 5).
   - **Output:** an object `{ [storeName]: <raw response or error object> }`.

Optional (but keep the core generic): you may add convenience tools such as
`sales_summary` and `inventory_levels` built on top of `query_all_stores`.
NOTE: the stores use different currencies (SEK/DKK) — such tools must NOT sum
blindly across currencies; group by currency or keep the stores separated.

## Performance & lifecycle
- Lightweight — no browser, just `fetch`.
- Read and validate config ONCE at startup; cache it in memory.
- `query_all_stores`: parallel, but cap concurrency at 5 to be polite.
- Handle Shopify GraphQL throttling: if the response contains `THROTTLED` in
  `errors`, or `extensions.cost.throttleStatus` shows low `currentlyAvailable` →
  back off and retry (exponential, max 3 attempts) per store.

## Error handling
- Unknown store name → clear error.
- `query_all_stores`: an error in ONE store must not fail the whole batch — catch
  the error per store and return it in that store's slot.
- Stores with `status != "active"` are skipped by default in `query_all_stores`.
- GraphQL `errors` / `userErrors` are passed back raw.
- Network errors are caught and returned as an MCP error; the server must not crash.

## Project structure & deliverables
- `package.json` with scripts: `build` (tsc), `start`, `dev`.
- `tsconfig.json` (strict, NodeNext/ESM).
- `src/index.ts` — MCP server + tool registration.
- `src/shopify.ts` — GraphQL client + router (`queryStore`, `queryAllStores`).
- `src/config.ts` — read & validate the store config (path via env `STORES_CONFIG`,
  default `./stores.config.json`).
- `stores.config.example.json` — example config (see below).
- `.gitignore` — ignore `stores.config.json` (it contains secret tokens).
- `README.md` covering: how to create a custom app + access token per store
  (Settings → Apps → Develop apps, scopes `read_orders, read_products,
  read_customers, read_inventory`), how to fill in the config, how to run, and an
  example `claude_desktop_config.json` pointing at the built server.

### stores.config.example.json
`domain` MUST be the store's `*.myshopify.com` handle (not the public .se/.store domain).
Verify each handle in admin → Settings → Domains.
```json
{
  "apiVersion": "2026-01",
  "stores": [
    { "name": "Hello",  "domain": "5nmsdf-2.myshopify.com", "currency": "SEK", "status": "active", "token": "shpat_..." },
    { "name": "Hella",  "domain": "an33dg-1.myshopify.com", "currency": "SEK", "status": "active", "token": "shpat_..." },
  ]
}
```

## Deliver
Complete, runnable code for all files above. No placeholders in the code (the config
example excepted). It should run with `npm install && npm run build && npm start`
directly.

## Optional optimization
Since January 1, 2026, new Shopify apps are created with OAuth client credentials
instead of static `shpat_` tokens. Static tokens (from existing custom apps) are the
simplest and still work — use them as the default. As an optional optimization:
also support `clientId`/`clientSecret` per store in the config, exchange them for an
access token via token exchange, cache it and refresh before the ~24h expiry. Fall
back to the static `token` when only that is present.