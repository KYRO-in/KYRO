/**
 * Country tax configuration. Adding a country = adding an entry here;
 * the tax engine, forms, invoice PDF and tax return read everything from
 * this table.
 *
 * Three tax systems:
 *  - "vat"  one VAT per line (GCC, UK, EU)
 *  - "gst"  India: CGST + SGST inside a state, IGST between states
 *  - "none" no sales tax yet (Qatar, Kuwait): plain invoices, 0% tax
 *
 * Rates are the published rates as of 2026. Businesses can still type any
 * rate on a product, so a rate change never blocks invoicing.
 */

export type TaxSystem = "vat" | "gst" | "none";

export type CountryGroup = "Gulf" | "United Kingdom" | "Europe" | "India";

export type CountryCode =
  | "AE" | "SA" | "BH" | "OM" | "QA" | "KW"
  | "GB" | "IN"
  | "AT" | "BE" | "BG" | "HR" | "CY" | "CZ" | "DK" | "EE" | "FI" | "FR"
  | "DE" | "GR" | "HU" | "IE" | "IT" | "LV" | "LT" | "LU" | "MT" | "NL"
  | "PL" | "PT" | "RO" | "SK" | "SI" | "ES" | "SE";

export interface VatRateOption {
  rate: number;
  label: string;
}

export interface CountryVatConfig {
  code: CountryCode;
  name: string;
  group: CountryGroup;
  enabled: boolean;
  taxSystem: TaxSystem;
  /** What the tax is called on screen and on the invoice: VAT, GST or Tax */
  taxName: string;
  currency: string;
  /** Minor-unit digits for the currency (AED 2, BHD/OMR/KWD 3) */
  currencyDecimals: number;
  standardRate: number;
  /** Rates offered on products, standard first */
  rates: VatRateOption[];
  /** Default rate for gold / jewellery when it differs from the standard rate */
  jewelleryRate?: number;
  /** Label for the tax registration number, e.g. "TRN", "GSTIN", "VAT No." */
  taxIdLabel: string;
  taxIdPlaceholder: string;
  /** Validates a normalized (spaces stripped, upper-cased) registration number */
  taxIdPattern: RegExp;
  /** Country prefix that may be left off when typing (EU "DE", UK "GB") */
  taxIdPrefix?: string;
  taxIdHint: string;
  /** Title printed on an invoice to a registered business */
  invoiceTitle: string;
  /** Title for an invoice to a consumer, where the law names it differently (Saudi) */
  simplifiedInvoiceTitle?: string;
  /** Label for the region field (emirate, state, province, governorate) */
  regionLabel: string;
  regions: readonly string[];
  postalLabel: string;
  dialCode: string;
  /** Countries in the same zone trade business-to-business under reverse charge */
  vatZone?: "EU";
  /** Saudi Arabia: ZATCA QR code on every invoice */
  zatcaQr?: boolean;
  /** Offer English + Arabic invoices */
  arabic?: boolean;
  /** Invoice numbering restarts in April (India's financial year) */
  aprilNumbering?: boolean;
  /** Bank account labels for the invoice footer */
  bankAccountLabel: string;
  bankCodeLabel: string;
  bankAccountPlaceholder: string;
  /** Name of the tax return the report screen prepares */
  returnName: string;
  /** Where the business files that return */
  returnPortal: string;
}

export const UAE_EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
] as const;

/** India states and union territories with their GST state codes. */
export const INDIA_STATES: readonly { name: string; code: string; ut?: boolean }[] = [
  { name: "Andaman and Nicobar Islands", code: "35", ut: true },
  { name: "Andhra Pradesh", code: "37" },
  { name: "Arunachal Pradesh", code: "12" },
  { name: "Assam", code: "18" },
  { name: "Bihar", code: "10" },
  { name: "Chandigarh", code: "04", ut: true },
  { name: "Chhattisgarh", code: "22" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "26", ut: true },
  { name: "Delhi", code: "07" },
  { name: "Goa", code: "30" },
  { name: "Gujarat", code: "24" },
  { name: "Haryana", code: "06" },
  { name: "Himachal Pradesh", code: "02" },
  { name: "Jammu and Kashmir", code: "01" },
  { name: "Jharkhand", code: "20" },
  { name: "Karnataka", code: "29" },
  { name: "Kerala", code: "32" },
  { name: "Ladakh", code: "38", ut: true },
  { name: "Lakshadweep", code: "31", ut: true },
  { name: "Madhya Pradesh", code: "23" },
  { name: "Maharashtra", code: "27" },
  { name: "Manipur", code: "14" },
  { name: "Meghalaya", code: "17" },
  { name: "Mizoram", code: "15" },
  { name: "Nagaland", code: "13" },
  { name: "Odisha", code: "21" },
  { name: "Puducherry", code: "34" },
  { name: "Punjab", code: "03" },
  { name: "Rajasthan", code: "08" },
  { name: "Sikkim", code: "11" },
  { name: "Tamil Nadu", code: "33" },
  { name: "Telangana", code: "36" },
  { name: "Tripura", code: "16" },
  { name: "Uttar Pradesh", code: "09" },
  { name: "Uttarakhand", code: "05" },
  { name: "West Bengal", code: "19" },
];

const GCC_BANK = {
  bankAccountLabel: "IBAN",
  bankCodeLabel: "SWIFT / BIC",
} as const;

const zeroAndStandard = (rate: number): VatRateOption[] => [
  { rate, label: `Standard ${rate}%` },
  { rate: 0, label: "Zero-rated 0%" },
];

/** EU member state: standard rate, reduced rates, VAT number format. */
function eu(
  code: CountryCode,
  name: string,
  standardRate: number,
  reduced: number[],
  taxIdPattern: RegExp,
  taxIdPlaceholder: string,
  currency = "EUR",
  taxIdPrefix: string = code
): CountryVatConfig {
  return {
    code,
    name,
    group: "Europe",
    // GCC-only for now: kept so an existing business here keeps working
    enabled: false,
    taxSystem: "vat",
    taxName: "VAT",
    currency,
    currencyDecimals: 2,
    standardRate,
    rates: [
      { rate: standardRate, label: `Standard ${standardRate}%` },
      ...reduced.map((rate) => ({ rate, label: `Reduced ${rate}%` })),
      { rate: 0, label: "Zero-rated 0%" },
    ],
    taxIdLabel: "VAT No.",
    taxIdPlaceholder,
    taxIdPattern,
    taxIdPrefix,
    taxIdHint: `VAT identification number, e.g. ${taxIdPlaceholder}`,
    invoiceTitle: "Invoice",
    regionLabel: "Region",
    regions: [],
    postalLabel: "Postcode",
    dialCode: "",
    vatZone: "EU",
    bankAccountLabel: "IBAN",
    bankCodeLabel: "BIC",
    bankAccountPlaceholder: `${taxIdPrefix === "EL" ? "GR" : code}00 0000 0000 0000 0000`,
    returnName: "VAT return",
    returnPortal: "your national tax portal",
  };
}

export const COUNTRIES: Record<CountryCode, CountryVatConfig> = {
  // ---------- Gulf ----------
  AE: {
    code: "AE",
    name: "United Arab Emirates",
    group: "Gulf",
    enabled: true,
    taxSystem: "vat",
    taxName: "VAT",
    currency: "AED",
    currencyDecimals: 2,
    standardRate: 5,
    rates: zeroAndStandard(5),
    taxIdLabel: "TRN",
    taxIdPlaceholder: "100123456700003",
    taxIdPattern: /^\d{15}$/,
    taxIdHint: "15-digit Tax Registration Number issued by the FTA",
    invoiceTitle: "Tax Invoice",
    regionLabel: "Emirate",
    regions: UAE_EMIRATES,
    postalLabel: "P.O. Box",
    dialCode: "+971",
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "AE07 0331 2345 6789 0123 456",
    returnName: "VAT 201",
    returnPortal: "EmaraTax",
  },
  SA: {
    code: "SA",
    name: "Saudi Arabia",
    group: "Gulf",
    enabled: true,
    taxSystem: "vat",
    taxName: "VAT",
    currency: "SAR",
    currencyDecimals: 2,
    standardRate: 15,
    rates: zeroAndStandard(15),
    taxIdLabel: "VAT No.",
    taxIdPlaceholder: "300000000000003",
    taxIdPattern: /^3\d{13}3$/,
    taxIdHint: "15-digit VAT number starting and ending with 3",
    invoiceTitle: "Tax Invoice",
    simplifiedInvoiceTitle: "Simplified Tax Invoice",
    regionLabel: "Region",
    regions: [
      "Riyadh",
      "Makkah",
      "Madinah",
      "Eastern Province",
      "Asir",
      "Tabuk",
      "Qassim",
      "Hail",
      "Northern Borders",
      "Jazan",
      "Najran",
      "Al Bahah",
      "Al Jawf",
    ],
    postalLabel: "Postal code",
    dialCode: "+966",
    zatcaQr: true,
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "SA03 8000 0000 6080 1016 7519",
    returnName: "VAT return",
    returnPortal: "the ZATCA portal",
  },
  BH: {
    code: "BH",
    name: "Bahrain",
    group: "Gulf",
    enabled: true,
    taxSystem: "vat",
    taxName: "VAT",
    currency: "BHD",
    currencyDecimals: 3,
    standardRate: 10,
    rates: zeroAndStandard(10),
    taxIdLabel: "VAT Account No.",
    taxIdPlaceholder: "200000000000002",
    taxIdPattern: /^\d{15}$/,
    taxIdHint: "15-digit VAT account number",
    invoiceTitle: "Tax Invoice",
    regionLabel: "Governorate",
    regions: ["Capital", "Muharraq", "Northern", "Southern"],
    postalLabel: "Block / P.O. Box",
    dialCode: "+973",
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "BH67 BMAG 0000 1299 1234 56",
    returnName: "VAT return",
    returnPortal: "the NBR portal",
  },
  OM: {
    code: "OM",
    name: "Oman",
    group: "Gulf",
    enabled: true,
    taxSystem: "vat",
    taxName: "VAT",
    currency: "OMR",
    currencyDecimals: 3,
    standardRate: 5,
    rates: zeroAndStandard(5),
    taxIdLabel: "VATIN",
    taxIdPlaceholder: "OM1100000000",
    taxIdPattern: /^OM\d{10}$/,
    taxIdPrefix: "OM",
    taxIdHint: "VAT identification number (OM + 10 digits)",
    invoiceTitle: "Tax Invoice",
    regionLabel: "Governorate",
    regions: [
      "Muscat",
      "Dhofar",
      "Musandam",
      "Al Buraimi",
      "Ad Dakhiliyah",
      "North Al Batinah",
      "South Al Batinah",
      "North Ash Sharqiyah",
      "South Ash Sharqiyah",
      "Ad Dhahirah",
      "Al Wusta",
    ],
    postalLabel: "P.O. Box / Postal code",
    dialCode: "+968",
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "OM81 0180 0000 0129 9123 456",
    returnName: "VAT return",
    returnPortal: "the Tax Authority portal",
  },
  QA: {
    code: "QA",
    name: "Qatar",
    group: "Gulf",
    enabled: true,
    taxSystem: "none",
    taxName: "Tax",
    currency: "QAR",
    currencyDecimals: 2,
    standardRate: 0,
    rates: [{ rate: 0, label: "No VAT (0%)" }],
    taxIdLabel: "CR No.",
    taxIdPlaceholder: "123456",
    taxIdPattern: /^[0-9A-Z/]{1,20}$/,
    taxIdHint: "Commercial Registration number (optional)",
    invoiceTitle: "Invoice",
    regionLabel: "Municipality",
    regions: [
      "Doha",
      "Al Rayyan",
      "Al Wakrah",
      "Al Khor",
      "Al Shamal",
      "Umm Salal",
      "Al Daayen",
      "Al Shahaniya",
    ],
    postalLabel: "P.O. Box",
    dialCode: "+974",
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "QA58 DOHB 0000 1234 5678 90AB CDEF G",
    returnName: "Sales summary",
    returnPortal: "",
  },
  KW: {
    code: "KW",
    name: "Kuwait",
    group: "Gulf",
    enabled: true,
    taxSystem: "none",
    taxName: "Tax",
    currency: "KWD",
    currencyDecimals: 3,
    standardRate: 0,
    rates: [{ rate: 0, label: "No VAT (0%)" }],
    taxIdLabel: "CR No.",
    taxIdPlaceholder: "123456",
    taxIdPattern: /^[0-9A-Z/]{1,20}$/,
    taxIdHint: "Commercial Registration number (optional)",
    invoiceTitle: "Invoice",
    regionLabel: "Governorate",
    regions: ["Capital", "Hawalli", "Farwaniya", "Mubarak Al-Kabeer", "Ahmadi", "Jahra"],
    postalLabel: "P.O. Box",
    dialCode: "+965",
    arabic: true,
    ...GCC_BANK,
    bankAccountPlaceholder: "KW81 CBKU 0000 0000 0000 1234 5601 01",
    returnName: "Sales summary",
    returnPortal: "",
  },

  // ---------- United Kingdom ----------
  GB: {
    code: "GB",
    name: "United Kingdom",
    group: "United Kingdom",
    // GCC-only for now: kept so an existing business here keeps working
    enabled: false,
    taxSystem: "vat",
    taxName: "VAT",
    currency: "GBP",
    currencyDecimals: 2,
    standardRate: 20,
    rates: [
      { rate: 20, label: "Standard 20%" },
      { rate: 5, label: "Reduced 5%" },
      { rate: 0, label: "Zero-rated 0%" },
    ],
    taxIdLabel: "VAT Reg No.",
    taxIdPlaceholder: "GB123456789",
    taxIdPattern: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
    taxIdPrefix: "GB",
    taxIdHint: "VAT registration number: GB + 9 digits",
    invoiceTitle: "VAT Invoice",
    regionLabel: "Nation",
    regions: ["England", "Scotland", "Wales", "Northern Ireland"],
    postalLabel: "Postcode",
    dialCode: "+44",
    bankAccountLabel: "Account number / IBAN",
    bankCodeLabel: "Sort code / BIC",
    bankAccountPlaceholder: "12345678",
    returnName: "VAT return (9 boxes)",
    returnPortal: "HMRC with Making Tax Digital software",
  },

  // ---------- India ----------
  IN: {
    code: "IN",
    name: "India",
    group: "India",
    // GCC-only for now: kept so an existing business here keeps working
    enabled: false,
    taxSystem: "gst",
    taxName: "GST",
    currency: "INR",
    currencyDecimals: 2,
    standardRate: 18,
    rates: [
      { rate: 18, label: "18% (standard)" },
      { rate: 5, label: "5% (merit)" },
      { rate: 40, label: "40% (luxury / sin)" },
      { rate: 3, label: "3% (gold, silver, jewellery)" },
      { rate: 0.25, label: "0.25% (rough diamonds)" },
      { rate: 0, label: "Nil-rated 0%" },
    ],
    jewelleryRate: 3,
    taxIdLabel: "GSTIN",
    taxIdPlaceholder: "29ABCDE1234F1Z5",
    taxIdPattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    taxIdHint: "15-character GSTIN (state code + PAN + entity + Z + check)",
    invoiceTitle: "Tax Invoice",
    regionLabel: "State",
    regions: INDIA_STATES.map((s) => s.name),
    postalLabel: "PIN code",
    dialCode: "+91",
    aprilNumbering: true,
    bankAccountLabel: "Account number",
    bankCodeLabel: "IFSC",
    bankAccountPlaceholder: "50100123456789",
    returnName: "GSTR-3B summary",
    returnPortal: "the GST portal",
  },

  // ---------- European Union ----------
  AT: eu("AT", "Austria", 20, [13, 10], /^ATU\d{8}$/, "ATU12345678"),
  BE: eu("BE", "Belgium", 21, [12, 6], /^BE[01]\d{9}$/, "BE0123456789"),
  BG: eu("BG", "Bulgaria", 20, [9], /^BG\d{9,10}$/, "BG123456789"),
  HR: eu("HR", "Croatia", 25, [13, 5], /^HR\d{11}$/, "HR12345678901"),
  CY: eu("CY", "Cyprus", 19, [9, 5], /^CY\d{8}[A-Z]$/, "CY12345678X"),
  CZ: eu("CZ", "Czechia", 21, [12], /^CZ\d{8,10}$/, "CZ12345678", "CZK"),
  DK: eu("DK", "Denmark", 25, [], /^DK\d{8}$/, "DK12345678", "DKK"),
  EE: eu("EE", "Estonia", 24, [13, 9], /^EE\d{9}$/, "EE123456789"),
  FI: eu("FI", "Finland", 25.5, [14, 10], /^FI\d{8}$/, "FI12345678"),
  FR: eu("FR", "France", 20, [10, 5.5, 2.1], /^FR[0-9A-Z]{2}\d{9}$/, "FR12345678901"),
  DE: eu("DE", "Germany", 19, [7], /^DE\d{9}$/, "DE123456789"),
  GR: eu("GR", "Greece", 24, [13, 6], /^EL\d{9}$/, "EL123456789", "EUR", "EL"),
  HU: eu("HU", "Hungary", 27, [18, 5], /^HU\d{8}$/, "HU12345678", "HUF"),
  IE: eu("IE", "Ireland", 23, [13.5, 9], /^IE(\d{7}[A-W][A-I]?|\d[A-Z+*]\d{5}[A-W])$/, "IE1234567T"),
  IT: eu("IT", "Italy", 22, [10, 5, 4], /^IT\d{11}$/, "IT12345678901"),
  LV: eu("LV", "Latvia", 21, [12, 5], /^LV\d{11}$/, "LV12345678901"),
  LT: eu("LT", "Lithuania", 21, [9, 5], /^LT(\d{9}|\d{12})$/, "LT123456789"),
  LU: eu("LU", "Luxembourg", 17, [14, 8, 3], /^LU\d{8}$/, "LU12345678"),
  MT: eu("MT", "Malta", 18, [7, 5], /^MT\d{8}$/, "MT12345678"),
  NL: eu("NL", "Netherlands", 21, [9], /^NL\d{9}B\d{2}$/, "NL123456789B01"),
  PL: eu("PL", "Poland", 23, [8, 5], /^PL\d{10}$/, "PL1234567890", "PLN"),
  PT: eu("PT", "Portugal", 23, [13, 6], /^PT\d{9}$/, "PT123456789"),
  RO: eu("RO", "Romania", 21, [11], /^RO\d{2,10}$/, "RO1234567890", "RON"),
  SK: eu("SK", "Slovakia", 23, [19, 5], /^SK\d{10}$/, "SK1234567890"),
  SI: eu("SI", "Slovenia", 22, [9.5, 5], /^SI\d{8}$/, "SI12345678"),
  ES: eu("ES", "Spain", 21, [10, 4], /^ES[0-9A-Z]\d{7}[0-9A-Z]$/, "ESX1234567X"),
  SE: eu("SE", "Sweden", 25, [12, 6], /^SE\d{12}$/, "SE123456789001", "SEK"),
};

// Phone prefixes for the EU table
const EU_DIAL: Partial<Record<CountryCode, string>> = {
  AT: "+43", BE: "+32", BG: "+359", HR: "+385", CY: "+357", CZ: "+420", DK: "+45",
  EE: "+372", FI: "+358", FR: "+33", DE: "+49", GR: "+30", HU: "+36", IE: "+353",
  IT: "+39", LV: "+371", LT: "+370", LU: "+352", MT: "+356", NL: "+31", PL: "+48",
  PT: "+351", RO: "+40", SK: "+421", SI: "+386", ES: "+34", SE: "+46",
};
for (const [code, dial] of Object.entries(EU_DIAL)) {
  COUNTRIES[code as CountryCode].dialCode = dial;
}
// Forint amounts are invoiced in whole forints
COUNTRIES.HU.currencyDecimals = 0;

/**
 * Qatar and Kuwait have no VAT yet. When one of them introduces it, set its
 * rate here (e.g. QA: 5) and the country switches to VAT everywhere: tax
 * lines, "Tax Invoice" title, VAT number label and a VAT return.
 */
export const GCC_VAT_SWITCH: Partial<Record<"QA" | "KW", number>> = {};

for (const [code, rate] of Object.entries(GCC_VAT_SWITCH)) {
  if (!rate) continue;
  Object.assign(COUNTRIES[code as CountryCode], {
    taxSystem: "vat",
    taxName: "VAT",
    standardRate: rate,
    rates: zeroAndStandard(rate),
    taxIdLabel: "VAT No.",
    taxIdHint: "VAT registration number",
    invoiceTitle: "Tax Invoice",
    returnName: "VAT return",
  } satisfies Partial<CountryVatConfig>);
}

export const DEFAULT_COUNTRY: CountryCode = "AE";

export const COUNTRY_GROUPS: CountryGroup[] = ["Gulf", "United Kingdom", "Europe", "India"];

export const ENABLED_COUNTRIES = Object.values(COUNTRIES)
  .filter((c) => c.enabled)
  .sort(
    (a, b) =>
      COUNTRY_GROUPS.indexOf(a.group) - COUNTRY_GROUPS.indexOf(b.group) ||
      (a.group === "Gulf" ? 0 : a.name.localeCompare(b.name))
  );

/** The Gulf countries offered to new businesses (GCC-only for now). */
export const OFFERED_GROUPS: CountryGroup[] = COUNTRY_GROUPS.filter((g) => ENABLED_COUNTRIES.some((c) => c.group === g));

/**
 * Country select options. A business already set to a country that is no
 * longer offered (e.g. an older UK or India account) still sees its own
 * country in the list, so saving Settings never changes it by accident.
 */
export function countryOptions(keep?: string | null): { value: string; label: string }[] {
  const list = [...ENABLED_COUNTRIES];
  const current = keep ? COUNTRIES[keep.toUpperCase() as CountryCode] : undefined;
  if (current && !current.enabled) list.push(current);
  return list.map((c) => ({ value: c.code, label: c.name }));
}

/**
 * Where a customer or supplier is based. Gulf businesses also trade with the
 * rest of the world (exports, imports), so every country stays here: the GCC
 * first, then the others.
 */
export function partyCountryOptions(): { value: string; label: string }[] {
  const others = Object.values(COUNTRIES)
    .filter((c) => !c.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ENABLED_COUNTRIES, ...others].map((c) => ({ value: c.code, label: c.name }));
}

const TIME_ZONE_COUNTRY: Record<string, CountryCode> = {
  "Asia/Dubai": "AE",
  "Asia/Riyadh": "SA",
  "Asia/Bahrain": "BH",
  "Asia/Muscat": "OM",
  "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Europe/London": "GB",
  "Europe/Belfast": "GB",
  "Europe/Vienna": "AT",
  "Europe/Brussels": "BE",
  "Europe/Sofia": "BG",
  "Europe/Zagreb": "HR",
  "Asia/Nicosia": "CY",
  "Europe/Prague": "CZ",
  "Europe/Copenhagen": "DK",
  "Europe/Tallinn": "EE",
  "Europe/Helsinki": "FI",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Athens": "GR",
  "Europe/Budapest": "HU",
  "Europe/Dublin": "IE",
  "Europe/Rome": "IT",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
  "Europe/Luxembourg": "LU",
  "Europe/Malta": "MT",
  "Europe/Amsterdam": "NL",
  "Europe/Warsaw": "PL",
  "Europe/Lisbon": "PT",
  "Europe/Bucharest": "RO",
  "Europe/Bratislava": "SK",
  "Europe/Ljubljana": "SI",
  "Europe/Madrid": "ES",
  "Europe/Stockholm": "SE",
};

/** Best guess from the browser's time zone, for the sign-up form. Falls back to the UAE. */
export function guessCountryFromTimeZone(): CountryCode {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const guess = TIME_ZONE_COUNTRY[tz];
    // Only suggest a country new businesses can choose
    return guess && COUNTRIES[guess].enabled ? guess : DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

/** A country new businesses can sign up in (the six GCC countries for now). */
export function isOfferedCountry(code: unknown): code is CountryCode {
  return isCountryCode(code) && COUNTRIES[(code as string).toUpperCase() as CountryCode].enabled;
}

export function isCountryCode(code: unknown): code is CountryCode {
  return typeof code === "string" && code.toUpperCase() in COUNTRIES;
}

export function getCountryConfig(code: string | null | undefined): CountryVatConfig {
  const key = (code ?? "").toUpperCase() as CountryCode;
  return COUNTRIES[key] ?? COUNTRIES[DEFAULT_COUNTRY];
}

export function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s.\-]/g, "").toUpperCase();
}

/** Empty is valid (not every customer is registered). The country prefix may be left off. */
export function isValidTaxId(value: string | null | undefined, country: string | null | undefined): boolean {
  const v = normalizeTaxId(value);
  if (!v) return true;
  const cfg = getCountryConfig(country);
  if (cfg.taxIdPattern.test(v)) return true;
  return !!cfg.taxIdPrefix && !v.startsWith(cfg.taxIdPrefix) && cfg.taxIdPattern.test(cfg.taxIdPrefix + v);
}

/** India: the state of a GSTIN (first two digits), if it is one. */
export function indiaStateForCode(code: string): string | null {
  return INDIA_STATES.find((s) => s.code === code)?.name ?? null;
}

/**
 * India: the canonical state name for however it was written - "Gujarat",
 * "gujarat", "Gujarat (24)" or the code "24". Null when it is not a state.
 */
export function indiaStateName(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const code = /^\d{2}$/.test(v) ? v : /\((\d{2})\)\s*$/.exec(v)?.[1];
  if (code) return indiaStateForCode(code);
  return INDIA_STATES.find((s) => s.name.toLowerCase() === v.toLowerCase())?.name ?? null;
}

/** India: the state a GSTIN was issued in (its first two digits). */
export function indiaStateFromGstin(gstin: string | null | undefined): string | null {
  const v = (gstin ?? "").replace(/\s+/g, "").toUpperCase();
  return /^\d{2}[A-Z]/.test(v) ? indiaStateForCode(v.slice(0, 2)) : null;
}

/** India: "Karnataka (29)" for the place of supply line. */
export function indiaStateLabel(name: string | null | undefined): string {
  const hit = INDIA_STATES.find((s) => s.name.toLowerCase() === (name ?? "").trim().toLowerCase());
  return hit ? `${hit.name} (${hit.code})` : (name ?? "").trim();
}

/** Union territories without a legislature charge UTGST instead of SGST. */
export function isIndiaUnionTerritory(name: string | null | undefined): boolean {
  return !!INDIA_STATES.find((s) => s.ut && s.name.toLowerCase() === (name ?? "").trim().toLowerCase());
}
