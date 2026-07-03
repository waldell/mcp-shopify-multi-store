import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, type StoreConfig } from "./config.js";
import { queryStore, queryAllStores } from "./shopify.js";
import {
  fetchOrdersAllStores,
  fetchPayoutsAllStores,
  probeStoresWithoutPayments,
} from "./vat-fetch.js";
import {
  buildVatReport,
  buildReconciliationReport,
  parseBankCsv,
  vatReportToCsv,
  totalsByCurrencyToCsv,
  reconciledToCsv,
  attGranskaToCsv,
} from "./lib/vat-underlag/index.js";
import {
  writeVatArtifacts,
  writeReconciliationArtifacts,
} from "./vat-artifacts.js";

const config = loadConfig();

/** Resolve a tool's target stores: named list, or all active by default. */
function resolveTargets(storeNames?: string[]): StoreConfig[] {
  if (storeNames && storeNames.length > 0) {
    return config.stores.filter((s) => storeNames.includes(s.name));
  }
  return config.stores.filter((s) => s.status === "active");
}

const server = new McpServer({
  name: "shopify-multi-store",
  version: "1.0.0",
});

server.registerTool(
  "list_stores",
  {
    description:
      "List all configured Shopify stores. Returns name, domain, currency, and status. Never returns tokens.",
  },
  async () => {
    const stores = config.stores.map(({ name, domain, currency, status }) => ({
      name,
      domain,
      currency,
      status,
    }));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(stores, null, 2) }],
    };
  }
);

server.registerTool(
  "query_store",
  {
    description:
      "Run a read-only GraphQL query against a single Shopify store. Mutations are rejected.",
    inputSchema: {
      store: z.string().describe("Store name (as returned by list_stores)"),
      query: z.string().describe("GraphQL query string — mutations are rejected"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe("Optional GraphQL variables"),
    },
  },
  async ({ store: storeName, query, variables }) => {
    if (/\bmutation\b/i.test(query)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Mutations are not allowed. Only read queries are permitted.",
          },
        ],
      };
    }

    const store = config.stores.find((s) => s.name === storeName);
    if (!store) {
      const available = config.stores.map((s) => s.name).join(", ");
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Unknown store "${storeName}". Available stores: ${available}`,
          },
        ],
      };
    }

    try {
      const result = await queryStore(
        store,
        config.apiVersion,
        query,
        variables as Record<string, unknown> | undefined
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error querying store "${storeName}": ${e}`,
          },
        ],
      };
    }
  }
);

server.registerTool(
  "query_all_stores",
  {
    description:
      "Run the same read-only GraphQL query in parallel across multiple Shopify stores. Returns an object keyed by store name. Each store's result is independent — one failure does not affect others.",
    inputSchema: {
      query: z
        .string()
        .describe("GraphQL query string — mutations are rejected"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe("Optional GraphQL variables"),
      stores: z
        .array(z.string())
        .optional()
        .describe(
          "Store names to query. Defaults to all stores with status 'active'."
        ),
    },
  },
  async ({ query, variables, stores: storeNames }) => {
    if (/\bmutation\b/i.test(query)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Mutations are not allowed. Only read queries are permitted.",
          },
        ],
      };
    }

    let targets = config.stores.filter((s) => s.status === "active");

    if (storeNames && storeNames.length > 0) {
      const unknown = storeNames.filter(
        (n) => !config.stores.some((s) => s.name === n)
      );
      if (unknown.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Unknown store(s): ${unknown.join(", ")}. Available: ${config.stores.map((s) => s.name).join(", ")}`,
            },
          ],
        };
      }
      targets = config.stores.filter((s) => storeNames.includes(s.name));
    }

    const results = await queryAllStores(
      targets,
      config.apiVersion,
      query,
      variables as Record<string, unknown> | undefined
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ---------------------------------------------------------------------------
// VAT / payout reconciliation underlag (thin wrappers over the fan-out + pure lib)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_vat_underlag",
  {
    description:
      "Build the deterministic VAT underlag for a period. Fetches all orders per " +
      "store (paginated, test orders excluded) and aggregates by (store, shipCountry, " +
      "currency). Every row carries BOTH vatCharged (actual, 0 here) AND " +
      "computedVatIfLiable (VAT-inclusive, computed openly) — it never hides VAT and " +
      "never emits a single 'momsfri' total. Amounts are decimal strings; totals are " +
      "grouped by currency and never summed across currencies. Pass outDir to also write " +
      "the same JSON + CSV files the CLI produces.",
    inputSchema: {
      start: z.string().describe("Period start, inclusive (YYYY-MM-DD)"),
      end: z.string().describe("Period end, inclusive (YYYY-MM-DD)"),
      stores: z
        .array(z.string())
        .optional()
        .describe("Store names to include. Defaults to all active stores."),
      outDir: z
        .string()
        .optional()
        .describe(
          "Absolute directory to write the JSON + CSV artifacts to (same files as the CLI). Omit to only return them inline."
        ),
      decimalComma: z
        .boolean()
        .optional()
        .describe("Emit Swedish comma decimals in CSV (delimiter → ';'). Default false."),
      generatedAt: z
        .string()
        .optional()
        .describe("Fix the generatedAt stamp (ISO) for reproducible output. Default: now."),
    },
  },
  async ({ start, end, stores: storeNames, outDir, decimalComma, generatedAt }) => {
    try {
      const targets = resolveTargets(storeNames);
      const [orderData, storesWithoutPayments] = await Promise.all([
        fetchOrdersAllStores(targets, config.apiVersion, start, end),
        probeStoresWithoutPayments(targets, config.apiVersion),
      ]);
      const report = buildVatReport({
        generatedAt: generatedAt ?? new Date().toISOString(),
        period: { start, end },
        orderData,
        storesWithoutPayments,
      });
      const csvOpts = { decimalComma: decimalComma ?? false };
      const written = outDir ? writeVatArtifacts(outDir, report, csvOpts) : [];
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(report, null, 2) },
          {
            type: "text" as const,
            text:
              "=== vat-underlag.csv ===\n" +
              vatReportToCsv(report, csvOpts) +
              "\n=== vat-underlag_totals.csv ===\n" +
              totalsByCurrencyToCsv(report.totalsByCurrency, csvOpts),
          },
          {
            type: "text" as const,
            text: written.length
              ? `Wrote files:\n${written.join("\n")}`
              : "No outDir given — returned inline only (no files written).",
          },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `get_vat_underlag failed: ${e}` }],
      };
    }
  }
);

server.registerTool(
  "get_payout_reconciliation",
  {
    description:
      "Reconcile a Nordea bank-export CSV against Shopify payouts for a period. " +
      "Matches on GROUPS (currency, date, net amount at full öre) not identity: " +
      "N-vs-N counts reconcile (duplicates included), count mismatches go to an " +
      "att_granska review list. Never matches across currencies. Null " +
      "shopifyPaymentsAccount stores are skipped and noted, never crash the fan-out. " +
      "Pass outDir to also write the same JSON + CSV files the CLI produces.",
    inputSchema: {
      start: z.string().describe("Period start, inclusive (YYYY-MM-DD)"),
      end: z.string().describe("Period end, inclusive (YYYY-MM-DD)"),
      bankCsvPath: z
        .string()
        .describe("Absolute path to the bank-export CSV (Nordea rows)"),
      bankCurrency: z
        .string()
        .optional()
        .describe("Currency for bank rows without a currency column. Default SEK."),
      timezone: z
        .string()
        .optional()
        .describe("IANA TZ for date matching. Default Europe/Stockholm."),
      stores: z
        .array(z.string())
        .optional()
        .describe("Store names to include. Defaults to all active stores."),
      outDir: z
        .string()
        .optional()
        .describe(
          "Absolute directory to write the JSON + CSV artifacts to (same files as the CLI). Omit to only return them inline."
        ),
      decimalComma: z
        .boolean()
        .optional()
        .describe("Emit Swedish comma decimals in CSV (delimiter → ';'). Default false."),
      generatedAt: z
        .string()
        .optional()
        .describe("Fix the generatedAt stamp (ISO) for reproducible output. Default: now."),
    },
  },
  async ({
    start,
    end,
    bankCsvPath,
    bankCurrency,
    timezone,
    stores: storeNames,
    outDir,
    decimalComma,
    generatedAt,
  }) => {
    try {
      const targets = resolveTargets(storeNames);
      const csvText = readFileSync(bankCsvPath, "utf-8");
      const bankRows = parseBankCsv(csvText, {
        defaultCurrency: bankCurrency ?? "SEK",
      });
      const payoutData = await fetchPayoutsAllStores(
        targets,
        config.apiVersion,
        start,
        end
      );
      const report = buildReconciliationReport({
        generatedAt: generatedAt ?? new Date().toISOString(),
        period: { start, end },
        payoutData,
        bankRows,
        timezone,
      });
      const csvOpts = { decimalComma: decimalComma ?? false };
      const written = outDir
        ? writeReconciliationArtifacts(outDir, report, csvOpts)
        : [];
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(report, null, 2) },
          {
            type: "text" as const,
            text:
              "=== payout-reconciled.csv ===\n" +
              reconciledToCsv(report, csvOpts) +
              "\n=== payout-att-granska.csv ===\n" +
              attGranskaToCsv(report, csvOpts),
          },
          {
            type: "text" as const,
            text: written.length
              ? `Wrote files:\n${written.join("\n")}`
              : "No outDir given — returned inline only (no files written).",
          },
        ],
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text" as const, text: `get_payout_reconciliation failed: ${e}` },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
