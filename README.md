# Shopify Multi-Store MCP

A read-only MCP (Model Context Protocol) server that connects to multiple Shopify
stores at once and queries each store's Admin GraphQL API directly. No headless
browser, no third-party services — one set of app credentials per store.

## Features

- **`list_stores`** — list configured stores (name, domain, currency, status).
- **`query_store`** — run a read-only GraphQL query against one store.
- **`query_all_stores`** — run the same query in parallel across all active stores
  and get the results keyed by store name.

Read-only by design: the app uses `read_*` scopes only, and `query_store` rejects
any query containing `mutation`.

## Requirements

- Node.js 18+ (uses the built-in `fetch`).
- A custom app created in the Shopify **Dev Dashboard** for each store.

---

## 1. Create an app per store — step by step

This is done **once per store** — 9 apps for 9 stores. Each app is tied to its
own store and gets its own Client ID and Client secret.

### Step 1 — Open the Dev Dashboard

In the store's Shopify admin (e.g. `livsstilskompaniet.myshopify.com/admin`):

1. Click **Settings** (gear icon, bottom-left).
2. Click **Apps and sales channels** in the left sidebar.
3. Click the **Develop apps** button near the top of the page.
   - If prompted with a warning about enabling custom app development, click
     **Allow custom app development** to proceed.
4. Click **Build apps in Dev Dashboard** — this opens the Dev Dashboard in a new tab.

### Step 2 — Create a new app

1. Click **Create an app** (top-right).
2. Enter a name, e.g. `multi-store-mcp` (you can use the same name in every store).
3. Click **Create**.

### Step 3 — Configure scopes

1. In the left sidebar, click **Access**.
2. Under **Admin API integration**, click **Configure**.
3. There are two scope fields — paste each list into the matching field:

**Omfattningar** (required scopes):
```
read_products,read_orders,read_all_orders,read_customers,read_inventory,read_locations,read_fulfillments,read_draft_orders,read_discounts,read_price_rules,read_returns
```

**Valfria omfattningar** (optional scopes):
```
read_reports,read_analytics,read_gift_cards,read_shipping,read_checkouts,read_content,read_themes,read_publications,read_marketing_events,read_payment_terms
```

> **`read_all_orders`** — this scope requires a merchant acknowledgment step.
> When you enable it, Shopify will show an extra confirmation screen explaining
> that the app will have access to your complete order history. Accept it.
> Without this scope, orders older than 60 days are hidden from GraphQL queries.

4. Click **Save** after selecting all scopes.

### Step 4 — Release the app

1. Click **Release** (top-right corner).
2. Confirm the release. This makes the app installable on the store.

### Step 5 — Install the app on the store

1. After releasing, you'll be redirected to the store admin.
2. A prompt will appear to **Install** the app — click **Install**.
3. Review the permissions summary and confirm.

### Step 6 — Copy the credentials

1. Go back to the Dev Dashboard tab.
2. In the left sidebar, click **Credentials** (sometimes listed under **Overview**).
3. Copy the **Client ID** and **Client secret**.
   - The Client secret is only shown once — copy it now and store it securely.
   - If you lose it, you can rotate (regenerate) it from the same page.

**Repeat steps 1–6 for each store.**

---

## 2. Configure

Copy the example config and fill in the credentials:

```bash
cp stores.config.example.json stores.config.json
```

For each store set:
- `domain` — the store's `*.myshopify.com` handle, **not** the public .se/.store
  domain. Find it in the store admin → Settings → Domains.
- `currency` — `SEK` or `DKK`.
- `status` — `active` (included in `query_all_stores` by default) or `paused`
  (skipped unless explicitly named).
- `clientId` + `clientSecret` — from Step 6 above.

The server exchanges these for an access token via the client credentials grant,
caches it in memory, and refreshes automatically before the ~24h expiry. You never
paste a raw token.

```json
{
  "apiVersion": "2026-04",
  "stores": [
    { "name": "ABC", "domain": "abc123-f.myshopify.com", "currency": "SEK", "status": "active", "clientId": "...", "clientSecret": "..." },
    { "name": "DEF", "domain": "def456-g.myshopify.com", "currency": "SEK", "status": "active", "clientId": "...", "clientSecret": "..." }
  ]
}
```

> **Legacy store?** If a store still has an admin-created app from before 2026 with
> a static `shpat_` token, replace `clientId`/`clientSecret` with
> `"token": "shpat_..."`. The server uses whichever credentials are present.

`stores.config.json` is gitignored. It holds your Client secrets, which can mint
tokens — keep it private and never commit it.

---

## 3. Install & run

```bash
npm install
npm start
```

---

## 4. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). Use absolute paths:

```json
{
  "mcpServers": {
    "shopify-multistore": {
      "command": "/absolute/path/to/mcp-shopify-multi-store/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/mcp-shopify-multi-store/src/index.ts"],
      "env": {
        "STORES_CONFIG": "/absolute/path/to/stores.config.json",
        "SHOPIFY_API_VERSION": "2026-04"
      }
    }
  }
}
```

Restart Claude Desktop. The three tools appear under the `shopify-multistore` server.

---

## Tool reference

### `list_stores`
No input. Returns all configured stores (credentials are never included).

### `query_store`
```jsonc
{
  "store": "My Store",
  "query": "query { shop { name currencyCode } }"
}
```

### `query_all_stores`
Runs the same query across all active stores in parallel and returns
`{ [storeName]: <raw response> }`. Example — 5 most recent orders per store:

```graphql
query RecentOrders {
  orders(first: 5, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        name
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
}
```

---

## Notes

- **Tokens auto-refresh.** Access tokens from the client credentials grant last ~24h;
  the server caches and renews them per store.
- **Rate limits are per store/token**, so fanning out across all stores in parallel
  is safe and fast. Concurrency is capped at 5, with automatic backoff/retry on
  throttling.
- **Currencies differ** (SEK vs DKK). `query_all_stores` keeps stores separated —
  never sum amounts across stores without grouping by currency first.
- **`read_all_orders`** must be enabled per store (Step 3) to query orders older than
  60 days. Without it, the API silently returns only the last 60 days.
- **Paused stores** are skipped by default in `query_all_stores`; pass an explicit
  `stores` list to include them.
- **Read-only.** To add write capability later, add `write_*` scopes and dedicated
  write tools — the current setup intentionally cannot modify anything.
