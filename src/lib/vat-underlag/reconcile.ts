/**
 * Bank ↔ payout reconciliation. Pure and deterministic.
 *
 * Nordea eCom rows carry no reference number, so identity matching is
 * impossible. We match on GROUPS instead:
 *
 *   group key = (currency, issued/booked date, net amount at FULL öre precision)
 *
 * and compare the COUNT of bank rows vs Shopify payouts in each group:
 *   - N-vs-N (N ≥ 1), including legitimate duplicates (two identical amounts on
 *     the same day) → reconciled; the assignment inside the group is arbitrary
 *     and correct, so we do NOT flag it.
 *   - any count mismatch (incl. one side being 0) → pushed to `att_granska`.
 *
 * Currency is part of the key, so cross-currency matches never happen.
 */
import type {
  BankRow,
  NormalizedPayout,
  ReconciledRow,
  AttGranskaRow,
} from "./types.js";

export interface ReconcileResult {
  reconciled: ReconciledRow[];
  att_granska: AttGranskaRow[];
}

interface Bucket {
  currency: string;
  date: string;
  amount: string;
  bank: BankRow[];
  payouts: NormalizedPayout[];
}

function key(currency: string, date: string, amount: string): string {
  return `${currency}|${date}|${amount}`;
}

export function reconcile(
  bankRows: BankRow[],
  payouts: NormalizedPayout[]
): ReconcileResult {
  const buckets = new Map<string, Bucket>();

  const bucketFor = (currency: string, date: string, amount: string): Bucket => {
    const k = key(currency, date, amount);
    let b = buckets.get(k);
    if (!b) {
      b = { currency, date, amount, bank: [], payouts: [] };
      buckets.set(k, b);
    }
    return b;
  };

  for (const r of bankRows) {
    bucketFor(r.currency, r.date, r.amount).bank.push(r);
  }
  for (const p of payouts) {
    bucketFor(p.currency, p.issuedAt, p.net).payouts.push(p);
  }

  // Deterministic bucket order: currency, date, amount.
  const ordered = [...buckets.values()].sort(
    (a, b) =>
      a.currency.localeCompare(b.currency) ||
      a.date.localeCompare(b.date) ||
      a.amount.localeCompare(b.amount)
  );

  const reconciled: ReconciledRow[] = [];
  const att_granska: AttGranskaRow[] = [];

  for (const b of ordered) {
    const bankCount = b.bank.length;
    const payoutCount = b.payouts.length;

    if (bankCount === payoutCount && bankCount > 0) {
      // N-vs-N. Pair by index — arbitrary within the group and correct.
      const bank = [...b.bank].sort((x, y) =>
        x.descriptor.localeCompare(y.descriptor)
      );
      const pos = [...b.payouts].sort((x, y) =>
        x.payoutId.localeCompare(y.payoutId)
      );
      for (let i = 0; i < pos.length; i++) {
        reconciled.push({
          store: pos[i].store,
          currency: b.currency,
          date: b.date,
          amount: b.amount,
          payoutId: pos[i].payoutId,
          bankDescriptor: bank[i].descriptor,
        });
      }
    } else {
      att_granska.push({
        currency: b.currency,
        date: b.date,
        amount: b.amount,
        bankCount,
        payoutCount,
        reason: reasonFor(bankCount, payoutCount),
        payoutIds: b.payouts.map((p) => p.payoutId).sort(),
        bankDescriptors: b.bank.map((r) => r.descriptor).sort(),
      });
    }
  }

  return { reconciled, att_granska };
}

function reasonFor(bankCount: number, payoutCount: number): string {
  if (payoutCount === 0) {
    return "Bankrad utan matchande Shopify-payout (orelaterad insättning eller fel datum/belopp).";
  }
  if (bankCount === 0) {
    return "Payout utan matchande bankrad (ännu ej landad / pending / väntande utbetalning).";
  }
  if (bankCount > payoutCount) {
    return `Fler bankrader (${bankCount}) än payouts (${payoutCount}) — möjlig dubbel utbetalning eller orelaterad insättning.`;
  }
  return `Fler payouts (${payoutCount}) än bankrader (${bankCount}) — möjlig retried/pending payout eller ännu ej landad.`;
}
