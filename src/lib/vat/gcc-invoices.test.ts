/**
 * One sample invoice per GCC country, priced by the same engine the app uses:
 * tax rate, currency, decimals, invoice title, and no VAT lines where there is
 * no VAT (Qatar, Kuwait), and sign-up accepting only the six countries.
 */
import { calcInvoiceTotals } from "@/lib/vat";
import { calcOptionsFor, invoiceTitleFor, resolveTaxContext, taxSummaryRows } from "@/lib/vat/context";
import { getCountryConfig } from "@/lib/vat/countries";
import { currencyDecimals } from "@/lib/utils";
import { completeSetupSchema, signupSchema } from "@/lib/validations";

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

type Case = {
  code: string;
  currency: string;
  decimals: number;
  rate: number;
  /** 2 x 12.345 (rounded to the currency) at the standard rate */
  subtotal: number;
  vat: number;
  total: number;
  titleBusiness: string;
  titleConsumer: string;
  vatLines: boolean;
};

const CASES: Case[] = [
  { code: "AE", currency: "AED", decimals: 2, rate: 5, subtotal: 24.69, vat: 1.23, total: 25.92, titleBusiness: "Tax Invoice", titleConsumer: "Tax Invoice", vatLines: true },
  { code: "SA", currency: "SAR", decimals: 2, rate: 15, subtotal: 24.69, vat: 3.7, total: 28.39, titleBusiness: "Tax Invoice", titleConsumer: "Simplified Tax Invoice", vatLines: true },
  { code: "BH", currency: "BHD", decimals: 3, rate: 10, subtotal: 24.69, vat: 2.469, total: 27.159, titleBusiness: "Tax Invoice", titleConsumer: "Tax Invoice", vatLines: true },
  { code: "OM", currency: "OMR", decimals: 3, rate: 5, subtotal: 24.69, vat: 1.235, total: 25.925, titleBusiness: "Tax Invoice", titleConsumer: "Tax Invoice", vatLines: true },
  { code: "QA", currency: "QAR", decimals: 2, rate: 0, subtotal: 24.69, vat: 0, total: 24.69, titleBusiness: "Invoice", titleConsumer: "Invoice", vatLines: false },
  { code: "KW", currency: "KWD", decimals: 3, rate: 0, subtotal: 24.69, vat: 0, total: 24.69, titleBusiness: "Invoice", titleConsumer: "Invoice", vatLines: false },
];

for (const c of CASES) {
  const country = getCountryConfig(c.code);
  const ctx = resolveTaxContext({ sellerCountry: c.code, sellerState: country.regions[0] ?? "", customer: { country: c.code } });
  check(ctx.currency === c.currency, `${c.code}: invoiced in ${c.currency}`);
  check(currencyDecimals(c.currency) === c.decimals && ctx.decimals === c.decimals, `${c.code}: ${c.decimals} decimals`);

  const totals = calcInvoiceTotals(
    [{ quantity: 2, unitPrice: 12.345, vatRate: country.standardRate, vatCategory: "standard" }],
    calcOptionsFor(ctx, false)
  );
  check(
    totals.subtotal === c.subtotal && totals.totalVat === c.vat && totals.grandTotal === c.total,
    `${c.code}: ${c.rate}% VAT -> ${totals.subtotal} + ${totals.totalVat} = ${totals.grandTotal} ${c.currency}`
  );
  check(invoiceTitleFor(ctx, "100123456700003") === c.titleBusiness, `${c.code}: "${c.titleBusiness}" to a registered business`);
  check(invoiceTitleFor(ctx, null) === c.titleConsumer, `${c.code}: "${c.titleConsumer}" to a consumer`);

  const rows = taxSummaryRows(ctx, totals.breakdown, (n) => n.toFixed(c.decimals));
  check(rows.some((r) => r.kind === "tax") === c.vatLines, `${c.code}: ${c.vatLines ? "VAT lines printed" : "no VAT lines"}`);
}

// A sale to another country is a zero-rated export
{
  const ctx = resolveTaxContext({ sellerCountry: "AE", sellerState: "Dubai", customer: { country: "GB" } });
  const t = calcInvoiceTotals([{ quantity: 1, unitPrice: 100, vatRate: 5, vatCategory: "standard" }], calcOptionsFor(ctx, false));
  check(ctx.treatment === "export" && t.totalVat === 0, "UAE -> UK customer: zero-rated export");
}

// Sign-up: each GCC country is accepted, removed countries are refused
const signup = (country?: string) =>
  signupSchema.safeParse({ business_name: "Test Trading", owner_name: "Test", email: "t@example.test", password: "Strong#Pass1", country });
for (const code of ["AE", "SA", "BH", "OM", "QA", "KW"]) {
  const r = signup(code);
  check(r.success && r.data.country === code, `sign-up in ${getCountryConfig(code).name} is accepted`);
  const g = completeSetupSchema.safeParse({ business_name: "Test Trading", owner_name: "Test", country: code.toLowerCase() });
  check(g.success && g.data.country === code, `Google sign-up setup in ${code} is accepted`);
}
for (const code of ["IN", "GB", "DE"]) check(!signup(code).success, `sign-up in ${code} is refused`);
{
  const r = signup(undefined);
  check(r.success && r.data.country === "AE", "no country chosen -> UAE");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\ngcc-invoices: all ok");
process.exit(failures ? 1 : 0);
