import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { queryStore, queryAllStores } from "./shopify.js";

const config = loadConfig();

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

const transport = new StdioServerTransport();
await server.connect(transport);
