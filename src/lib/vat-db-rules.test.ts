/**
 * Migration 048 makes the database refuse invoices whose numbers don't add up.
 * This checks the app's own calculator never produces an invoice the database
 * would refuse: the rules below mirror document_line_problem() and
 * validate_invoice_totals() in supabase/migrations/048_protect_financial_records.sql.
 */
import { calcInvoiceTotals, type CalcOptions, type VatCategory } from "./vat";

let failures = 0;
function check(ok: boolean, label: string) {
  if (!ok) {
    failures++;
    if (failures <= 10) console.log(`FAIL  ${label}`);
  }
}

// Same tolerances as the SQL
function lineProblem(qty: number, price: number, taxable: number, rate: number, tax: number, total: number): string | null {
  if (!(qty > 0)) return "quantity";
  if (price < 0) return "negative price";
  if (taxable < 0 || tax < 0 || total < 0) return "negative amount";
  if (rate < 0 || rate > 100) return "rate";
  if (Math.abs(tax - (taxable * rate) / 100) > 0.02) return "tax vs rate";
  if (Math.abs(total - (taxable + tax)) > 0.011) return "line total";
  if (Math.abs(taxable - qty * price) > 0.011 && Math.abs(total - qty * price) > 0.011) return "qty x price";
  return null;
}

// Deterministic pseudo-random numbers
let seed = 20261029;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

const RATES = [0, 3, 5, 9, 10, 12, 15, 18, 20, 28, 40];
let invoices = 0;
for (let i = 0; i < 20000; i++) {
  const decimals = pick([2, 2, 2, 3]);
  const opts: CalcOptions = {
    decimals,
    split: pick(["single", "single", "cgst_sgst", "igst"] as const),
    treatment: pick(["domestic", "domestic", "domestic", "reverse_charge", "export"] as const),
    pricesIncludeVat: rand() < 0.5,
  };
  const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({
    quantity: Number((rand() < 0.5 ? 1 + Math.floor(rand() * 20) : rand() * 50 + 0.001).toFixed(3)),
    unitPrice: Number((rand() < 0.1 ? rand() * 100000 : rand() * 500).toFixed(decimals)),
    vatRate: pick(RATES),
    vatCategory: pick<VatCategory>(["standard", "standard", "zero", "exempt"]),
  }));
  const t = calcInvoiceTotals(lines, opts);
  invoices++;
  t.lines.forEach((l, idx) => {
    const p = lineProblem(lines[idx].quantity, lines[idx].unitPrice, l.taxableValue, l.vatRate, l.vatAmount, l.lineTotal);
    check(p === null, `case ${i} line ${idx}: ${p} ${JSON.stringify({ opts, line: lines[idx], result: l })}`);
  });
  const sTaxable = t.lines.reduce((s, l) => s + l.taxableValue, 0);
  const sTax = t.lines.reduce((s, l) => s + l.vatAmount, 0);
  check(Math.abs(t.subtotal - sTaxable) <= 0.011 && Math.abs(t.totalVat - sTax) <= 0.011, `case ${i}: header vs lines`);
  check(Math.abs(t.grandTotal - (t.subtotal + t.totalVat + t.roundOff)) <= 0.011 && Math.abs(t.roundOff) <= 1, `case ${i}: grand total`);
}

console.log(failures ? `\n${failures} FAILURE(S) in ${invoices} invoices` : `\nall ${invoices} generated invoices pass the database rules`);
process.exit(failures ? 1 : 0);
