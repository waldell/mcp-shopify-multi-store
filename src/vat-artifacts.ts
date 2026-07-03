/**
 * Shared artifact writer — turns the pure-lib reports into the exact same
 * on-disk files (JSON + CSV) regardless of whether they were produced by the CLI
 * (scripts/vat-underlag.ts) or the MCP tools (src/index.ts). Filesystem lives
 * here (server layer), never in the pure lib.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  vatReportToCsv,
  totalsByCurrencyToCsv,
  reconciledToCsv,
  attGranskaToCsv,
  type VatReport,
  type ReconciliationReport,
  type CsvOptions,
} from "./lib/vat-underlag/index.js";

function periodTag(period: { start: string; end: string }): string {
  return `${period.start}_${period.end}`;
}

/** Write the VAT underlag JSON + CSV + totals CSV. Returns the paths written. */
export function writeVatArtifacts(
  outDir: string,
  report: VatReport,
  csvOpts: CsvOptions = {}
): string[] {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const tag = periodTag(report.period);

  const files: Array<[string, string]> = [
    [`vat-underlag_${tag}.json`, JSON.stringify(report, null, 2) + "\n"],
    [`vat-underlag_${tag}.csv`, vatReportToCsv(report, csvOpts)],
    [
      `vat-underlag_totals_${tag}.csv`,
      totalsByCurrencyToCsv(report.totalsByCurrency, csvOpts),
    ],
  ];
  return files.map(([name, content]) => {
    const p = resolve(dir, name);
    writeFileSync(p, content);
    return p;
  });
}

/** Write the reconciliation JSON + reconciled CSV + att_granska CSV. */
export function writeReconciliationArtifacts(
  outDir: string,
  report: ReconciliationReport,
  csvOpts: CsvOptions = {}
): string[] {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const tag = periodTag(report.period);

  const files: Array<[string, string]> = [
    [
      `payout-reconciliation_${tag}.json`,
      JSON.stringify(report, null, 2) + "\n",
    ],
    [`payout-reconciled_${tag}.csv`, reconciledToCsv(report, csvOpts)],
    [`payout-att-granska_${tag}.csv`, attGranskaToCsv(report, csvOpts)],
  ];
  return files.map(([name, content]) => {
    const p = resolve(dir, name);
    writeFileSync(p, content);
    return p;
  });
}
