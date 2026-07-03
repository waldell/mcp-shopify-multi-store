/**
 * Bank (Nordea) CSV parser. Pure and deterministic.
 *
 * Nordea eCom exports have no reference number on the Stripe/Shopify payout
 * rows — the descriptor is just "STRIPE Shopi" — so the only reliable bridge to
 * a Shopify payout is (currency, date, amount at full öre). This parser's job is
 * to turn each bank line into a { date, amount, currency, descriptor } row with
 * the amount at full precision.
 *
 * Amounts arrive in Swedish format ("5 370,35" = space thousands, comma decimal)
 * or dot format ("5370.35"); both are handled. The file may be comma- or
 * semicolon-delimited; semicolon is preferred (Swedish exports use it precisely
 * because amounts contain commas) and is auto-detected. When comma-delimited and
 * an unquoted comma-decimal amount gets split, the split halves are re-joined.
 */
import { Decimal } from "./money.js";
import type { BankRow } from "./types.js";

export interface BankCsvOptions {
  /** Currency for rows with no currency column (Nordea eCom often omits it). */
  defaultCurrency: string;
  /** Field delimiter. Default: auto (';' if any present, else ','). */
  delimiter?: string;
  /** Whether the first row is a header. Default: auto-detect. */
  hasHeader?: boolean;
  /**
   * Column mapping. Each value is either a header name (case-insensitive) or a
   * 0-based column index. Omitted → resolved from header aliases, else from the
   * positional Nordea default (date, _, descriptor, _, amount, _).
   */
  columns?: {
    date?: string | number;
    amount?: string | number;
    currency?: string | number;
    descriptor?: string | number;
  };
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "datum", "bokföringsdag", "bokforingsdag", "transaktionsdag"],
  amount: ["amount", "belopp", "summa"],
  currency: ["currency", "valuta", "ccy"],
  descriptor: ["descriptor", "text", "beskrivning", "meddelande", "referens", "message"],
};

/** Split one CSV line on `delimiter`, honoring double-quote quoting. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/**
 * Parse a money amount in Swedish or dot format into a Decimal.
 * Handles: "5 370,35", "5370.35", "-1 234,56", "1.234,56", "1,234.56".
 * Returns null if the field is not a number.
 */
export function parseBankAmount(input: string): Decimal | null {
  let s = input.replace(/[\s ]/g, "").replace(/^\+/, "");
  if (s === "" || !/[0-9]/.test(s)) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // The right-most separator is the decimal point; the other is thousands.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Comma only. 3 trailing digits after the last comma → thousands grouping
    // (e.g. "1,234" = 1234); otherwise the last comma is a decimal comma
    // (e.g. "5370,35" = 5370.35).
    const after = s.slice(s.lastIndexOf(",") + 1);
    if (/^\d{3}$/.test(after)) {
      s = s.replace(/,/g, "");
    } else {
      const li = s.lastIndexOf(",");
      s = s.slice(0, li).replace(/,/g, "") + "." + s.slice(li + 1);
    }
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  try {
    return new Decimal(s);
  } catch {
    return null;
  }
}

function looksLikeAmount(s: string): boolean {
  return parseBankAmount(s) !== null && /[0-9]/.test(s);
}

function looksLikeDate(s: string): boolean {
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(s.trim());
}

/** Re-join a comma-decimal amount that a comma delimiter split in two. */
function healCommaDecimal(fields: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const a = fields[i];
    const b = fields[i + 1];
    if (
      b !== undefined &&
      /^-?[\d  ]+$/.test(a) &&
      /^\d{2}$/.test(b) &&
      /\d/.test(a)
    ) {
      out.push(`${a},${b}`);
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

function resolveIndex(
  spec: string | number | undefined,
  header: string[] | null,
  aliases: string[],
  fallback: number
): number {
  if (typeof spec === "number") return spec;
  if (typeof spec === "string" && header) {
    const idx = header.findIndex(
      (h) => h.toLowerCase() === spec.toLowerCase()
    );
    if (idx >= 0) return idx;
  }
  if (header) {
    const idx = header.findIndex((h) => aliases.includes(h.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return fallback;
}

export function parseBankCsv(text: string, opts: BankCsvOptions): BankRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const delimiter =
    opts.delimiter ?? (lines[0].includes(";") ? ";" : ",");

  const firstFields = splitLine(lines[0], delimiter);
  const headerLooksLikeData =
    looksLikeDate(firstFields[0] ?? "") ||
    firstFields.some((f) => looksLikeAmount(f));
  const hasHeader = opts.hasHeader ?? !headerLooksLikeData;
  const header = hasHeader
    ? firstFields.map((h) => h.trim())
    : null;

  const dateIdx = resolveIndex(opts.columns?.date, header, HEADER_ALIASES.date, 0);
  const descIdx = resolveIndex(
    opts.columns?.descriptor,
    header,
    HEADER_ALIASES.descriptor,
    2
  );
  const amountIdx = resolveIndex(
    opts.columns?.amount,
    header,
    HEADER_ALIASES.amount,
    4
  );
  const currencyIdx =
    opts.columns?.currency !== undefined || header?.some((h) => HEADER_ALIASES.currency.includes(h.toLowerCase()))
      ? resolveIndex(opts.columns?.currency, header, HEADER_ALIASES.currency, -1)
      : -1;

  const rows: BankRow[] = [];
  const dataLines = hasHeader ? lines.slice(1) : lines;
  for (const line of dataLines) {
    let fields = splitLine(line, delimiter);
    if (delimiter === ",") fields = healCommaDecimal(fields);

    const dateRaw = fields[dateIdx] ?? "";
    // Prefer the configured/positional amount column; if it doesn't parse (e.g. a
    // headerless file whose layout differs from the 6-col Nordea default), fall
    // back to the right-most field that parses as a number (never the date col).
    let amountDec = parseBankAmount(fields[amountIdx] ?? "");
    if (amountDec === null) {
      for (let j = fields.length - 1; j >= 0; j--) {
        if (j === dateIdx) continue;
        const cand = parseBankAmount(fields[j]);
        if (cand !== null) {
          amountDec = cand;
          break;
        }
      }
    }
    if (amountDec === null) continue; // skip rows without a parseable amount

    const currency =
      currencyIdx >= 0 && fields[currencyIdx]
        ? fields[currencyIdx].toUpperCase()
        : opts.defaultCurrency.toUpperCase();

    rows.push({
      date: normalizeDate(dateRaw),
      amount: amountDec.toFixed(2),
      currency,
      descriptor: fields[descIdx] ?? "",
      raw: line,
    });
  }
  return rows;
}

/** Normalize a date field to YYYY-MM-DD (accepts YYYY-MM-DD or YYYY/MM/DD). */
function normalizeDate(s: string): string {
  const m = s.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.trim();
}
