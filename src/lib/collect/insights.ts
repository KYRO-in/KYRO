/**
 * Kayyro Collect insights (Business plan): late-payer risk and the owner's
 * daily summary. The risk level itself is decided by the database
 * (collect_risk_level, migration 051); this explains it in words.
 */
import { formatAmount, type CollectLang } from "@/lib/collect/templates";

export type RiskLevel = "low" | "medium" | "high";

export type CustomerRisk = {
  customer_id: string;
  customer_name: string;
  open_balance: number;
  overdue_amount: number;
  oldest_overdue_days: number;
  avg_days_late: number | null;
  paid_invoices: number;
  broken_promises: number;
  level: RiskLevel;
};

export function normaliseRisk(row: Record<string, unknown>): CustomerRisk {
  const level = row.level === "high" || row.level === "medium" ? row.level : "low";
  return {
    customer_id: String(row.customer_id),
    customer_name: String(row.customer_name ?? ""),
    open_balance: Number(row.open_balance ?? 0),
    overdue_amount: Number(row.overdue_amount ?? 0),
    oldest_overdue_days: Number(row.oldest_overdue_days ?? 0),
    avg_days_late: row.avg_days_late == null ? null : Number(row.avg_days_late),
    paid_invoices: Number(row.paid_invoices ?? 0),
    broken_promises: Number(row.broken_promises ?? 0),
    level,
  };
}

/** The reasons behind a risk level, most important first. */
export function riskReasons(r: CustomerRisk, currency: string, lang: CollectLang = "en"): string[] {
  const ar = lang === "ar";
  const out: string[] = [];
  if (r.avg_days_late != null && r.avg_days_late > 7) {
    const d = Math.round(r.avg_days_late);
    out.push(ar ? `يدفع متأخراً ${d} يوماً في المتوسط` : `Pays ${d} days late on average`);
  }
  if (r.broken_promises > 0) {
    out.push(
      ar
        ? `${r.broken_promises} وعد بالدفع لم يُنفَّذ`
        : `${r.broken_promises} broken promise${r.broken_promises === 1 ? "" : "s"} to pay`
    );
  }
  if (r.overdue_amount > 0) {
    const amount = formatAmount(r.overdue_amount, currency);
    out.push(
      ar
        ? `${amount} متأخرة، أقدمها منذ ${r.oldest_overdue_days} يوماً`
        : `${amount} overdue, the oldest ${r.oldest_overdue_days} days`
    );
  }
  if (!out.length) {
    out.push(
      r.paid_invoices > 0
        ? ar
          ? "يدفع في الموعد عادةً"
          : "Usually pays on time"
        : ar
          ? "لا يوجد سجل دفع بعد"
          : "No payment history yet"
    );
  }
  return out;
}

export type DailySummaryData = {
  date: string;
  currency: string;
  collected_yesterday: number;
  collected_month: number;
  needs_you: number;
  expected_week: number;
  overdue: number;
  top: string[];
};

export function normaliseSummary(raw: Record<string, unknown>): DailySummaryData {
  return {
    date: String(raw.date ?? ""),
    currency: String(raw.currency || "AED"),
    collected_yesterday: Number(raw.collected_yesterday ?? 0),
    collected_month: Number(raw.collected_month ?? 0),
    needs_you: Number(raw.needs_you ?? 0),
    expected_week: Number(raw.expected_week ?? 0),
    overdue: Number(raw.overdue ?? 0),
    top: Array.isArray(raw.top) ? raw.top.map(String).slice(0, 3) : [],
  };
}

/** The 9:00 message to the owner, in English or Arabic. */
export function renderDailySummary(d: DailySummaryData, input: { business: string; link: string; lang: CollectLang }) {
  const m = (n: number) => formatAmount(n, d.currency);
  if (input.lang === "ar") {
    const needs = d.needs_you === 0 ? "لا أحد يحتاجك اليوم" : d.needs_you === 1 ? "عميل واحد يحتاجك اليوم" : `${d.needs_you} عملاء يحتاجونك اليوم`;
    const lines = [
      `صباح الخير، ${input.business}.`,
      `أمس: تم تحصيل ${m(d.collected_yesterday)}. ${needs}. المتوقع هذا الأسبوع ${m(d.expected_week)}.`,
      `المتأخر حالياً: ${m(d.overdue)}. تم تحصيل ${m(d.collected_month)} هذا الشهر.`,
      ...(d.top.length ? ["", "يحتاجك اليوم:", ...d.top.map((x) => `- ${x}`)] : []),
      "",
      `افتح صفحة التحصيل: ${input.link}`,
    ];
    return { subject: `ملخص التحصيل اليوم · ${input.business}`, text: lines.join("\n") };
  }
  const needs =
    d.needs_you === 0 ? "No customers need you today" : d.needs_you === 1 ? "1 customer needs you today" : `${d.needs_you} customers need you today`;
  const lines = [
    `Good morning, ${input.business}.`,
    `Yesterday: ${m(d.collected_yesterday)} collected. ${needs}. ${m(d.expected_week)} expected this week.`,
    `Overdue now: ${m(d.overdue)}. Collected this month: ${m(d.collected_month)}.`,
    ...(d.top.length ? ["", "Needs you today:", ...d.top.map((x) => `- ${x}`)] : []),
    "",
    `Open Get Paid: ${input.link}`,
  ];
  return { subject: `Today's collections · ${input.business}`, text: lines.join("\n") };
}

/**
 * WhatsApp template for the summary (business-initiated, so it must be
 * approved by Meta). Variables: {{1}} business, {{2}} collected yesterday,
 * {{3}} customers who need you, {{4}} expected this week, {{5}} link.
 */
export const SUMMARY_TEMPLATE = {
  name: "kayyro_daily_summary",
  body: {
    en: "Good morning, {{1}}. Yesterday: {{2}} collected. {{3}} customer(s) need you today. {{4}} expected this week. Open Get Paid: {{5}}",
    ar: "صباح الخير، {{1}}. أمس: تم تحصيل {{2}}. عدد العملاء الذين يحتاجونك اليوم: {{3}}. المتوقع هذا الأسبوع {{4}}. افتح صفحة التحصيل: {{5}}",
  },
} as const;

export function summaryTemplateParams(d: DailySummaryData, business: string, link: string): string[] {
  return [business, formatAmount(d.collected_yesterday, d.currency), String(d.needs_you), formatAmount(d.expected_week, d.currency), link];
}
