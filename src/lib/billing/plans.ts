import type { Organization } from "@/lib/types";

export type PaidPlanId = "starter" | "pro" | "business";
export type PlanId = "free" | PaidPlanId;
export type BillingInterval = "monthly" | "annual";

export type PlanLimits = {
  maxInvoicesPerMonth: number | null; // null = unlimited
  maxActiveProducts: number | null;
  /** Active employees in Staff & Attendance (null = unlimited) */
  maxEmployees: number | null;
  /** Questions to Ask Kayyro per calendar month */
  maxAiQuestions: number;
};

/** Capability flags used for comparison checklist + future gating. */
export type PlanCapabilities = {
  inventoryGst: boolean;
  gstrExport: boolean;
  purchasesCreditNotes: boolean;
  multiWarehouse: boolean;
  emailSupport: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
  /** Point of sale counter screen */
  pos: boolean;
  /** Staff check-in / check-out with photos */
  attendance: boolean;
  /** Ask Kayyro, the AI assistant */
  aiAssistant: boolean;
};

/**
 * Two price lists. Businesses in India pay in rupees; everyone else (Gulf, UK,
 * Europe) pays in dirhams. The amount actually charged comes from the Razorpay
 * plan behind each env var - create those plans with the same amounts so the
 * page and the checkout always agree:
 *   AED: RAZORPAY_PLAN_STARTER / _PRO / _BUSINESS
 *   INR: RAZORPAY_PLAN_STARTER_INR / _PRO_INR / _BUSINESS_INR
 */
export type PriceRegion = "global" | "india";

export const PRICE_REGIONS: Record<PriceRegion, { currency: string; locale: string; label: string }> = {
  global: { currency: "AED", locale: "en-AE", label: "Gulf, UK & Europe (AED)" },
  india: { currency: "INR", locale: "en-IN", label: "India (₹)" },
};

/** Monthly and yearly list prices per region. Yearly = 10 months (2 free). */
export const REGION_PRICES: Record<PriceRegion, Record<PaidPlanId, { monthly: number; annual: number }>> = {
  global: {
    starter: { monthly: 49, annual: 490 },
    pro: { monthly: 99, annual: 990 },
    business: { monthly: 199, annual: 1990 },
  },
  india: {
    starter: { monthly: 499, annual: 4999 },
    pro: { monthly: 999, annual: 9999 },
    business: { monthly: 1999, annual: 19999 },
  },
};

/**
 * Ask Kayyro questions per month. India's allowance is lower because each answer
 * costs the same in dollars while the rupee price is lower. Mirrors
 * plan_limit('ai_questions' / 'ai_questions_in') in migration 043.
 */
export const AI_QUESTIONS: Record<PriceRegion, Record<PlanId, number>> = {
  global: { free: 30, starter: 100, pro: 400, business: 1500 },
  india: { free: 20, starter: 50, pro: 200, business: 600 },
};

export function priceRegionFor(country: string | null | undefined): PriceRegion {
  return (country ?? "").toUpperCase() === "IN" ? "india" : "global";
}

export function aiQuestionsFor(plan: string | null | undefined, country: string | null | undefined): number {
  const id: PlanId = plan === "starter" || plan === "pro" || plan === "business" ? plan : "free";
  return AI_QUESTIONS[priceRegionFor(country)][id];
}

/** @deprecated Use PRICE_REGIONS[region].currency */
export const PLAN_CURRENCY = PRICE_REGIONS.global.currency;

export type PlanDefinition = {
  id: PaidPlanId;
  name: string;
  /** Monthly list price in PLAN_CURRENCY */
  priceMonthly: number;
  /** Annual billed price in PLAN_CURRENCY when paying yearly */
  priceAnnual: number;
  /**
   * Optional strikethrough “was” price for monthly.
   * Leave undefined/null when no promo is running — never invent a fake discount.
   */
  compareAtMonthly?: number | null;
  /** Optional strikethrough “was” price for annual (e.g. 12× monthly). */
  compareAtAnnual?: number | null;
  periodLabel: string;
  description: string;
  /** @deprecated Prefer PLAN_CHECKLIST_FEATURES — kept for simple bullet fallbacks */
  features: string[];
  limits: PlanLimits;
  capabilities: PlanCapabilities;
  /** Highlight this card as the recommended / most popular tier */
  recommended?: boolean;
  envPlanIdKey: "RAZORPAY_PLAN_STARTER" | "RAZORPAY_PLAN_PRO" | "RAZORPAY_PLAN_BUSINESS";
};

export type PlanPriceView = {
  /** Amount charged for the selected interval */
  price: number;
  /** Strikethrough amount, if a real compare-at is configured */
  compareAt: number | null;
  /** Effective price per month (annual_price / 12 when annual) */
  perMonth: number;
  periodSuffix: string;
};

/** Single source of truth for tier names, prices, limits, and capabilities. */
export const PAID_PLANS: Record<PaidPlanId, PlanDefinition> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 49,
    priceAnnual: 490,
    compareAtMonthly: null,
    compareAtAnnual: 588,
    periodLabel: "/ month",
    description: "For small teams getting started with VAT billing.",
    features: [
      "Up to 50 invoices / month",
      "Up to 100 active products",
      "Inventory & VAT tax invoices",
      "Email support",
    ],
    limits: { maxInvoicesPerMonth: 50, maxActiveProducts: 100, maxEmployees: 5, maxAiQuestions: 100 },
    capabilities: {
      inventoryGst: true,
      gstrExport: true,
      purchasesCreditNotes: false,
      multiWarehouse: false,
      emailSupport: true,
      prioritySupport: false,
      dedicatedSupport: false,
      pos: true,
      attendance: true,
      aiAssistant: true,
    },
    envPlanIdKey: "RAZORPAY_PLAN_STARTER",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 99,
    priceAnnual: 990,
    compareAtMonthly: null,
    compareAtAnnual: 1188,
    periodLabel: "/ month",
    description: "Growing businesses with higher volume.",
    features: [
      "Up to 300 invoices / month",
      "Unlimited products",
      "Purchases & credit notes",
      "Priority support",
    ],
    limits: { maxInvoicesPerMonth: 300, maxActiveProducts: null, maxEmployees: 15, maxAiQuestions: 400 },
    capabilities: {
      inventoryGst: true,
      gstrExport: true,
      purchasesCreditNotes: true,
      multiWarehouse: false,
      emailSupport: true,
      prioritySupport: true,
      dedicatedSupport: false,
      pos: true,
      attendance: true,
      aiAssistant: true,
    },
    recommended: true,
    envPlanIdKey: "RAZORPAY_PLAN_PRO",
  },
  business: {
    id: "business",
    name: "Business",
    priceMonthly: 199,
    priceAnnual: 1990,
    compareAtMonthly: null,
    compareAtAnnual: 2388,
    periodLabel: "/ month",
    description: "Unlimited usage for established operations.",
    features: [
      "Unlimited invoices",
      "Unlimited products",
      "Multi-warehouse ready",
      "Dedicated support",
    ],
    limits: { maxInvoicesPerMonth: null, maxActiveProducts: null, maxEmployees: null, maxAiQuestions: 1500 },
    capabilities: {
      inventoryGst: true,
      gstrExport: true,
      purchasesCreditNotes: true,
      multiWarehouse: true,
      emailSupport: true,
      prioritySupport: true,
      dedicatedSupport: true,
      pos: true,
      attendance: true,
      aiAssistant: true,
    },
    envPlanIdKey: "RAZORPAY_PLAN_BUSINESS",
  },
};

export const PAID_PLAN_ORDER: PaidPlanId[] = ["starter", "pro", "business"];

export const TRIAL_LIMITS: PlanLimits = {
  maxInvoicesPerMonth: 50,
  maxActiveProducts: 100,
  maxEmployees: 5,
  maxAiQuestions: 30,
};

export type PlanChecklistItem = {
  id: string;
  label: string;
  included: boolean;
  /** Comparison table: row name shared by every plan, and this plan's short value */
  rowLabel?: string;
  value?: string;
};

/**
 * Comparison checklist derived from each plan’s limits + capabilities
 * so the cards stay in sync with what gating actually uses.
 */
export function getPlanChecklist(planId: PaidPlanId, region: PriceRegion = "global"): PlanChecklistItem[] {
  const plan = PAID_PLANS[planId];
  const { limits, capabilities } = plan;

  const invoiceLabel =
    limits.maxInvoicesPerMonth == null
      ? "Unlimited invoices"
      : `Up to ${limits.maxInvoicesPerMonth} invoices / month`;

  const productLabel =
    limits.maxActiveProducts == null
      ? "Unlimited products"
      : `Up to ${limits.maxActiveProducts} active products`;

  const employeeLabel =
    limits.maxEmployees == null
      ? "Unlimited staff attendance"
      : `Attendance for up to ${limits.maxEmployees} staff`;

  return [
    {
      id: "invoices",
      label: invoiceLabel,
      included: true,
      rowLabel: "Invoices / month",
      value: limits.maxInvoicesPerMonth == null ? "Unlimited" : String(limits.maxInvoicesPerMonth),
    },
    {
      id: "products",
      label: productLabel,
      included: true,
      rowLabel: "Active products",
      value: limits.maxActiveProducts == null ? "Unlimited" : String(limits.maxActiveProducts),
    },
    { id: "pos", label: "Point of sale counter", included: capabilities.pos },
    {
      id: "attendance",
      label: `${employeeLabel}, with photos`,
      included: capabilities.attendance,
      rowLabel: "Staff attendance with photos",
      value: limits.maxEmployees == null ? "Unlimited" : `${limits.maxEmployees} staff`,
    },
    {
      id: "ai",
      label: `Ask Kayyro AI: ${AI_QUESTIONS[region][planId].toLocaleString("en-US")} questions / month`,
      included: capabilities.aiAssistant,
      rowLabel: "Ask Kayyro AI questions / month",
      value: AI_QUESTIONS[region][planId].toLocaleString("en-US"),
    },
    {
      id: "inventory_gst",
      label: "Inventory & VAT tax invoices",
      included: capabilities.inventoryGst,
    },
    {
      id: "gstr_export",
      label: "VAT 201 ready exports",
      included: capabilities.gstrExport,
    },
    {
      id: "purchases",
      label: "Purchases & credit notes",
      included: capabilities.purchasesCreditNotes,
    },
    {
      id: "multi_warehouse",
      label: "Multi-warehouse ready",
      included: capabilities.multiWarehouse,
    },
    {
      id: "email_support",
      label: "Email support",
      included: capabilities.emailSupport,
    },
    {
      id: "priority_support",
      label: "Priority support",
      included: capabilities.prioritySupport,
    },
    {
      id: "dedicated_support",
      label: "Dedicated support",
      included: capabilities.dedicatedSupport,
    },
  ];
}

export function getPlanPrice(
  plan: PlanDefinition,
  interval: BillingInterval,
  region: PriceRegion = "global"
): PlanPriceView {
  const list = REGION_PRICES[region][plan.id];
  if (interval === "annual") {
    const price = list.annual;
    // Strike-through yearly price is the honest "12 × monthly"
    const compareAt = list.monthly * 12 > price ? list.monthly * 12 : null;
    return {
      price,
      compareAt,
      perMonth: Math.round((price / 12) * 100) / 100,
      periodSuffix: "/ year",
    };
  }

  const price = list.monthly;
  const compareAt =
    region === "global" && plan.compareAtMonthly != null && plan.compareAtMonthly > price
      ? plan.compareAtMonthly
      : null;
  return {
    price,
    compareAt,
    perMonth: price,
    periodSuffix: "/ month",
  };
}

export function getPlanLimits(plan: Organization["plan"] | string | null | undefined): PlanLimits {
  if (plan === "starter") return PAID_PLANS.starter.limits;
  if (plan === "pro") return PAID_PLANS.pro.limits;
  if (plan === "business") return PAID_PLANS.business.limits;
  // free / trial / unknown
  return TRIAL_LIMITS;
}

/** Trial / free use Starter capabilities so pricing and enforcement stay aligned. */
export const TRIAL_CAPABILITIES: PlanCapabilities = { ...PAID_PLANS.starter.capabilities };

export function getPlanCapabilities(
  plan: Organization["plan"] | string | null | undefined
): PlanCapabilities {
  if (plan === "starter") return PAID_PLANS.starter.capabilities;
  if (plan === "pro") return PAID_PLANS.pro.capabilities;
  if (plan === "business") return PAID_PLANS.business.capabilities;
  return TRIAL_CAPABILITIES;
}

export function hasPlanCapability(
  plan: Organization["plan"] | string | null | undefined,
  capability: keyof PlanCapabilities
): boolean {
  return !!getPlanCapabilities(plan)[capability];
}

export function capabilityUpgradeMessage(capability: keyof PlanCapabilities): string {
  switch (capability) {
    case "purchasesCreditNotes":
      return "Purchases & credit notes are available on Pro and Business - upgrade at Settings → Billing.";
    case "multiWarehouse":
      return "Multiple warehouses are available on the Business plan - upgrade at Settings → Billing.";
    case "gstrExport":
      return "VAT return exports are not included on your current plan - upgrade at Settings → Billing.";
    case "prioritySupport":
      return "Priority support is available on Pro and Business - upgrade at Settings → Billing.";
    case "dedicatedSupport":
      return "Dedicated support is available on the Business plan - upgrade at Settings → Billing.";
    default:
      return "This feature is not included on your current plan - upgrade at Settings → Billing.";
  }
}

export function razorpayPlanEnvKey(plan: PaidPlanId, region: PriceRegion = "global"): string {
  const base = PAID_PLANS[plan].envPlanIdKey;
  return region === "india" ? `${base}_INR` : base;
}

export function getRazorpayPlanId(plan: PaidPlanId, region: PriceRegion = "global"): string {
  const key = razorpayPlanEnvKey(plan, region);
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env ${key}. Create the plan in Razorpay and add it to the environment variables.`);
  }
  return value;
}

export function mapRazorpayPlanIdToTier(razorpayPlanId: string | undefined | null): PaidPlanId | null {
  if (!razorpayPlanId) return null;
  for (const tier of PAID_PLAN_ORDER) {
    for (const region of ["global", "india"] as const) {
      const id = process.env[razorpayPlanEnvKey(tier, region)];
      if (id && razorpayPlanId === id) return tier;
    }
  }
  return null;
}

export function formatPlanPrice(amount: number, region: PriceRegion = "global"): string {
  const { currency, locale } = PRICE_REGIONS[region];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
