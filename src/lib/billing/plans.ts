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
  /** Invoices Kayyro Collect chases automatically per month (0 = manual only, null = unlimited) */
  maxCollectInvoices: number | null;
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
  /** Kayyro Collect sends reminders on a schedule (Starter reminds by hand) */
  collectAuto: boolean;
  /** Kayyro Collect risk badges and the 9:00 daily summary */
  collectInsights: boolean;
};

/**
 * One price list, in UAE dirhams, for every business. The amount actually
 * charged comes from the price behind each environment variable - create them
 * with the same amounts so the page and checkout always agree:
 *   Stripe:   STRIPE_PRICE_STARTER / _PRO / _BUSINESS, and the same + _ANNUAL
 *   Razorpay: RAZORPAY_PLAN_STARTER / _PRO / _BUSINESS, and the same + _ANNUAL
 * Annual = pay 10 months, get 12 (2 months free).
 */
export const PLAN_CURRENCY = "AED";
const PLAN_LOCALE = "en-AE";

export const PLAN_PRICES: Record<PaidPlanId, { monthly: number; annual: number }> = {
  starter: { monthly: 49, annual: 490 },
  pro: { monthly: 99, annual: 990 },
  business: { monthly: 199, annual: 1990 },
};

/** Shown on the Annual toggle */
export const ANNUAL_SAVING_LABEL = "Save 2 months";

/**
 * Ask Kayyro questions per month. A business set up in India before Kayyro
 * became GCC-only keeps India's lower allowance, which the database enforces
 * (plan_limit('ai_questions' / 'ai_questions_in') in migration 043).
 */
export type AiAllowanceRegion = "global" | "india";

export const AI_QUESTIONS: Record<AiAllowanceRegion, Record<PlanId, number>> = {
  global: { free: 30, starter: 100, pro: 400, business: 1500 },
  india: { free: 20, starter: 50, pro: 200, business: 600 },
};

export function aiAllowanceRegionFor(country: string | null | undefined): AiAllowanceRegion {
  return (country ?? "").toUpperCase() === "IN" ? "india" : "global";
}

export function aiQuestionsFor(plan: string | null | undefined, country: string | null | undefined): number {
  const id: PlanId = plan === "starter" || plan === "pro" || plan === "business" ? plan : "free";
  return AI_QUESTIONS[aiAllowanceRegionFor(country)][id];
}


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
    limits: { maxInvoicesPerMonth: 50, maxActiveProducts: 100, maxEmployees: 5, maxAiQuestions: 100, maxCollectInvoices: 0 },
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
      collectAuto: false,
      collectInsights: false,
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
    limits: { maxInvoicesPerMonth: 300, maxActiveProducts: null, maxEmployees: 15, maxAiQuestions: 400, maxCollectInvoices: 100 },
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
      collectAuto: true,
      collectInsights: false,
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
    limits: { maxInvoicesPerMonth: null, maxActiveProducts: null, maxEmployees: null, maxAiQuestions: 1500, maxCollectInvoices: null },
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
      collectAuto: true,
      collectInsights: true,
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
  // Matches plan_limit('collect_invoices') for trials (migration 049)
  maxCollectInvoices: 100,
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
export function getPlanChecklist(planId: PaidPlanId, region: AiAllowanceRegion = "global"): PlanChecklistItem[] {
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
      id: "collect",
      label:
        limits.maxCollectInvoices === 0
          ? "Kayyro Collect: one-tap payment reminders"
          : limits.maxCollectInvoices == null
            ? "Kayyro Collect: automatic reminders, unlimited invoices"
            : `Kayyro Collect: automatic reminders, ${limits.maxCollectInvoices} invoices / month`,
      included: true,
      rowLabel: "Kayyro Collect invoices chased / month",
      value:
        limits.maxCollectInvoices === 0
          ? "Manual"
          : limits.maxCollectInvoices == null
            ? "Unlimited"
            : String(limits.maxCollectInvoices),
    },
    {
      id: "collect_ai",
      label: "Kayyro Collect reads customer replies with AI",
      included: capabilities.collectAuto,
    },
    {
      id: "collect_insights",
      label: "Kayyro Collect risk badges & 9:00 daily summary",
      included: capabilities.collectInsights,
    },
    {
      id: "inventory_gst",
      label: "Inventory & VAT tax invoices",
      included: capabilities.inventoryGst,
    },
    {
      id: "gstr_export",
      label: "VAT return exports (UAE, Saudi, Bahrain, Oman)",
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

export function getPlanPrice(plan: PlanDefinition, interval: BillingInterval): PlanPriceView {
  const list = PLAN_PRICES[plan.id];
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
  const compareAt = plan.compareAtMonthly != null && plan.compareAtMonthly > price ? plan.compareAtMonthly : null;
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

/**
 * Trial / free use Starter capabilities so pricing and enforcement stay aligned,
 * except Kayyro Collect: a trial can try automatic reminders like Pro
 * (the database gives trials the Pro allowance too, migration 049).
 */
export const TRIAL_CAPABILITIES: PlanCapabilities = { ...PAID_PLANS.starter.capabilities, collectAuto: true };

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
    case "collectAuto":
      return "Automatic payment reminders are available on Pro and Business - upgrade at Settings → Billing.";
    case "collectInsights":
      return "Collect risk badges and the daily summary are available on the Business plan - upgrade at Settings → Billing.";
    case "dedicatedSupport":
      return "Dedicated support is available on the Business plan - upgrade at Settings → Billing.";
    default:
      return "This feature is not included on your current plan - upgrade at Settings → Billing.";
  }
}

export function razorpayPlanEnvKey(plan: PaidPlanId, interval: BillingInterval = "monthly"): string {
  const base = PAID_PLANS[plan].envPlanIdKey;
  return interval === "annual" ? `${base}_ANNUAL` : base;
}

export function getRazorpayPlanId(plan: PaidPlanId, interval: BillingInterval = "monthly"): string {
  const key = razorpayPlanEnvKey(plan, interval);
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env ${key}. Create the plan in Razorpay and add it to the environment variables.`);
  }
  return value;
}

export function mapRazorpayPlanIdToTier(razorpayPlanId: string | undefined | null): PaidPlanId | null {
  if (!razorpayPlanId) return null;
  for (const tier of PAID_PLAN_ORDER) {
    for (const interval of ["monthly", "annual"] as const) {
      const id = process.env[razorpayPlanEnvKey(tier, interval)];
      if (id && razorpayPlanId === id) return tier;
    }
  }
  return null;
}

/**
 * Stripe (AED): a recurring monthly and a recurring yearly Price per plan,
 * created in the Stripe Dashboard with the same amounts as PLAN_PRICES. Their
 * ids go in STRIPE_PRICE_STARTER / _PRO / _BUSINESS and the same + _ANNUAL.
 */
export function stripePriceEnvKey(plan: PaidPlanId, interval: BillingInterval = "monthly"): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}${interval === "annual" ? "_ANNUAL" : ""}`;
}

export function getStripePriceId(plan: PaidPlanId, interval: BillingInterval = "monthly"): string {
  const key = stripePriceEnvKey(plan, interval);
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing env ${key}. Create the monthly Price in Stripe and add its id to the environment variables.`);
  }
  return value;
}

export function mapStripePriceIdToTier(priceId: string | undefined | null): PaidPlanId | null {
  if (!priceId) return null;
  for (const tier of PAID_PLAN_ORDER) {
    for (const interval of ["monthly", "annual"] as const) {
      const id = process.env[stripePriceEnvKey(tier, interval)]?.trim();
      if (id && id === priceId) return tier;
    }
  }
  return null;
}

export function formatPlanPrice(amount: number): string {
  return new Intl.NumberFormat(PLAN_LOCALE, {
    style: "currency",
    currency: PLAN_CURRENCY,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
