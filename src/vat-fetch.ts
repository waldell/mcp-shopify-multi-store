/**
 * Network fetch layer for the VAT / payout underlag.
 *
 * This is the ONLY place in the feature that talks to Shopify. It reuses the
 * existing throttle-aware, OAuth/token-aware `queryStore` client (src/shopify.ts)
 * for every page, and mirrors the repo's existing concurrency-5 fan-out for the
 * cross-store sweep. It produces plain-data (string) shapes consumed by the pure
 * lib (src/lib/vat-underlag) — no math, no Decimal, no clock here.
 *
 * queryStore (not queryAllStores) is reused because cursor pagination needs many
 * calls per store; queryAllStores issues a single query per store. queryStore is
 * the reusable unit that carries auth + exponential backoff on THROTTLED.
 */
import type { StoreConfig } from "./config.js";
import { queryStore, type ShopifyResponse } from "./shopify.js";
import type {
  RawOrder,
  RawPayout,
  StoreOrderData,
  StorePayoutData,
} from "./lib/vat-underlag/types.js";

const CONCURRENCY = 5;
const MAX_PAGES = 1000; // safety backstop against a runaway cursor loop

// ---------------------------------------------------------------------------
// GraphQL documents (validated against the live Admin schema, API 2026-04)
// ---------------------------------------------------------------------------

const ORDERS_QUERY = `
query VatOrders($cursor: String, $q: String!) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      test
      displayFinancialStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      shippingAddress { countryCodeV2 }
      billingAddress { countryCodeV2 }
    }
  }
}`;

const PAYOUTS_QUERY = `
query VatPayouts($cursor: String, $q: String!) {
  shopifyPaymentsAccount {
    id
    payouts(first: 100, after: $cursor, query: $q, sortKey: ISSUED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        issuedAt
        status
        net { amount currencyCode }
        summary {
          chargesGross { amount }
          chargesFee { amount }
          refundsFeeGross { amount }
          refundsFee { amount }
          adjustmentsGross { amount }
          adjustmentsFee { amount }
          reservedFundsGross { amount }
          reservedFundsFee { amount }
          retriedPayoutsGross { amount }
          retriedPayoutsFee { amount }
        }
      }
    }
  }
}`;

const BALANCE_TX_QUERY = `
query VatBalanceTx($cursor: String, $q: String!) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 100, after: $cursor, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        type
        test
        amount { amount currencyCode }
        fee { amount }
        net { amount }
        sourceType
        adjustmentReason
        associatedOrder { id name }
        associatedPayout { id }
      }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

function money(node: unknown): string {
  const m = node as { amount?: string } | null | undefined;
  return m?.amount ?? "0";
}

function assertNoErrors(resp: ShopifyResponse, store: string, what: string): void {
  if (resp.errors) {
    throw new Error(
      `${store}: GraphQL error fetching ${what}: ${JSON.stringify(resp.errors)}`
    );
  }
}

/** Run per-store async fetchers with the repo's concurrency-5 chunking. */
export async function mapStoresConcurrently<T>(
  stores: StoreConfig[],
  fn: (store: StoreConfig) => Promise<T>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < stores.length; i += CONCURRENCY) {
    const chunk = stores.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(chunk.map((s) => fn(s)));
    out.push(...settled);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orders → sales/VAT side
// ---------------------------------------------------------------------------

export async function fetchStoreOrders(
  store: StoreConfig,
  apiVersion: string,
  start: string,
  end: string
): Promise<StoreOrderData> {
  const q = `created_at:>=${start} created_at:<=${end}`;
  const orders: RawOrder[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp: ShopifyResponse = await queryStore(store, apiVersion, ORDERS_QUERY, {
      cursor,
      q,
    });
    assertNoErrors(resp, store.name, "orders");
    const conn = (resp.data as { orders?: { nodes?: unknown[]; pageInfo?: PageInfo } })
      ?.orders;
    const nodes = (conn?.nodes ?? []) as Array<Record<string, any>>;

    for (const n of nodes) {
      if (n.test === true) continue; // filter test orders out
      const shipC = n.shippingAddress?.countryCodeV2 ?? null;
      const billC = n.billingAddress?.countryCodeV2 ?? null;
      orders.push({
        id: n.id,
        name: n.name,
        createdAt: n.createdAt,
        test: !!n.test,
        displayFinancialStatus: n.displayFinancialStatus ?? null,
        totalPrice: money(n.totalPriceSet?.shopMoney),
        currency: n.totalPriceSet?.shopMoney?.currencyCode ?? store.currency,
        totalTax: money(n.totalTaxSet?.shopMoney),
        totalRefunded: money(n.totalRefundedSet?.shopMoney),
        shipCountry: shipC ?? billC ?? null,
      });
    }

    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage || !pi.endCursor) break;
    cursor = pi.endCursor;
  }

  return { store: store.name, storeDomain: store.domain, orders };
}

// ---------------------------------------------------------------------------
// Payouts → bank/fee side (null shopifyPaymentsAccount handled gracefully)
// ---------------------------------------------------------------------------

export async function fetchStorePayouts(
  store: StoreConfig,
  apiVersion: string,
  start: string,
  end: string
): Promise<StorePayoutData> {
  const q = `issued_at:>=${start} issued_at:<=${end}`;
  const payouts: RawPayout[] = [];
  let cursor: string | null = null;
  let hasAccount = true;

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp: ShopifyResponse = await queryStore(store, apiVersion, PAYOUTS_QUERY, {
      cursor,
      q,
    });
    assertNoErrors(resp, store.name, "payouts");
    const account = (resp.data as { shopifyPaymentsAccount?: unknown | null })
      ?.shopifyPaymentsAccount;

    // Null account → store has no Shopify Payments (e.g. paused). Do NOT throw;
    // report it so the fan-out survives and the accountant sees the gap.
    if (account === null || account === undefined) {
      hasAccount = false;
      break;
    }

    const conn = (account as { payouts?: { nodes?: unknown[]; pageInfo?: PageInfo } })
      .payouts;
    const nodes = (conn?.nodes ?? []) as Array<Record<string, any>>;
    for (const n of nodes) {
      const s = n.summary ?? {};
      payouts.push({
        id: n.id,
        issuedAt: n.issuedAt,
        status: n.status,
        net: money(n.net),
        currency: n.net?.currencyCode ?? store.currency,
        summary: {
          chargesGross: money(s.chargesGross),
          chargesFee: money(s.chargesFee),
          refundsFeeGross: money(s.refundsFeeGross),
          refundsFee: money(s.refundsFee),
          adjustmentsGross: money(s.adjustmentsGross),
          adjustmentsFee: money(s.adjustmentsFee),
          reservedFundsGross: money(s.reservedFundsGross),
          reservedFundsFee: money(s.reservedFundsFee),
          retriedPayoutsGross: money(s.retriedPayoutsGross),
          retriedPayoutsFee: money(s.retriedPayoutsFee),
        },
      });
    }

    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage || !pi.endCursor) break;
    cursor = pi.endCursor;
  }

  return {
    store: store.name,
    storeDomain: store.domain,
    hasPaymentsAccount: hasAccount,
    payouts,
  };
}

/**
 * Optional per-payout balance-transaction detail (audit trail). Not needed for
 * the summary underlag; exposed behind a flag.
 *
 * NOTE: the balanceTransactions connection does not document a `payout_id`
 * filter term (its filters are payout_date / payments_transfer_id / ...), so we
 * filter by `payout_date` and then keep only the transactions whose
 * associatedPayout matches — a robust bridge regardless of filter naming.
 */
export async function fetchStoreBalanceTransactions(
  store: StoreConfig,
  apiVersion: string,
  payoutId: string,
  payoutDate: string
): Promise<Array<Record<string, unknown>>> {
  const q = `payout_date:${payoutDate}`;
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp: ShopifyResponse = await queryStore(
      store,
      apiVersion,
      BALANCE_TX_QUERY,
      { cursor, q }
    );
    assertNoErrors(resp, store.name, "balanceTransactions");
    const account = (resp.data as { shopifyPaymentsAccount?: unknown | null })
      ?.shopifyPaymentsAccount;
    if (account === null || account === undefined) break;

    const conn = (
      account as { balanceTransactions?: { nodes?: unknown[]; pageInfo?: PageInfo } }
    ).balanceTransactions;
    const nodes = (conn?.nodes ?? []) as Array<Record<string, any>>;
    for (const n of nodes) {
      if (n.associatedPayout?.id !== payoutId) continue;
      rows.push({
        id: n.id,
        type: n.type,
        test: !!n.test,
        amount: money(n.amount),
        currency: n.amount?.currencyCode ?? store.currency,
        fee: money(n.fee),
        net: money(n.net),
        sourceType: n.sourceType ?? null,
        adjustmentReason: n.adjustmentReason ?? null,
        associatedOrder: n.associatedOrder
          ? { id: n.associatedOrder.id, name: n.associatedOrder.name }
          : null,
        associatedPayoutId: n.associatedPayout?.id ?? null,
      });
    }

    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage || !pi.endCursor) break;
    cursor = pi.endCursor;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Cross-store fan-out (mirrors the repo's concurrency-5 pattern)
// ---------------------------------------------------------------------------

export function fetchOrdersAllStores(
  stores: StoreConfig[],
  apiVersion: string,
  start: string,
  end: string
): Promise<StoreOrderData[]> {
  return mapStoresConcurrently(stores, (s) =>
    fetchStoreOrders(s, apiVersion, start, end)
  );
}

export function fetchPayoutsAllStores(
  stores: StoreConfig[],
  apiVersion: string,
  start: string,
  end: string
): Promise<StorePayoutData[]> {
  return mapStoresConcurrently(stores, (s) =>
    fetchStorePayouts(s, apiVersion, start, end)
  );
}

const PAYMENTS_PROBE_QUERY = `query VatPaymentsProbe { shopifyPaymentsAccount { id } }`;

/**
 * Cheaply detect which stores have NO Shopify Payments account (null), for the
 * VAT report notes. One tiny query per store; a scope/permission error is
 * treated as "unknown" (store omitted from the list) rather than crashing.
 */
export async function probeStoresWithoutPayments(
  stores: StoreConfig[],
  apiVersion: string
): Promise<string[]> {
  const results = await mapStoresConcurrently(stores, async (s) => {
    try {
      const resp = await queryStore(s, apiVersion, PAYMENTS_PROBE_QUERY, {});
      const account = (resp.data as { shopifyPaymentsAccount?: unknown | null })
        ?.shopifyPaymentsAccount;
      return { store: s.name, missing: account === null || account === undefined };
    } catch {
      return { store: s.name, missing: false };
    }
  });
  return results.filter((r) => r.missing).map((r) => r.store);
}
