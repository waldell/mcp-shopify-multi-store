#!/usr/bin/env tsx
/**
 * VAT / payout reconciliation underlag CLI — the artifact you run for the
 * accountant handoff and commit to git.
 *
 * REPRODUCIBLE: identical inputs → byte-identical output files. `generatedAt` is
 * injectable via --generated-at so committed output is stable in review; omit it
 * and the current time is stamped once at the boundary (never inside the lib).
 *
 * Usage:
 *   npm run vat-underlag -- --start 2026-04-01 --end 2026-06-30 [options]
 *
 * Options:
 *   --start <YYYY-MM-DD>     Period start, inclusive          (required)
 *   --end <YYYY-MM-DD>       Period end, inclusive            (required)
 *   --out <dir>              Output directory (default ./underlag)
 *   --stores <a,b,c>         Comma-separated store names (default: all active)
 *   --bank <path>           Bank-export CSV → also run payout reconciliation
 *   --bank-currency <CCY>    Currency for bank rows w/o a currency column (SEK)
 *   --timezone <IANA>        TZ for date matching (Europe/Stockholm)
 *   --decimal-comma          Emit Swedish comma decimals (CSV delimiter → ';')
 *   --generated-at <ISO>     Fix the generatedAt stamp (for reproducible output)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type StoreConfig } from "../src/config.js";
import {
  fetchOrdersAllStores,
  fetchPayoutsAllStores,
  probeStoresWithoutPayments,
} from "../src/vat-fetch.js";
import {
  buildVatReport,
  buildReconciliationReport,
  parseBankCsv,
} from "../src/lib/vat-underlag/index.js";
import {
  writeVatArtifacts,
  writeReconciliationArtifacts,
} from "../src/vat-artifacts.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = args.start as string;
  const end = args.end as string;
  if (!start || !end) die("--start and --end (YYYY-MM-DD) are required");

  const outDir = resolve((args.out as string) ?? "./underlag");
  const decimalComma = args["decimal-comma"] === true;
  const csvOpts = { decimalComma };
  const generatedAt =
    (args["generated-at"] as string) ?? new Date().toISOString();

  const config = loadConfig();
  let targets: StoreConfig[];
  if (typeof args.stores === "string") {
    const names = args.stores.split(",").map((s) => s.trim()).filter(Boolean);
    targets = config.stores.filter((s) => names.includes(s.name));
    const missing = names.filter((n) => !config.stores.some((s) => s.name === n));
    if (missing.length) die(`unknown store(s): ${missing.join(", ")}`);
  } else {
    targets = config.stores.filter((s) => s.status === "active");
  }
  if (targets.length === 0) die("no target stores resolved");

  // --- VAT underlag ---
  console.error(
    `Fetching orders for ${targets.length} store(s): ${targets
      .map((s) => s.name)
      .join(", ")} …`
  );
  const [orderData, storesWithoutPayments] = await Promise.all([
    fetchOrdersAllStores(targets, config.apiVersion, start, end),
    probeStoresWithoutPayments(targets, config.apiVersion),
  ]);

  const vatReport = buildVatReport({
    generatedAt,
    period: { start, end },
    orderData,
    storesWithoutPayments,
  });

  writeVatArtifacts(outDir, vatReport, csvOpts);

  // --- Payout reconciliation (optional) ---
  if (typeof args.bank === "string") {
    const bankPath = resolve(args.bank);
    console.error(`Reconciling against bank export ${bankPath} …`);
    const bankRows = parseBankCsv(readFileSync(bankPath, "utf-8"), {
      defaultCurrency: (args["bank-currency"] as string) ?? "SEK",
    });
    const payoutData = await fetchPayoutsAllStores(
      targets,
      config.apiVersion,
      start,
      end
    );
    const reconReport = buildReconciliationReport({
      generatedAt,
      period: { start, end },
      payoutData,
      bankRows,
      timezone: (args.timezone as string) ?? undefined,
    });
    writeReconciliationArtifacts(outDir, reconReport, csvOpts);
  }

  // --- Console summary (netSales per currency to tie to konto 3010) ---
  console.error("\n=== VAT underlag summary ===");
  for (const t of vatReport.totalsByCurrency) {
    console.error(
      `  ${t.currency}: orders=${t.orderCount}  netSales=${t.netSales}  ` +
        `vatCharged=${t.vatCharged}  computedVatIfLiable=${t.computedVatIfLiable}`
    );
  }
  for (const n of vatReport.notes) console.error(`  note: ${n}`);
  console.error(`\nWrote artifacts to ${outDir}`);
}

main().catch((e) => die(String(e)));
