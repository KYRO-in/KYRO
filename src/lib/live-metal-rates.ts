/**
 * Live market metal rates (Metals.Dev) - reference only.
 * Shop metal_rates remain the source of truth for invoices.
 */

import { COUNTRIES } from "@/lib/vat/countries";

export const TROY_OZ_TO_GRAMS = 31.1035;

/** Standard gold purity multipliers vs 24K fine gold. */
export const GOLD_PURITY_MULTIPLIERS: Record<string, number> = {
  "24k": 1,
  "22k": 0.916,
  "18k": 0.75,
  "14k": 0.585,
};

export type LiveMetalKind = "gold" | "silver" | "platinum" | "palladium" | "diamond";

/** Currency used when a business has none (rows are stored per currency). */
export const LIVE_RATES_CURRENCY = "AED";

/** Every currency a Kayyro business can bill in, plus US dollars. */
export const LIVE_CURRENCIES: readonly string[] = Array.from(
  new Set(["USD", ...Object.values(COUNTRIES).map((c) => c.currency)])
);

/** A supported upper-case currency code, or the default. Limits paid Metals.Dev calls to real currencies. */
export function normalizeLiveCurrency(code: unknown): string {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  return LIVE_CURRENCIES.includes(c) ? c : LIVE_RATES_CURRENCY;
}

/** Currencies fixed to the US dollar: units of currency per 1 USD. */
const USD_PEGS: Record<string, number> = {
  USD: 1,
  AED: 3.6725,
  SAR: 3.75,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.3845,
};

export type LiveMetalRateRow = {
  id: string;
  metal_type: string;
  karat_or_purity: string;
  /** Rate per gram in the row's currency (column name predates multi-currency) */
  rate_per_gram_inr: number;
  fetched_at: string;
  currency?: string;
};

export const LIVE_DISPLAY_SLOTS: {
  metal_type: LiveMetalKind;
  karat_or_purity: string;
  label: string;
  /** Maps to Today's Rates draft key when copyable */
  draftKey?: `${"gold" | "silver"}|${string}`;
  accent: string;
  chipBg: string;
  hero?: boolean;
}[] = [
  {
    metal_type: "gold",
    karat_or_purity: "24k",
    label: "Gold 24K",
    draftKey: "gold|24k",
    accent: "#C9A227",
    chipBg: "rgba(201,162,39,0.16)",
    hero: true,
  },
  {
    metal_type: "gold",
    karat_or_purity: "22k",
    label: "Gold 22K",
    draftKey: "gold|22k",
    accent: "#C9A227",
    chipBg: "rgba(201,162,39,0.16)",
  },
  {
    metal_type: "gold",
    karat_or_purity: "18k",
    label: "Gold 18K",
    draftKey: "gold|18k",
    accent: "#C9A227",
    chipBg: "rgba(201,162,39,0.16)",
  },
  {
    metal_type: "silver",
    karat_or_purity: "999",
    label: "Silver",
    draftKey: "silver|999",
    accent: "#9AA5B1",
    chipBg: "rgba(154,165,177,0.18)",
  },
  {
    metal_type: "platinum",
    karat_or_purity: "999",
    label: "Platinum",
    accent: "#B8C4D4",
    chipBg: "rgba(184,196,212,0.2)",
  },
  {
    metal_type: "palladium",
    karat_or_purity: "999",
    label: "Palladium",
    accent: "#5C6370",
    chipBg: "rgba(92,99,112,0.18)",
  },
  {
    metal_type: "diamond",
    karat_or_purity: "1ct",
    label: "Diamond 1ct",
    accent: "#7EB6D9",
    chipBg: "rgba(126,182,217,0.2)",
  },
];

export type LiveRateChange = {
  percent: number;
  direction: "up" | "down";
};

/**
 * Compare latest rate to the closest fetch ~24h earlier.
 * Returns null when there isn't enough history (never invent 0%).
 */
export function calcLiveRateChange(
  history: LiveMetalRateRow[],
  metalType: string,
  purity: string,
  latest?: LiveMetalRateRow | null
): LiveRateChange | null {
  const series = history
    .filter((r) => r.metal_type === metalType && r.karat_or_purity === purity)
    .sort((a, b) => a.fetched_at.localeCompare(b.fetched_at));
  if (!series.length) return null;

  const current = latest ?? series[series.length - 1];
  if (!current) return null;

  const currentMs = new Date(current.fetched_at).getTime();
  if (!Number.isFinite(currentMs)) return null;
  const targetMs = currentMs - 24 * 60 * 60 * 1000;

  let prior: LiveMetalRateRow | null = null;
  let bestDelta = Infinity;
  for (const row of series) {
    if (row.id === current.id) continue;
    const t = new Date(row.fetched_at).getTime();
    if (!Number.isFinite(t) || t >= currentMs) continue;
    // Prefer entries within 12–36h window centered on 24h ago
    const delta = Math.abs(t - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      prior = row;
    }
  }

  // Need a prior point at least ~12h older (avoid same-session noise)
  if (!prior) return null;
  const priorMs = new Date(prior.fetched_at).getTime();
  if (currentMs - priorMs < 12 * 60 * 60 * 1000) return null;

  const cur = Number(current.rate_per_gram_inr);
  const old = Number(prior.rate_per_gram_inr);
  if (!(cur > 0) || !(old > 0) || cur === old) return null;

  const percent = Math.round((((cur - old) / old) * 100 + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(percent) || percent === 0) return null;
  return {
    percent: Math.abs(percent),
    direction: percent > 0 ? "up" : "down",
  };
}

export const TICKER_SLOTS = [
  { metal_type: "gold", karat_or_purity: "24k", label: "Gold 24K", accent: "#C9A227" },
  { metal_type: "gold", karat_or_purity: "22k", label: "Gold 22K", accent: "#C9A227" },
  { metal_type: "silver", karat_or_purity: "999", label: "Silver", accent: "#9AA5B1" },
] as const;

export function tozToPerGramInr(pricePerTozInr: number): number {
  return Math.round(((pricePerTozInr / TROY_OZ_TO_GRAMS) + Number.EPSILON) * 100) / 100;
}

export function goldKaratPerGram(fine24kPerGram: number, karat: string): number {
  const m = GOLD_PURITY_MULTIPLIERS[karat] ?? 1;
  return Math.round((fine24kPerGram * m + Number.EPSILON) * 100) / 100;
}

export type MetalsDevLatestResponse = {
  status: string;
  currency?: string;
  unit?: string;
  timestamp?: string;
  metals?: Record<string, number>;
  error_code?: string;
  error_message?: string;
};

export type MetalsDevTimeseriesResponse = {
  status: string;
  currency?: string;
  unit?: string;
  rates?: Record<
    string,
    {
      date?: string;
      metals?: Record<string, number>;
      currencies?: Record<string, number>;
    }
  >;
  error_code?: string;
  error_message?: string;
};

/**
 * Convert a day's metals into live_metal_rates rows in the target currency.
 * Input is either already in the target currency, or USD/toz plus a `currencies`
 * map of USD per one unit of each currency (Metals.Dev timeseries).
 */
export function buildLiveRateInsertsFromMetals(
  metals: Record<string, number>,
  fetchedAt: string,
  opts?: { currency?: string; currencies?: Record<string, number>; unit?: string; target?: string }
): Omit<LiveMetalRateRow, "id">[] {
  let goldToz = Number(metals.gold);
  let silverToz = Number(metals.silver);
  let platinumToz = Number(metals.platinum);
  let palladiumToz = Number(metals.palladium);
  const diamondRaw = Number(
    metals.diamond ?? metals.diamond_1ct ?? metals.diamonds ?? NaN
  );

  // Timeseries often returns USD toz + currencies[AED] as USD-per-AED (i.e. 0.272 ≈ 1/3.6725)
  const target = (opts?.target ?? LIVE_RATES_CURRENCY).toUpperCase();
  const currency = (opts?.currency ?? "USD").toUpperCase();
  // The timeseries payload sometimes omits the exchange rate. Without a conversion the
  // day would be stored as US dollars and show up as a huge fake jump, so fall back to a
  // fixed peg (Gulf currencies are pegged to USD) and otherwise skip the day.
  const fxUsdPerTarget = Number(opts?.currencies?.[target]) || (USD_PEGS[target] ? 1 / USD_PEGS[target] : NaN);
  if (currency !== target) {
    const targetPerUsd = fxUsdPerTarget ? 1 / fxUsdPerTarget : NaN;
    if (!(Number.isFinite(targetPerUsd) && targetPerUsd > 0)) return [];
    goldToz *= targetPerUsd;
    silverToz *= targetPerUsd;
    platinumToz *= targetPerUsd;
    palladiumToz *= targetPerUsd;
  }

  const unit = (opts?.unit ?? "toz").toLowerCase();
  const toPerGram =
    unit === "g"
      ? (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
      : tozToPerGramInr;

  if (![goldToz, silverToz, platinumToz, palladiumToz].every((n) => Number.isFinite(n) && n > 0)) {
    return [];
  }

  const gold24 = toPerGram(goldToz);
  const rows: Omit<LiveMetalRateRow, "id">[] = [
    { metal_type: "gold", karat_or_purity: "24k", rate_per_gram_inr: gold24, fetched_at: fetchedAt },
    {
      metal_type: "gold",
      karat_or_purity: "22k",
      rate_per_gram_inr: goldKaratPerGram(gold24, "22k"),
      fetched_at: fetchedAt,
    },
    {
      metal_type: "gold",
      karat_or_purity: "18k",
      rate_per_gram_inr: goldKaratPerGram(gold24, "18k"),
      fetched_at: fetchedAt,
    },
    {
      metal_type: "gold",
      karat_or_purity: "14k",
      rate_per_gram_inr: goldKaratPerGram(gold24, "14k"),
      fetched_at: fetchedAt,
    },
    {
      metal_type: "silver",
      karat_or_purity: "999",
      rate_per_gram_inr: toPerGram(silverToz),
      fetched_at: fetchedAt,
    },
    {
      metal_type: "platinum",
      karat_or_purity: "999",
      rate_per_gram_inr: toPerGram(platinumToz),
      fetched_at: fetchedAt,
    },
    {
      metal_type: "palladium",
      karat_or_purity: "999",
      rate_per_gram_inr: toPerGram(palladiumToz),
      fetched_at: fetchedAt,
    },
  ];

  if (Number.isFinite(diamondRaw) && diamondRaw > 0) {
    // Prefer target-currency/carat if API ever exposes diamond; else convert from USD
    const diamondInr =
      currency === target
        ? Math.round((diamondRaw + Number.EPSILON) * 100) / 100
        : fxUsdPerTarget
          ? Math.round((diamondRaw / fxUsdPerTarget + Number.EPSILON) * 100) / 100
          : NaN;
    if (Number.isFinite(diamondInr) && diamondInr > 0) {
      rows.push({
        metal_type: "diamond",
        karat_or_purity: "1ct",
        rate_per_gram_inr: diamondInr,
        fetched_at: fetchedAt,
      });
    }
  }

  return rows;
}

/** Build insert rows from a Metals.Dev /v1/latest response (requested currency, toz). */
export function buildLiveRateInserts(
  data: MetalsDevLatestResponse,
  fetchedAt = new Date().toISOString(),
  target = data.currency ?? LIVE_RATES_CURRENCY
): Omit<LiveMetalRateRow, "id">[] {
  const rows = buildLiveRateInsertsFromMetals(data.metals ?? {}, fetchedAt, {
    currency: data.currency,
    unit: data.unit,
    target,
  });
  if (!rows.length) {
    throw new Error("Metals.Dev response missing gold/silver/platinum/palladium prices");
  }
  return rows;
}

/** Build 7-day history rows from a timeseries payload (one snapshot per calendar day). */
export function buildTimeseriesHistoryInserts(
  data: MetalsDevTimeseriesResponse,
  target = LIVE_RATES_CURRENCY
): Omit<LiveMetalRateRow, "id">[] {
  const out: Omit<LiveMetalRateRow, "id">[] = [];
  const rates = data.rates ?? {};
  for (const [dateKey, day] of Object.entries(rates)) {
    const metals = day.metals ?? {};
    const fetchedAt = `${(day.date || dateKey).slice(0, 10)}T12:00:00.000Z`;
    out.push(
      ...buildLiveRateInsertsFromMetals(metals, fetchedAt, {
        currency: data.currency,
        unit: data.unit,
        currencies: day.currencies,
        target,
      })
    );
  }
  return out;
}

/**
 * Jewellery diamond reference (per carat) derived from fine gold.
 * Metals.Dev has no diamond spot; this keeps the Diamond trend usable as a
 * market-linked index (still reference-only, never used on invoices unless copied).
 * Factor chosen so 1ct index sits in a familiar retail ballpark vs gold per gram.
 */
export function diamondIndexFromGold24(gold24PerGramInr: number): number {
  const perCt = gold24PerGramInr * 12;
  return Math.round((perCt + Number.EPSILON) * 100) / 100;
}

export function withDiamondIndexRows(
  rows: Omit<LiveMetalRateRow, "id">[]
): Omit<LiveMetalRateRow, "id">[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.metal_type === "gold" && row.karat_or_purity === "24k") {
      byDay.set(row.fetched_at.slice(0, 10), Number(row.rate_per_gram_inr));
    }
  }
  const extra: Omit<LiveMetalRateRow, "id">[] = [];
  for (const row of rows) {
    if (row.metal_type !== "gold" || row.karat_or_purity !== "24k") continue;
    const day = row.fetched_at.slice(0, 10);
    const gold = byDay.get(day);
    if (!(gold && gold > 0)) continue;
    extra.push({
      metal_type: "diamond",
      karat_or_purity: "1ct",
      rate_per_gram_inr: diamondIndexFromGold24(gold),
      fetched_at: row.fetched_at,
    });
  }
  // Avoid duplicating if API already sent diamond
  const hasApiDiamond = rows.some((r) => r.metal_type === "diamond");
  if (hasApiDiamond) return rows;
  return [...rows, ...extra];
}

export const LIVE_RATE_CACHE_MS = 10 * 60 * 1000;

export function isLiveRatesStale(fetchedAt: string | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return true;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now - t > LIVE_RATE_CACHE_MS;
}
