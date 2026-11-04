import {
  normaliseRisk,
  normaliseSummary,
  renderDailySummary,
  riskReasons,
  summaryTemplateParams,
  SUMMARY_TEMPLATE,
} from "./insights";
import { containsForbiddenWording } from "./templates";

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

const high = normaliseRisk({
  customer_id: "c1",
  customer_name: "Late Payer Co",
  open_balance: "5000",
  overdue_amount: "5000",
  oldest_overdue_days: 85,
  avg_days_late: "39.0",
  paid_invoices: 3,
  broken_promises: 2,
  level: "high",
});
const reasons = riskReasons(high, "AED");
check(high.avg_days_late === 39 && high.open_balance === 5000, "database numbers are read as numbers");
check(
  reasons[0] === "Pays 39 days late on average" && reasons[1] === "2 broken promises to pay" && reasons[2] === "AED 5,000.00 overdue, the oldest 85 days",
  `the reasons explain the level (${reasons.join(" | ")})`
);
check(riskReasons(high, "AED", "ar").every((r) => /[؀-ۿ]/.test(r)), "reasons in Arabic");
check(normaliseRisk({ customer_id: "x", level: "weird" }).level === "low", "an unknown level is shown as low");
check(riskReasons(normaliseRisk({ customer_id: "x", paid_invoices: 4, level: "low" }), "AED")[0] === "Usually pays on time", "a good payer");
check(riskReasons(normaliseRisk({ customer_id: "x", level: "low" }), "AED")[0] === "No payment history yet", "a new customer");

const data = normaliseSummary({
  date: "2027-03-15",
  currency: "AED",
  collected_yesterday: "23500",
  collected_month: 41000,
  needs_you: 2,
  expected_week: "41000",
  overdue: 12000,
  top: ["Call Marina Bistro", "Gulf Traders says INV-1 is paid"],
});
const en = renderDailySummary(data, { business: "Al Noor Trading", link: "https://kayyro.example/collect", lang: "en" });
check(
  en.text.includes("Yesterday: AED 23,500.00 collected. 2 customers need you today. AED 41,000.00 expected this week."),
  "the summary reads like the example"
);
check(en.text.includes("- Call Marina Bistro") && en.text.includes("https://kayyro.example/collect"), "it lists who needs you and links to Get Paid");
check(!containsForbiddenWording(en.text), "plain, calm wording");
const ar = renderDailySummary(data, { business: "Al Noor Trading", link: "https://kayyro.example/collect", lang: "ar" });
check(/[؀-ۿ]/.test(ar.text) && ar.text.includes("AED 23,500.00"), "the summary in Arabic");
check(renderDailySummary({ ...data, needs_you: 1 }, { business: "B", link: "L", lang: "en" }).text.includes("1 customer needs you today"), "one customer");
const params = summaryTemplateParams(data, "Al Noor Trading", "https://kayyro.example/collect");
check(params.length === 5 && (SUMMARY_TEMPLATE.body.en.match(/\{\{\d\}\}/g) ?? []).length === 5, "WhatsApp summary template uses all 5 variables");
check(normaliseSummary({}).top.length === 0 && normaliseSummary({}).currency === "AED", "missing data is safe");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall insight checks passed");
