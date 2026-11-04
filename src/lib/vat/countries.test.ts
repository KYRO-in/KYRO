import { calcInvoiceTotals, calcLineVat } from "@/lib/vat";
import { amountInWords } from "@/lib/amount-in-words";
import {
  COUNTRIES,
  countryOptions,
  ENABLED_COUNTRIES,
  GCC_VAT_SWITCH,
  getCountryConfig,
  indiaStateFromGstin,
  indiaStateName,
  isOfferedCountry,
  isValidTaxId,
  partyCountryOptions,
} from "@/lib/vat/countries";
import { productTaxLabel, taxChoiceKey, taxChoices } from "@/lib/vat/tax-choices";
import {
  calcOptionsFor,
  contextForDocument,
  invoiceTitleFor,
  resolveTaxContext,
  suggestTreatment,
  taxSummaryRows,
  treatmentNote,
} from "@/lib/vat/context";
import { zatcaQrPayload } from "@/lib/vat/zatca";
import { currencyDecimals, formatCurrency } from "@/lib/utils";

/** Multi-country tax checks - run with: npx tsx src/lib/vat/countries.test.ts */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---------- the table itself ----------
// GCC-only for now: exactly the six Gulf countries are offered to new businesses
assert(
  ENABLED_COUNTRIES.map((c) => c.code).join(",") === "AE,SA,BH,OM,QA,KW",
  `offered: the six GCC countries (got ${ENABLED_COUNTRIES.map((c) => c.code).join(",")})`
);
assert(Object.keys(COUNTRIES).length === 35, "the other 29 stay configured for existing businesses");
for (const code of ["GB", "IN", "DE", "FR"]) assert(!isOfferedCountry(code), `${code} is not offered to new businesses`);
for (const code of ["AE", "sa", "BH", "OM", "QA", "KW"]) assert(isOfferedCountry(code), `${code} is offered`);
assert(countryOptions().length === 6, "sign-up and settings list six countries");
assert(countryOptions("IN").some((o) => o.value === "IN"), "an existing India business still sees its own country in Settings");
assert(!countryOptions("AE").some((o) => o.value === "IN"), "a Gulf business never sees India");
assert(partyCountryOptions().length === 35 && partyCountryOptions()[0].value === "AE", "customers and suppliers can be anywhere, GCC first");
assert(Object.keys(GCC_VAT_SWITCH).length === 0, "Qatar and Kuwait have no VAT switched on");

// The rules for each GCC country
const gcc = (code: string) => getCountryConfig(code);
const rule = (code: string, taxSystem: string, rate: number, currency: string, decimals: number, title: string, ret: string) => {
  const c = gcc(code);
  assert(c.taxSystem === taxSystem, `${code} tax system ${c.taxSystem}`);
  assert(c.standardRate === rate, `${code} rate ${c.standardRate}`);
  assert(c.currency === currency && c.currencyDecimals === decimals, `${code} ${c.currency} ${c.currencyDecimals} decimals`);
  assert(c.invoiceTitle === title, `${code} invoice title "${c.invoiceTitle}"`);
  assert(c.returnName === ret, `${code} return "${c.returnName}"`);
  assert(c.arabic === true, `${code} offers English + Arabic`);
};
rule("AE", "vat", 5, "AED", 2, "Tax Invoice", "VAT 201");
rule("SA", "vat", 15, "SAR", 2, "Tax Invoice", "VAT return");
rule("BH", "vat", 10, "BHD", 3, "Tax Invoice", "VAT return");
rule("OM", "vat", 5, "OMR", 3, "Tax Invoice", "VAT return");
rule("QA", "none", 0, "QAR", 2, "Invoice", "Sales summary");
rule("KW", "none", 0, "KWD", 3, "Invoice", "Sales summary");
assert(isValidTaxId("100123456700003", "AE") && !isValidTaxId("10012345670000", "AE"), "UAE TRN is 15 digits");
assert(isValidTaxId("300000000000003", "SA") && !isValidTaxId("30000000000000", "SA"), "Saudi VAT number is 15 digits");
assert(gcc("SA").zatcaQr === true, "Saudi invoices carry the ZATCA QR code");
for (const c of Object.values(COUNTRIES)) {
  assert(c.rates[0].rate === c.standardRate, `${c.code}: standard rate listed first`);
  assert(c.taxIdPattern.test(c.taxIdPlaceholder.replace(/\s/g, "")), `${c.code}: placeholder ${c.taxIdPlaceholder} is a valid ${c.taxIdLabel}`);
  assert(currencyDecimals(c.currency) === c.currencyDecimals, `${c.code}: ${c.currency} has ${c.currencyDecimals} decimals`);
  assert(!!c.dialCode, `${c.code}: dial code`);
}
assert(getCountryConfig("xx").code === "AE", "unknown country falls back to the UAE");
assert(getCountryConfig("in").code === "IN", "lower-case codes work");

// ---------- tax numbers ----------
assert(isValidTaxId("300000000000003", "SA"), "Saudi VAT number");
assert(!isValidTaxId("100123456700003", "SA"), "a UAE TRN is not a Saudi VAT number");
assert(isValidTaxId("29ABCDE1234F1Z5", "IN"), "GSTIN");
assert(!isValidTaxId("29ABCDE1234F1X5", "IN"), "GSTIN needs Z in position 14");
assert(isValidTaxId("GB123456789", "GB") && isValidTaxId("123 4567 89", "GB"), "UK VAT number with or without GB");
assert(isValidTaxId("DE123456789", "DE") && isValidTaxId("123456789", "DE"), "German VAT ID with or without DE");
assert(isValidTaxId("EL123456789", "GR"), "Greece uses the EL prefix");
assert(isValidTaxId("NL123456789B01", "NL"), "Dutch VAT ID");
assert(!isValidTaxId("FR123", "FR"), "short French VAT ID rejected");
assert(isValidTaxId("", "IN"), "empty is fine (consumer)");

// ---------- 3-decimal currencies ----------
{
  const line = calcLineVat({ quantity: 3, unitPrice: 1.235, vatRate: 10 }, { decimals: 3 });
  assert(line.taxableValue === 3.705, `BHD taxable ${line.taxableValue}`);
  assert(line.vatAmount === 0.371, `BHD VAT keeps fils ${line.vatAmount}`);
  assert(line.lineTotal === 4.076, `BHD total ${line.lineTotal}`);
  const twoDp = calcLineVat({ quantity: 3, unitPrice: 1.235, vatRate: 10 });
  assert(twoDp.taxableValue === 3.71, "2-decimal default unchanged");
  assert(formatCurrency(1.5, "KWD").includes("1.500"), `KWD shows 3 decimals: ${formatCurrency(1.5, "KWD")}`);
}

// ---------- India GST ----------
{
  const local = resolveTaxContext({
    sellerCountry: "IN",
    sellerState: "Karnataka",
    customer: { country: "IN", state: "Karnataka" },
  });
  assert(local.split === "cgst_sgst", "same state: CGST + SGST");
  assert(local.placeOfSupply === "Karnataka (29)", `place of supply ${local.placeOfSupply}`);
  const t = calcInvoiceTotals([{ quantity: 1, unitPrice: 999, vatRate: 18 }], calcOptionsFor(local, false));
  const l = t.lines[0];
  assert(l.cgst === 89.91 && l.sgst === 89.91 && l.vatAmount === 179.82, `CGST/SGST halves ${l.cgst}/${l.sgst}/${l.vatAmount}`);
  const rows = taxSummaryRows(local, t.breakdown, (n) => n.toFixed(2));
  assert(rows.length === 2 && rows[0].label.startsWith("CGST 9%") && rows[1].label.startsWith("SGST 9%"), "CGST 9% + SGST 9% rows");

  const other = resolveTaxContext({
    sellerCountry: "IN",
    sellerState: "Karnataka",
    customer: { country: "IN", state: "Maharashtra" },
  });
  assert(other.split === "igst", "another state: IGST");
  const t2 = calcInvoiceTotals([{ quantity: 2, unitPrice: 500, vatRate: 5 }], calcOptionsFor(other, false));
  assert(t2.lines[0].igst === 50 && t2.totalVat === 50, "IGST 5%");
  assert(taxSummaryRows(other, t2.breakdown, String)[0].label.startsWith("IGST 5%"), "IGST row");

  const ut = resolveTaxContext({ sellerCountry: "IN", sellerState: "Chandigarh", customer: { country: "IN", state: "Chandigarh" } });
  const t3 = calcInvoiceTotals([{ quantity: 1, unitPrice: 100, vatRate: 18 }], calcOptionsFor(ut, false));
  assert(taxSummaryRows(ut, t3.breakdown, String)[1].label.startsWith("UTGST"), "union territory: UTGST");

  const exp = resolveTaxContext({ sellerCountry: "IN", sellerState: "Kerala", customer: { country: "AE" } });
  assert(exp.treatment === "export" && exp.split === "igst", "export from India: IGST, zero-rated");
  assert(/LUT/.test(treatmentNote(exp) ?? ""), "LUT note on exports");
  assert(amountInWords(1234567, "INR") === "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only", amountInWords(1234567, "INR"));
  assert(amountInWords(25000000, "INR") === "Rupees Two Crore Fifty Lakh Only", amountInWords(25000000, "INR"));
}

// ---------- EU reverse charge and exports ----------
{
  const de = getCountryConfig("DE");
  assert(suggestTreatment(de, { country: "FR", tax_id: "FR12345678901" }) === "reverse_charge", "DE → FR business: reverse charge");
  assert(suggestTreatment(de, { country: "FR", tax_id: "" }) === "domestic", "DE → FR consumer: German VAT");
  assert(suggestTreatment(de, { country: "GB", tax_id: "GB123456789" }) === "export", "DE → UK: export");
  assert(suggestTreatment(de, { country: "DE" }) === "domestic", "DE → DE: local");

  const rc = resolveTaxContext({ sellerCountry: "DE", customer: { country: "FR", tax_id: "FR12345678901" } });
  const t = calcInvoiceTotals([{ quantity: 1, unitPrice: 1000, vatRate: 19 }], calcOptionsFor(rc, false));
  assert(t.totalVat === 0 && t.grandTotal === 1000, "reverse charge: no VAT charged");
  assert(/Article 196/.test(treatmentNote(rc) ?? ""), "EU reverse charge wording");
  assert(taxSummaryRows(rc, t.breakdown, String)[0].key === "rc", "reverse charge summary row");

  const uk = resolveTaxContext({ sellerCountry: "GB", customer: { country: "US" } });
  const t2 = calcInvoiceTotals([{ quantity: 1, unitPrice: 50, vatRate: 20 }], calcOptionsFor(uk, false));
  assert(uk.treatment === "export" && t2.totalVat === 0 && t2.lines[0].vatCategory === "zero", "UK export is zero-rated");
  assert(invoiceTitleFor(resolveTaxContext({ sellerCountry: "GB" })) === "VAT Invoice", "UK title");
}

// ---------- Gulf ----------
{
  const sa = resolveTaxContext({ sellerCountry: "SA", customer: { country: "SA" } });
  assert(invoiceTitleFor(sa, null) === "Simplified Tax Invoice", "Saudi consumer invoice");
  assert(invoiceTitleFor(sa, "300000000000003") === "Tax Invoice", "Saudi business invoice");
  const t = calcInvoiceTotals([{ quantity: 1, unitPrice: 100, vatRate: 15 }], calcOptionsFor(sa, false));
  assert(t.totalVat === 15, "Saudi 15%");

  const qa = resolveTaxContext({ sellerCountry: "QA" });
  const t2 = calcInvoiceTotals([{ quantity: 2, unitPrice: 75, vatRate: 5 }], calcOptionsFor(qa, true));
  assert(qa.taxFree && t2.totalVat === 0 && t2.grandTotal === 150, "Qatar: no tax even if a product had a rate");
  assert(taxSummaryRows(qa, t2.breakdown, String).length === 0, "no tax rows in Qatar");
  assert(invoiceTitleFor(qa) === "Invoice", "Qatar title");

  const ae = resolveTaxContext({ sellerCountry: "AE", customer: { country: "SA" } });
  assert(ae.treatment === "export", "UAE → Saudi: export (zero-rated)");
}

// ---------- issued invoices keep their rules ----------
{
  const ctx = contextForDocument(
    { currency: "INR", tax_country: "IN", tax_treatment: "domestic", tax_split: "igst", place_of_supply: "Goa (30)" },
    { country: "AE", state: "Dubai" }
  );
  assert(ctx.country.code === "IN" && ctx.split === "igst" && ctx.placeOfSupply === "Goa (30)", "stored rules win over today's settings");
  const legacy = contextForDocument({ currency: "AED" }, { country: "AE", state: "Dubai" }, { state: "Sharjah" });
  assert(legacy.country.code === "AE" && legacy.treatment === "domestic" && legacy.placeOfSupply === "Sharjah", "older invoices fall back to the organization");
}

// ---------- ZATCA QR ----------
{
  const b64 = zatcaQrPayload({
    sellerName: "Bobs Records",
    vatNumber: "310122393500003",
    timestamp: "2022-04-25T15:30:00Z",
    total: 1000,
    vatTotal: 150,
  });
  const bytes = Buffer.from(b64, "base64");
  const fields: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    fields[tag] = bytes.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  assert(fields[1] === "Bobs Records" && fields[2] === "310122393500003", "TLV seller + VAT number");
  assert(fields[3] === "2022-04-25T15:30:00Z" && fields[4] === "1000.00" && fields[5] === "150.00", "TLV time, total, VAT");
  const arabic = zatcaQrPayload({ sellerName: "شركة", vatNumber: "300000000000003", timestamp: "2026-01-01T00:00:00Z", total: 1, vatTotal: 0.13 });
  assert(Buffer.from(arabic, "base64")[1] === Buffer.byteLength("شركة"), "Arabic names are measured in bytes");
}

// ---------- India: states written any way, GSTIN fallback ----------
{
  assert(indiaStateName("Gujarat (24)") === "Gujarat" && indiaStateName("24") === "Gujarat" && indiaStateName(" gujarat ") === "Gujarat", "state name forms");
  assert(indiaStateName("Atlantis") === null, "not a state");
  assert(indiaStateFromGstin("24ABCDE1234F1Z5") === "Gujarat", "GSTIN state");

  // Saved as "Gujarat (24)" vs customer "Gujarat": same state
  const labelled = resolveTaxContext({ sellerCountry: "IN", sellerState: "Gujarat (24)", customer: { country: "IN", state: "Gujarat" } });
  assert(labelled.split === "cgst_sgst", "labelled state still matches");

  // No state saved, but the GSTIN says Gujarat
  const fromGstin = resolveTaxContext({ sellerCountry: "IN", sellerState: "", sellerTaxId: "24ABCDE1234F1Z5", customer: { country: "IN", state: "Gujarat" } });
  assert(fromGstin.split === "cgst_sgst" && !fromGstin.sellerStateMissing, "seller state from GSTIN");
  const otherState = resolveTaxContext({ sellerCountry: "IN", sellerTaxId: "24ABCDE1234F1Z5", customer: { country: "IN", state: "Maharashtra" } });
  assert(otherState.split === "igst", "GSTIN seller, other-state buyer: IGST");

  // Customer's state from their GSTIN
  const buyerGstin = resolveTaxContext({ sellerCountry: "IN", sellerState: "Karnataka", customer: { country: "IN", tax_id: "27ABCDE1234F1Z5" } });
  assert(buyerGstin.split === "igst" && buyerGstin.placeOfSupply === "Maharashtra (27)", "buyer state from GSTIN");

  // Nothing known about the business: local sale, flagged
  const unknown = resolveTaxContext({ sellerCountry: "IN", customer: { country: "IN", state: "Gujarat" } });
  assert(unknown.split === "cgst_sgst" && unknown.sellerStateMissing === true, "missing seller state is flagged");
}

// ---------- product tax choices in each country's words ----------
{
  const india = getCountryConfig("IN");
  const keys = taxChoices(india).map((c) => c.key);
  assert(keys.includes("standard:18") && keys.includes("standard:3") && keys.includes("zero") && keys.includes("exempt"), "India choices");
  assert(taxChoices(india).find((c) => c.key === "zero")!.label.includes("Nil-rated"), "India says nil-rated");
  assert(!taxChoices(india).some((c) => /zero-rated/i.test(c.label)), "India never says zero-rated on products");
  assert(productTaxLabel({ vat_category: "zero", vat_rate: 0 }, india) === "Nil-rated", "India nil label");
  assert(taxChoiceKey("standard", 12, india) === "custom", "old 12% slab shows as other rate");
  const uae = getCountryConfig("AE");
  assert(taxChoices(uae).find((c) => c.key === "zero")!.label.includes("Zero-rated"), "UAE says zero-rated");
  assert(taxChoiceKey("standard", 5, uae) === "standard:5", "UAE 5%");
}

// ---------- India, prices including GST: CGST and SGST stay equal ----------
{
  const local = resolveTaxContext({ sellerCountry: "IN", sellerState: "Gujarat", customer: { country: "IN", state: "Gujarat" } });
  for (const price of [140, 99.99, 1, 43547.6, 777]) {
    for (const rate of [3, 5, 18, 40]) {
      const t = calcInvoiceTotals([{ quantity: 1, unitPrice: price, vatRate: rate }], calcOptionsFor(local, true));
      const l = t.lines[0];
      assert(l.cgst === l.sgst, `equal halves at ${price} @ ${rate}%: ${l.cgst} vs ${l.sgst}`);
      assert(t.grandTotal === price, `customer pays the price at ${price} @ ${rate}%: ${t.grandTotal}`);
    }
  }
}

console.log("countries.test.ts: all ok");
